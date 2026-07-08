import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { addUser, syncUserAcrossInbounds } from '@/lib/xray-config';
import { upsertMeta } from '@/lib/user-meta';

const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';
function apiHeaders() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
  return h;
}
async function liveSync(action: 'enable' | 'disable', email: string) {
  try {
    await fetch(`${VPN_API_BASE}/vpn-api/xray/user/${action}`, {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email }),
    });
  } catch { /* non-fatal — config.json is the source of truth */ }
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? '').trim().toLowerCase();
  const group = (body.group ?? 'Ungrouped').trim();
  const displayName = (body.displayName ?? email).trim();
  const protocols   = Array.isArray(body.protocols) && body.protocols.length > 0 ? body.protocols as string[] : ['vless-reality'];

  if (!email || !/^[a-z0-9_-]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid name — use letters, numbers, hyphens, underscores' }, { status: 400 });
  }

  const result = addUser(email, 'dashboard-v3/api/users');
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const meta = upsertMeta(result.uuid, { displayName, group, protocols });
  // addUser only added the client to inbounds[0]; reconcile across all inbounds
  // so the assigned protocols are actually provisioned (and unwanted ones aren't).
  syncUserAcrossInbounds(result.uuid, email, protocols, 'dashboard-v3/api/users');
  // Live-sync to the running Xray via HandlerService — no restart needed.
  await liveSync('enable', email);

  return NextResponse.json({
    email,
    uuid: result.uuid,
    vless_uri: result.uri,
    meta,
    note: 'Key active immediately',
  }, { status: 201 });
}
