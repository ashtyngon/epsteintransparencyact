export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const clientId = (context.env.GITHUB_CLIENT_ID || '').trim();
  const clientSecret = (context.env.GITHUB_CLIENT_SECRET || '').trim();

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

  const data = await tokenRes.json();

  if (data.error || !data.access_token) {
    return new Response(`OAuth error: ${data.error || 'No access token'}`, {
      status: 400,
    });
  }

  const token = data.access_token;

  const html = `<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body>
  <script>
    (function() {
      function receiveMessage(e) {
        console.log("receiveMessage %o", e);
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
