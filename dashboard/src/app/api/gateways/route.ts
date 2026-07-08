import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VPN_API = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const TOKEN   = process.env.VPN_API_V3_TOKEN ?? '';

function vpnHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  try {
    const r = await fetch(`${VPN_API}/vpn-api/gateways`, { headers: vpnHeaders() });
    const body = await r.json().catch(() => ({ ok: false }));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  try {
    const payload = await req.json();
    const r = await fetch(`${VPN_API}/vpn-api/gateways`, {
      method: 'POST',
      headers: vpnHeaders(),
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({ ok: false }));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
