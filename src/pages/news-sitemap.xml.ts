import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const articles = await getCollection('articles', (a) => a.data.status === 'published');
  
  // Google News sitemap only includes articles from the last 2 days
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  // But for initial indexing, include last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const recentArticles = articles
    .filter((a) => a.data.publishedAt > thirtyDaysAgo)
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());

  const urls = recentArticles.map((article) => {
    const pubDate = article.data.publishedAt.toISOString();
    return `  <url>
    <loc>https://epsteintransparencyact.com/news/${article.id}/</loc>
    <news:news>
      <news:publication>
        <news:name>Epstein Files Tracker</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${escapeXml(article.data.title)}</news:title>
    </news:news>
    <lastmod>${pubDate}</lastmod>
    <changefreq>never</changefreq>
  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
