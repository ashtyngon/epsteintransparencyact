import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { generateOgImage } from '../../utils/og-image';

export const getStaticPaths: GetStaticPaths = async () => {
  const articles = await getCollection('articles', (a) => a.data.status === 'published');
  const people = await getCollection('people');
  const timeline = await getCollection('timeline');

  const paths = [
    // Articles
    ...articles.map((a) => ({
      params: { slug: `articles/${a.id}` },
      props: {
        title: a.data.title,
        subtitle: a.data.summary,
        tag: a.data.source,
        date: a.data.publishedAt.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      },
    })),
    // People
    ...people.map((p) => ({
      params: { slug: `people/${p.id}` },
      props: {
        title: p.data.name,
        subtitle: p.data.shortBio,
        tag: p.data.category.replace(/-/g, ' ').toUpperCase(),
        date: undefined,
      },
    })),
    // Timeline
    ...timeline.map((t) => ({
      params: { slug: `timeline/${t.id}` },
      props: {
        title: t.data.title,
        subtitle: t.data.summary,
        tag: 'TIMELINE',
        date: t.data.date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      },
    })),
  ];

  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { title, subtitle, tag, date } = props as {
    title: string;
    subtitle: string;
    tag?: string;
    date?: string;
  };

  const png = await generateOgImage({ title, subtitle, tag, date });

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
