// Shared invite-link base URL builder.
//
// Previously duplicated in three route handlers, each hardcoding `https://`
// unconditionally. That's correct for domain installs (Mode B/C, terminated
// by nginx over TLS) but wrong for IP-only installs (Mode A), which have no
// certificate — the resulting link pointed browsers at port 443, which is
// Xray's Reality VPN listener (not the dashboard), producing a certificate
// mismatch against Reality's decoy site.
//
// Protocol is derived from the actual request: `x-forwarded-proto` if a
// reverse proxy set it (nginx does in domain modes), otherwise the scheme the
// request actually arrived on (correctly `http` for a Mode A install with no
// TLS anywhere in front of the dashboard).
export function inviteBaseUrl(req: Request): string {
  if (process.env.NEXT_PUBLIC_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_PUBLIC_BASE_URL;
  }
  const fwdHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!fwdHost) return new URL(req.url).origin + '/v3';
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${fwdHost}/v3`;
}
