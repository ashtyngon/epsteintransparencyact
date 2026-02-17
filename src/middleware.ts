import { defineMiddleware } from 'astro:middleware';
import { getSessionIdFromCookie, getSession } from './lib/auth';
import { getEnv } from './lib/env';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Only protect /admin/* routes (except login and callback)
  if (!pathname.startsWith('/admin')) {
    return next();
  }

  // Allow login and callback pages without auth
  if (pathname === '/admin/login/' || pathname === '/admin/callback/') {
    return next();
  }

  // Check for valid session
  const cookieHeader = context.request.headers.get('cookie');
  const sessionId = getSessionIdFromCookie(cookieHeader);

  if (!sessionId) {
    return context.redirect('/admin/login/');
  }

  // Get KV binding from Cloudflare runtime
  const cfEnv = getEnv(context.locals);
  const kv = cfEnv.ADMIN_SESSIONS;

  if (!kv) {
    // KV not available (local dev without bindings) — allow access in dev
    if (import.meta.env.DEV) {
      context.locals.user = {
        login: 'dev-user',
        name: 'Developer',
        avatarUrl: '',
        githubToken: import.meta.env.GITHUB_TOKEN || '',
      };
      return next();
    }
    return context.redirect('/admin/login/');
  }

  const session = await getSession(kv, sessionId);
  if (!session) {
    return context.redirect('/admin/login/');
  }

  // Attach user info to locals for admin pages
  context.locals.user = {
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    githubToken: session.githubToken,
  };

  return next();
});
