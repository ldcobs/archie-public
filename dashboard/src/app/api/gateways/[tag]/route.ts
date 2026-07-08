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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tag: string }> }
) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const { tag } = await params;
  try {
    const r = await fetch(`${VPN_API}/vpn-api/gateways/${tag}`, {
      method: 'DELETE',
      headers: vpnHeaders(),
    });
    const body = await r.json().catch(() => ({ ok: false }));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
