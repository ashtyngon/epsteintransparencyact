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

  // Helper to get string env var, trimming whitespace from keys with trailing spaces
  const str = (name: string): string => {
    // Try exact match first, then try with trailing space (Cloudflare dashboard quirk)
    const val = env[name] || env[name + ' '] || import.meta.env[name] || '';
    return typeof val === 'string' ? val.trim() : val || '';
  };

  return {
    GITHUB_CLIENT_ID: str('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: str('GITHUB_CLIENT_SECRET'),
    GITHUB_REPO: str('GITHUB_REPO') || 'ashtyngon/epsteintransparencyact',
    ADMIN_SESSION_SECRET: str('ADMIN_SESSION_SECRET'),
    ADMIN_SESSIONS: env.ADMIN_SESSIONS || null,
  };
}
