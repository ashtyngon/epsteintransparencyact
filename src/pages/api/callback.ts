export const prerender = false;

// OAuth callback is handled in middleware.ts to run before trailing slash redirects.
// This file exists so Astro registers /api/callback as a valid SSR route.
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response('OAuth callback handler not reached', { status: 500 });
};
