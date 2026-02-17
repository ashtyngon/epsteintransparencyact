import { defineMiddleware } from 'astro:middleware';
import { getEnv } from './lib/env';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, origin, searchParams } = context.url;

  // Handle Decap CMS OAuth - intercept before trailing slash redirect
  if (pathname === '/api/auth' || pathname === '/api/auth/') {
    const cfEnv = getEnv(context.locals);
    const clientId = cfEnv.GITHUB_CLIENT_ID;

    if (!clientId) {
      return new Response('GitHub Client ID not configured', { status: 500 });
    }

    const callbackUrl = `${origin}/api/callback/`;
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
  }

  if (pathname === '/api/callback' || pathname === '/api/callback/') {
    const code = searchParams.get('code');
    if (!code) {
      return new Response('Missing code parameter', { status: 400 });
    }

    const cfEnv = getEnv(context.locals);
    const clientId = cfEnv.GITHUB_CLIENT_ID;
    const clientSecret = cfEnv.GITHUB_CLIENT_SECRET;

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
      return new Response(`OAuth error: ${data.error || 'No access token'}`, { status: 400 });
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
  }

  return next();
});
