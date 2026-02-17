export async function onRequestGet(context) {
  const clientId = context.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    return new Response('GitHub Client ID not configured', { status: 500 });
  }

  const url = new URL(context.request.url);
  const callbackUrl = `${url.origin}/api/callback`;

  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: callbackUrl,
    scope: 'repo,user',
    state: crypto.randomUUID(),
  });

  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`,
    302
  );
}
