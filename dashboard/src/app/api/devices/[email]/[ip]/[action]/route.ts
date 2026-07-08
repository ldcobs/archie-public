import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { approveDevice, clearDevice, rejectDevice } from '@/lib/devices';

const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';

// Queue a UFW firewall rule via vpn-api — enforces network-level block within
// 60 seconds with no xray restart. Non-fatal: DB state is the source of truth.
async function firewallBlock(ip: string): Promise<void> {
  try {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
    await fetch(`${VPN_API_BASE}/vpn-api/block/${encodeURIComponent(ip)}`, { method: 'POST', headers: h });
  } catch { /* non-fatal */ }
}

async function firewallUnblock(ip: string): Promise<void> {
  try {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
    await fetch(`${VPN_API_BASE}/vpn-api/block/${encodeURIComponent(ip)}`, { method: 'DELETE', headers: h });
  } catch { /* non-fatal */ }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ email: string; ip: string; action: string }> }
) {
  // Approves/rejects/clears devices and drives UFW firewall block/unblock — a
  // state-mutating, network-control endpoint. Was only guarded by middleware's
  // cookie-presence check; require a real operator session.
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const { email, ip, action } = await params;
  const body = await req.json().catch(() => ({}));

  if (action === 'approve') {
    const result = approveDevice(email, ip, !!body.replace_oldest);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
    await firewallUnblock(ip);
    return NextResponse.json(result.result);
  }

  if (action === 'reject') {
    const result = rejectDevice(email, ip);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
    await firewallBlock(ip);
    return NextResponse.json(result.result);
  }

  if (action === 'clear') {
    const result = clearDevice(email, ip);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 404 });
    await firewallUnblock(ip);
    return NextResponse.json(result.result);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 404 });
}
