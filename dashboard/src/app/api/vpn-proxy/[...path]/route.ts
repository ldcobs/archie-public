import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';

// Internal Docker URL — bypasses nginx basic auth
const VPN_API_BASE = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN ?? '';

// Allowed paths to avoid open proxy
const ALLOWED = new Set([
  'vpn-api/inbounds/test',
  'vpn-api/inbounds/restart',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const check = requireApiRole(req, 'operator');
  if ('response' in check) return check.response;

  const { path } = await params;
  const joined = path.join('/');

  if (!ALLOWED.has(joined)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const upstream = `${VPN_API_BASE}/${joined}`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) headers['Authorization'] = `Bearer ${VPN_API_TOKEN}`;
    const r = await fetch(upstream, { method: 'POST', headers });
    const body = await r.json().catch(() => ({ ok: false }));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: String(err) }, { status: 502 });
  }
}
