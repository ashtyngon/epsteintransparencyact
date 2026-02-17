import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  // Decap CMS handles its own authentication via GitHub OAuth.
  // The /api/auth and /api/callback endpoints are SSR routes that
  // facilitate the OAuth flow. No session middleware needed.
  return next();
});
