import { NextRequest, NextResponse } from 'next/server';
import { validateInviteToken, consumeInviteToken } from '@/lib/invite-tokens';
import { addUser, syncUserAcrossInbounds } from '@/lib/xray-config';
import { upsertMeta } from '@/lib/user-meta';
import { profileProtocols } from '@/lib/access-profiles';
import { setKeyPreset } from '@/lib/posture-store';

const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';
function apiHeaders() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
  return h;
}
async function liveSync(email: string) {
  try {
    await fetch(`${VPN_API_BASE}/vpn-api/xray/user/enable`, {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email }),
    });
  } catch { /* non-fatal */ }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = (body.token ?? '').trim();
  const email  = (body.email  ?? '').trim().toLowerCase();

  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  if (!email || !/^[a-z0-9_-]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid name — use letters, numbers, hyphens, underscores.' }, { status: 400 });
  }

  const entry = validateInviteToken(token);
  if ('error' in entry) return NextResponse.json({ error: entry.error }, { status: 410 });

  const displayName = entry.displayName ?? email;
  const group = entry.group;
  // Provision the exact protocol bundle the operator selected at invite time —
  // not a hardcoded default. Falls back to Standard for legacy tokens (no profile).
  const protocols = profileProtocols(entry.profile);

  const result = addUser(email, 'api/invite/redeem');
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });

  upsertMeta(result.uuid, {
    displayName,
    group,
    protocols,
    ...(entry.trafficLimitGB ? { trafficLimitGB: entry.trafficLimitGB } : {}),
    ...(entry.connectionLimit ? { connectionLimit: entry.connectionLimit } : {}),
  });
  syncUserAcrossInbounds(result.uuid, email, protocols, 'api/invite/redeem');

  // Apply the operator's chosen device posture as a per-key override so it's
  // actually enforced for this user (Strict/Balanced/Open).
  if (entry.posture === 'strict' || entry.posture === 'balanced' || entry.posture === 'open') {
    setKeyPreset(email, entry.posture);
  }

  await liveSync(email);
  consumeInviteToken(token, email);

  return NextResponse.json({
    email,
    uuid: result.uuid,
    // /api/sub/[token] resolves by uuid, not email — this 404'd for every
    // redemption until now.
    subUrl: `${process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? ''}/api/sub/${result.uuid}`,
  }, { status: 201 });
}
