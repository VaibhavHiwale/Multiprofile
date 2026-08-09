// Workers always terminate TLS at the edge, so the incoming request URL is
// already the public absolute URL — there's no reverse proxy to second-guess
// the way the Node build had to (it read x-forwarded-proto because it sat
// behind Cloudflare Tunnel). x-forwarded-proto is still honoured so that
// `wrangler dev --local` over plain HTTP and any future proxy both behave.
export function baseUrl(c) {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto');
  const proto = forwardedProto ?? url.protocol.replace(':', '');
  const host = c.req.header('host') ?? url.host;
  return `${proto}://${host}`;
}
