import type { APIRoute } from 'astro';
import { generateOgImage } from '../utils/og-image';

export const GET: APIRoute = async () => {
  const png = await generateOgImage({
    title: 'The Epstein Files: Every Document. Every Name. Every Update.',
    subtitle:
      'Tracking every development around the Epstein Files and the Epstein Transparency Act. News from major outlets with full source attribution.',
    tag: 'ACTIVE INVESTIGATION',
  });

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
