import { getDb } from './db';
import { getMetaByUuid, upsertMeta } from './user-meta';
import { listClients, removeUser, restoreUser } from './xray-config';
import { rejectDevice, getApprovedIps } from './devices';

const VPN_API_URL   = process.env.VPN_API_URL          ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN     ?? '';
const VPN_API_BASE  = process.env.VPN_API_INTERNAL_URL ?? VPN_API_URL;

// Live Xray sync via HandlerService — disable/enable a single user with NO
// restart, so enforcement never drops other users' connections.
async function setXrayUser(email: string, action: 'disable' | 'enable'): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) headers.Authorization = `Bearer ${VPN_API_TOKEN}`;
    await fetch(`${VPN_API_BASE}/vpn-api/xray/user/${action}`, {
      method: 'POST', headers, body: JSON.stringify({ email }),
    });
  } catch { /* non-fatal — config.json is canonical */ }
}

async function setWireGuardPeer(email: string, action: 'disable' | 'enable'): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (VPN_API_TOKEN) headers.Authorization = `Bearer ${VPN_API_TOKEN}`;
    await fetch(`${VPN_API_BASE}/vpn-api/wireguard/peer/${action}`, {
      method: 'POST', headers, body: JSON.stringify({ name: email.split('@')[0].toLowerCase() }),
    });
  } catch { /* non-fatal */ }
}

