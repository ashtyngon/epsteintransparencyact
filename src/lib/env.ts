/**
 * Centralized environment variable access for Cloudflare Pages.
 * Tries runtime.env first (Cloudflare Worker bindings), then import.meta.env (build-time).
 */

export function getEnv(locals: any): {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_REPO: string;
  ADMIN_SESSION_SECRET: string;
  ADMIN_SESSIONS: KVNamespace | null;
} {
  const runtime = locals?.runtime;
  const env = runtime?.env || {};

  return {
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID || import.meta.env.GITHUB_CLIENT_ID || '',
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET || import.meta.env.GITHUB_CLIENT_SECRET || '',
    GITHUB_REPO: env.GITHUB_REPO || import.meta.env.GITHUB_REPO || 'ashtyngon/epsteintransparencyact',
    ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET || import.meta.env.ADMIN_SESSION_SECRET || '',
    ADMIN_SESSIONS: env.ADMIN_SESSIONS || null,
  };
}
