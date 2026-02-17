export const prerender = false;

// OAuth is handled in middleware.ts to run before trailing slash redirects.
// This file exists so Astro registers /api/auth as a valid SSR route.
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response('OAuth handler not reached', { status: 500 });
};
