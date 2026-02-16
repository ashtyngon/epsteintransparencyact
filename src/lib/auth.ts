/**
 * GitHub OAuth + session management for the admin CMS.
 * Sessions stored in Cloudflare KV (ADMIN_SESSIONS binding).
 */

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
}

export interface Session {
  userId: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  githubToken: string;
  createdAt: number;
}

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export function getLoginUrl(clientId: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.access_token || null;
}

export async function getGitHubUser(token: string): Promise<GitHubUser | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) return null;
  return res.json() as Promise<GitHubUser>;
}

export async function checkRepoAccess(
  token: string,
  repo: string
): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) return false;
  const data = await res.json() as any;
  // Must have push access (collaborator)
  return data.permissions?.push === true || data.permissions?.admin === true;
}

function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSession(
  kv: KVNamespace,
  user: GitHubUser,
  githubToken: string
): Promise<string> {
  const sessionId = generateSessionId();
  const session: Session = {
    userId: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    githubToken,
    createdAt: Date.now(),
  };

  await kv.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  return sessionId;
}

export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<Session | null> {
  const data = await kv.get(`session:${sessionId}`);
  if (!data) return null;
  return JSON.parse(data) as Session;
}

export async function deleteSession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(`session:${sessionId}`);
}

export function getSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function setSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
