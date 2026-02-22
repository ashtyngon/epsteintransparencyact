// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import fs from 'node:fs';
import path from 'node:path';

// Build URL → lastmod map from content frontmatter at config time
function buildLastmodMap() {
  /** @type {Record<string, string>} */
  const map = {};
  const contentDir = path.resolve('./src/content');

  // Articles: /news/{slug}/ → publishedAt or updatedAt
  const articlesDir = path.join(contentDir, 'articles');
  if (fs.existsSync(articlesDir)) {
    for (const file of fs.readdirSync(articlesDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(articlesDir, file), 'utf-8');
      const slug = file.replace(/\.md$/, '');
      const updatedAt = content.match(/^updatedAt:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.replace(/^''$/, '');
      const publishedAt = content.match(/^publishedAt:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.replace(/^''$/, '');
      const dateStr = (updatedAt && updatedAt.length > 4) ? updatedAt : publishedAt;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) map[`/news/${slug}/`] = d.toISOString();
      }
    }
  }

  // People: /people/{slug}/ → file mtime (no updatedAt field)
  const peopleDir = path.join(contentDir, 'people');
  if (fs.existsSync(peopleDir)) {
    for (const file of fs.readdirSync(peopleDir).filter(f => f.endsWith('.md'))) {
      const slug = file.replace(/\.md$/, '');
      const mtime = fs.statSync(path.join(peopleDir, file)).mtime;
      map[`/people/${slug}/`] = mtime.toISOString();
    }
  }

  // Timeline: /timeline/{slug}/ → file mtime
  const timelineDir = path.join(contentDir, 'timeline');
  if (fs.existsSync(timelineDir)) {
    for (const file of fs.readdirSync(timelineDir).filter(f => f.endsWith('.md'))) {
      const slug = file.replace(/\.md$/, '');
      const mtime = fs.statSync(path.join(timelineDir, file)).mtime;
      map[`/timeline/${slug}/`] = mtime.toISOString();
    }
  }

  // Survivors: /survivors/{slug}/ → publishedAt
  const survivorsDir = path.join(contentDir, 'survivors');
  if (fs.existsSync(survivorsDir)) {
    for (const file of fs.readdirSync(survivorsDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(survivorsDir, file), 'utf-8');
      const slug = file.replace(/\.md$/, '');
      const publishedAt = content.match(/^publishedAt:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.replace(/^''$/, '');
      if (publishedAt) {
        const d = new Date(publishedAt);
        if (!isNaN(d.getTime())) map[`/survivors/${slug}/`] = d.toISOString();
      }
    }
  }

  return map;
}

const lastmodMap = buildLastmodMap();

// https://astro.build/config
export default defineConfig({
  site: 'https://epsteintransparencyact.com',
  trailingSlash: 'always',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    markdoc({ allowHTML: true }),
    sitemap({
      serialize(item) {
        const urlPath = new URL(item.url).pathname;
        if (lastmodMap[urlPath]) {
          item.lastmod = lastmodMap[urlPath];
        } else {
          // Static pages: use current build time
          item.lastmod = new Date().toISOString();
        }
        return item;
      },
    }),
  ],
});
