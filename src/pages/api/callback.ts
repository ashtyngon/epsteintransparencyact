export const prerender = false;

import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/env';

export const GET: APIRoute = async ({ locals, url }) => {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const cfEnv = getEnv(locals);
  const clientId = cfEnv.GITHUB_CLIENT_ID;
  const clientSecret = cfEnv.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response('GitHub OAuth credentials not configured. Check Cloudflare env vars.', { status: 500 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
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

  if (!tokenRes.ok) {
    return new Response(`Failed to exchange code for token: ${tokenRes.status}`, { status: 500 });
  }

  const data = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };

  if (data.error || !data.access_token) {
    return new Response(`OAuth error: ${data.error || 'No access token'} - ${data.error_description || ''}`, { status: 400 });
  }

  const token = data.access_token;

  const html = `<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body>
<script>
(function() {
  function receiveMessage(e) {
    window.opener.postMessage(
      'authorization:github:success:{"token":"${token}","provider":"github"}',
      e.origin
    );
  }
  window.addEventListener("message", receiveMessage, false);
  window.opener.postMessage("authorizing:github", "*");
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
};
