import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { removeUser, emailToUuid } from '@/lib/xray-config';
import { deleteMeta } from '@/lib/user-meta';

const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';
async function liveRemove(email: string) {
  try {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
    await fetch(`${VPN_API_BASE}/vpn-api/xray/user/disable`, {
      method: 'POST', headers: h, body: JSON.stringify({ email }),
    });
  } catch { /* non-fatal */ }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = requireApiRole(_req, 'admin');
  if ('response' in auth) return auth.response;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  const uuid = emailToUuid()[email];
  const result = removeUser(email, 'dashboard-v3/api/users/delete');
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (uuid) deleteMeta(uuid);
  // Live-sync to the running Xray via HandlerService — no restart needed.
  await liveRemove(email);
  return NextResponse.json({ deleted: email, note: 'Removed immediately' });
}
