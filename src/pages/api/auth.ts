export const prerender = false;

import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/env';

export const GET: APIRoute = async ({ locals, url }) => {
  const cfEnv = getEnv(locals);
  const clientId = cfEnv.GITHUB_CLIENT_ID;

  if (!clientId) {
    return new Response('GitHub Client ID not configured', { status: 500 });
  }

  const callbackUrl = new URL('/api/callback/', url.origin).toString();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo,user',
    state: crypto.randomUUID(),
  });

  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`,
    302
  );
};
