import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { removeUser, restoreUser, emailToUuid } from '@/lib/xray-config';
import { upsertMeta, getMetaByUuid } from '@/lib/user-meta';
import { evaluateBlock, resetMonthUsage } from '@/lib/traffic-enforce';
import fs from 'fs';

interface Resolution {
  newExpiresAt?: string;   // ISO date — extend/replace expiry
  newLimitGB?: number;     // raise the monthly quota
  resetUsage?: boolean;    // wipe this month's usage
}

const XRAY_CFG      = process.env.XRAY_CFG             ?? '/etc/xray/config.json';
const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (VPN_API_TOKEN) h.Authorization = `Bearer ${VPN_API_TOKEN}`;
  return h;
}

// UUID lookup: try live Xray config first, fall back to the .bak snapshot written
// just before a user is removed, so re-enable can still find disabled users.
function resolveUuid(email: string): string | null {
  const live = emailToUuid()[email];
  if (live) return live;
  try {
    const bak = JSON.parse(fs.readFileSync(XRAY_CFG + '.bak', 'utf8'));
    for (const inbound of bak.inbounds ?? []) {
      const clients = inbound?.settings?.clients as Array<{ email?: string; id?: string }> | undefined;
      const match = clients?.find(c => c.email === email);
      if (match?.id) return match.id;
    }
  } catch { /* backup unreadable */ }
  return null;
}

// Live Xray sync via HandlerService API — adds/removes this ONE user from the
// running Xray with no restart and zero impact on any other connected user.
// config.json is already updated by removeUser/restoreUser; this syncs runtime.
async function setXrayUser(email: string, action: 'disable' | 'enable'): Promise<void> {
  try {
    await fetch(`${VPN_API_BASE}/vpn-api/xray/user/${action}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ email }),
    });
  } catch { /* non-fatal — change is persisted to config.json */ }
}

// WireGuard peer name is the local part of the email (e.g. alex@… → "alex").
async function setWireGuardPeer(email: string, action: 'disable' | 'enable'): Promise<void> {
  const name = email.split('@')[0].toLowerCase();
  try {
    await fetch(`${VPN_API_BASE}/vpn-api/wireguard/peer/${action}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ name }),
    });
  } catch { /* non-fatal — WireGuard may not have a peer for this user */ }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  const body = await req.json().catch(() => ({}));
  const disabled = body?.disabled === true;

  const uuid = resolveUuid(email);
  if (!uuid) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (disabled) {
    const r = removeUser(email, 'dashboard-v3/manual-disable');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    upsertMeta(uuid, { disabled: true, disabledReason: 'manual' });
    await Promise.all([setXrayUser(email, 'disable'), setWireGuardPeer(email, 'disable')]);
    return NextResponse.json({ ok: true, disabled: true });
  }

  // ── Re-enable ────────────────────────────────────────────────────────────────
  // A bare re-enable of a key that is STILL over quota or expired is pointless:
  // the enforcement loop would re-disable it within seconds. So we evaluate the
  // live block state first and, if the key is limit-blocked, refuse a plain
  // re-enable (409) and tell the UI exactly why — over quota X/Y GB, or expired
  // on DATE. The admin must supply a resolution that actually clears the limit.
  const meta = getMetaByUuid(uuid);
  const before = evaluateBlock(email, meta);

  if (before.blocked) {
    const resolution = body?.resolution as Resolution | undefined;
    if (!resolution) {
      return NextResponse.json(
        {
          error: 'limit_blocked',
          message: 'Key is blocked by an active limitation. Re-enabling alone will not hold — resolve the limit.',
          expired: before.expired,
          overLimit: before.overLimit,
          usedGB: Math.round(before.usedGB * 100) / 100,
          limitGB: before.limitGB,
          expiresAt: before.expiresAt,
        },
        { status: 409 },
      );
    }

    // Apply the chosen resolution, then re-evaluate against the SAME authoritative
    // function the enforcer uses. If it's still blocked, the resolution was
    // insufficient — reject so we never restore a key that would just bounce.
    const patch: Record<string, unknown> = {};
    if (resolution.newExpiresAt) patch.expiresAt = resolution.newExpiresAt;
    if (typeof resolution.newLimitGB === 'number') patch.trafficLimitGB = resolution.newLimitGB;
    if (Object.keys(patch).length) upsertMeta(uuid, patch);
    if (resolution.resetUsage) resetMonthUsage(email);

    const after = evaluateBlock(email, getMetaByUuid(uuid));
    if (after.blocked) {
      return NextResponse.json(
        {
          error: 'resolution_insufficient',
          message: 'The key would still be blocked after that change.',
          expired: after.expired,
          overLimit: after.overLimit,
          usedGB: Math.round(after.usedGB * 100) / 100,
          limitGB: after.limitGB,
          expiresAt: after.expiresAt,
        },
        { status: 409 },
      );
    }
  }

  const protocols = meta?.protocols ?? ['vless-reality'];
  const r = restoreUser(email, uuid, protocols, 'dashboard-v3/manual-enable');
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  upsertMeta(uuid, { disabled: false, disabledReason: null });
  await Promise.all([setXrayUser(email, 'enable'), setWireGuardPeer(email, 'enable')]);
  return NextResponse.json({ ok: true, disabled: false });
}