export interface EnforcementAction {
  email: string;
  uuid: string;
  action: 'disabled' | 'restored' | 'skipped';
  reason?: string;
}

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function sumTrafficGB(email: string, since: string): number {
  const emailKey = email.split('@')[0] || email;
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(upload + download), 0) AS total
    FROM traffic_daily
    WHERE email = ? AND day >= ?
  `).get(emailKey, since) as { total: number };
  return (row?.total ?? 0) / 1e9;
}

// ── Authoritative block evaluation ────────────────────────────────────────────
// THE single source of truth for whether a key is blocked by a limitation.
// Both runEnforcement() and the manual re-enable route call this, so the
// "is this user over quota / expired?" decision can never disagree between the
// automatic enforcer and the admin UI. This is the function any dispute about
// why a key was blocked should be traced back to.
export interface BlockEvaluation {
  blocked: boolean;
  expired: boolean;
  overLimit: boolean;
  usedGB: number;
  limitGB: number | null;
  expiresAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluateBlock(email: string, meta: any): BlockEvaluation {
  const expiresAt: string | null = meta?.expiresAt ?? null;
  const expired = expiresAt ? new Date(expiresAt) < new Date() : false;
  const limitGB: number | null =
    meta?.trafficLimitGB && meta.trafficLimitGB > 0 ? meta.trafficLimitGB : null;
  const usedGB = limitGB ? sumTrafficGB(email, getMonthStart()) : 0;
  const overLimit = limitGB ? usedGB >= limitGB : false;
  return { blocked: expired || overLimit, expired, overLimit, usedGB, limitGB, expiresAt };
}

// Reset the current calendar month's usage for a user (clears the over-quota
// condition). Used by the force-resolve re-enable flow.
export function resetMonthUsage(email: string): void {
  const emailKey = email.split('@')[0] || email;
  getDb()
    .prepare('DELETE FROM traffic_daily WHERE email = ? AND day >= ?')
    .run(emailKey, getMonthStart());
}

export async function runEnforcement(): Promise<EnforcementAction[]> {
  const actions: EnforcementAction[] = [];
  const now = new Date().toISOString();
  const monthStart = getMonthStart();

  // Build email → uuid map from live xray config
  const liveClients = listClients();
  const liveByEmail = new Map(liveClients.map(c => [c.email, c.id]));

  // All users with any enforcement constraint OR already disabled
  const rows = getDb().prepare(`
    SELECT uuid, display_name, expires_at, traffic_limit_gb, disabled, disabled_reason
    FROM user_meta
    WHERE (expires_at IS NOT NULL AND expires_at != '')
       OR (traffic_limit_gb IS NOT NULL AND traffic_limit_gb > 0)
       OR disabled = 1
  `).all() as {
    uuid: string;
    display_name: string;
    expires_at: string | null;
    traffic_limit_gb: number | null;
    disabled: number;
    disabled_reason: string | null;
  }[];

  for (const row of rows) {
    const meta = getMetaByUuid(row.uuid);
    if (!meta) continue;

    // Find email regardless of live status (may be already removed)
    const anyClient = listClients().find(c => c.id === row.uuid);
    const resolvedEmail = anyClient?.email ?? meta.displayName.toLowerCase().replace(/\s+/g, '');

    const isExpired  = meta.expiresAt ? new Date(meta.expiresAt) < new Date(now) : false;
    const usedGB     = meta.trafficLimitGB ? sumTrafficGB(resolvedEmail, monthStart) : 0;
    const overLimit  = meta.trafficLimitGB && meta.trafficLimitGB > 0
      ? usedGB >= meta.trafficLimitGB
      : false;

    const shouldDisable = isExpired || overLimit;
    const isInXray = liveByEmail.has(resolvedEmail) || liveClients.some(c => c.id === row.uuid);

    if (shouldDisable && isInXray) {
      const reason = isExpired ? 'expired' : 'traffic_limit';
      removeUser(resolvedEmail, 'enforcement');
      upsertMeta(row.uuid, { disabled: true, disabledReason: reason });
      // Live-sync runtime: remove from Xray + WireGuard, no restart.
      await Promise.all([setXrayUser(resolvedEmail, 'disable'), setWireGuardPeer(resolvedEmail, 'disable')]);
      actions.push({ email: resolvedEmail, uuid: row.uuid, action: 'disabled', reason });

    } else if (!shouldDisable && row.disabled === 1 && row.disabled_reason !== 'manual') {
      // Conditions cleared — restore to xray. Manual disables are never
      // auto-restored: only a manual enable (disabled_reason cleared) re-enables them.
      restoreUser(resolvedEmail, row.uuid, meta.protocols?.length ? meta.protocols : ['vless-reality'], 'enforcement');
      upsertMeta(row.uuid, { disabled: false, disabledReason: null });
      // Live-sync runtime: add back to Xray + WireGuard, no restart.
      await Promise.all([setXrayUser(resolvedEmail, 'enable'), setWireGuardPeer(resolvedEmail, 'enable')]);
      actions.push({ email: resolvedEmail, uuid: row.uuid, action: 'restored' });

    } else {
      actions.push({
        email: resolvedEmail,
        uuid: row.uuid,
        action: 'skipped',
        reason: shouldDisable ? 'already disabled' : 'within limits',
      });
    }
  }

  // No batch restart — each action above already live-synced its own user.
  return actions;
}

// ── Connection limit enforcement ──────────────────────────────────────────────

export interface ConnectionAction {
  email: string;
  ip: string;
  action: 'rejected' | 'skipped';
  reason: string;
}

export async function runConnectionLimitEnforcement(): Promise<ConnectionAction[]> {
  const actions: ConnectionAction[] = [];

  // Fetch live stats from vpn-api to get current active IPs per user
  let statsUsers: Array<{ email: string; ips: Array<{ ip: string }> }> = [];
  try {
    const res = await fetch(`${VPN_API_URL}/vpn-api/stats`, {
      headers: { Authorization: `Bearer ${VPN_API_TOKEN}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json() as { users?: Array<{ email: string; ips: Array<{ ip: string }> }> };
      statsUsers = data.users ?? [];
    }
  } catch {
    return actions;
  }

  // Build email → uuid map
  const clients = listClients();
  const uuidByEmail = new Map(clients.map(c => [c.email, c.id]));

  for (const u of statsUsers) {
    const uuid = uuidByEmail.get(u.email);
    if (!uuid) continue;

    const meta = getMetaByUuid(uuid);
    if (!meta || !meta.connectionLimit || meta.connectionLimit <= 0) continue;

    const activeIps = u.ips.map(x => x.ip);
    if (activeIps.length <= meta.connectionLimit) {
      actions.push({ email: u.email, ip: '', action: 'skipped', reason: `${activeIps.length}/${meta.connectionLimit} — within limit` });
      continue;
    }

    const approvedSet = getApprovedIps(u.email);

    // Reject IPs over the limit — spare approved ones first, then oldest
    const unapproved = activeIps.filter(ip => !approvedSet.has(ip));
    const overflow = unapproved.slice(meta.connectionLimit);

    for (const ip of overflow) {
      rejectDevice(u.email, ip);
      actions.push({ email: u.email, ip, action: 'rejected', reason: `connection limit ${meta.connectionLimit} exceeded` });
    }
  }

  return actions;
}
