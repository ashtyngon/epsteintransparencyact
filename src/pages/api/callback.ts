export const prerender = false;

import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/env';

export const GET: APIRoute = async ({ url, locals }) => {
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const cfEnv = getEnv(locals);
  const clientId = cfEnv.GITHUB_CLIENT_ID;
  const clientSecret = cfEnv.GITHUB_CLIENT_SECRET;

  // Exchange code for access token
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
    return new Response('Failed to exchange code for token', { status: 500 });
  }

  const data = (await tokenRes.json()) as { access_token?: string; error?: string };

  if (data.error || !data.access_token) {
    return new Response(`OAuth error: ${data.error || 'No access token'}`, {
      status: 400,
    });
  }

  const token = data.access_token;

  // Send token back to Decap CMS via postMessage
  const html = `<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body>
  <script>
    (function() {
      function recieveMessage(e) {
        console.log("recieveMessage %o", e);
        // send message to main window with auth result
        window.opener.postMessage(
          'authorization:github:success:${JSON.stringify({ token, provider: 'github' })}',
          e.origin
        );
      }
      window.addEventListener("message", recieveMessage, false);
      // Start handshake with parent
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
