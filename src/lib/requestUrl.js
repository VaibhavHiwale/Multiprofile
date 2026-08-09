// Deployments sit behind Cloudflare Tunnel / a reverse proxy (see design doc
// §7), so trust x-forwarded-proto when present rather than req.protocol.
export function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  return `${proto}://${req.headers.host}`;
}
