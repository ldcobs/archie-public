import fs from 'fs';
import path from 'path';
import type { DevicePolicyResult, DeviceItem, UserDevicePolicy, IpInfo, ReputationResult } from './types';
import { ipInfo } from './geo';
import { writeJsonFileAtomic } from './state-storage';
import { syncDeviceBlockRoutes } from './xray-config';

// These point to the EXISTING vpn-api state files (shared read/write)
const STATE_DIR      = process.env.STATE_DIR      ?? '/app/vpn-api';
const DEVICE_FILE    = path.join(STATE_DIR, 'device_approvals.json');
const KNOWN_IPS_FILE = path.join(STATE_DIR, 'known_ips.json');
const BLOCKS_FILE    = path.join(STATE_DIR, 'permanent_blocks.json');

const DEVICE_LIMIT = 6;

// ── Known IPs ─────────────────────────────────────────────────────────────────

export async function loadKnownIps(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(fs.readFileSync(KNOWN_IPS_FILE, 'utf8'));
  } catch { return {}; }
}

export async function saveKnownIps(data: Record<string, string[]>): Promise<void> {
  try { writeJsonFileAtomic(KNOWN_IPS_FILE, data); } catch {}
}

// ── Permanent blocks ──────────────────────────────────────────────────────────

export function getPermanentBlocks(): Set<string> {
  try {
    const d = JSON.parse(fs.readFileSync(BLOCKS_FILE, 'utf8'));
    return new Set<string>(d.ips ?? []);
  } catch { return new Set(); }
}

// ── Device DB ─────────────────────────────────────────────────────────────────

interface DeviceDb { users: Record<string, UserDevicePolicy> }

function loadDeviceDb(): DeviceDb {
  try {
    const d = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (d && typeof d === 'object') {
      d.users = d.users ?? {};
      return d as DeviceDb;
    }
  } catch {}
  return { users: {} };
}

function saveDeviceDb(db: DeviceDb): boolean {
  try {
    writeJsonFileAtomic(DEVICE_FILE, db);
    return true;
  } catch { return false; }
}

export function getPendingDeviceCount(): number {
  const db = loadDeviceDb();
  return Object.values(db.users).reduce(
    (n, u) => n + Object.keys(u.pending ?? {}).length, 0
  );
}

export function getApprovedIps(email: string): Set<string> {
  const db = loadDeviceDb();
  return new Set(Object.keys(db.users[email]?.approved ?? {}));
}

function userPolicy(db: DeviceDb, user: string): UserDevicePolicy {
  const u = db.users[user] ?? {};
  u.enabled  = u.enabled  ?? true;
  u.limit    = u.limit    ?? DEVICE_LIMIT;
  u.approved = u.approved ?? {};
  u.pending  = u.pending  ?? {};
  u.rejected = u.rejected ?? {};
  db.users[user] = u;
  return u;
}

function seedFromKnown(user: string, policy: UserDevicePolicy): void {
  if (Object.keys(policy.approved).length > 0) return;
  try {
    const known: Record<string, string[]> = JSON.parse(fs.readFileSync(KNOWN_IPS_FILE, 'utf8'));
    const limit = policy.limit ?? DEVICE_LIMIT;
    const now   = new Date().toISOString();
    for (const ip of (known[user] ?? []).slice(0, limit)) {
      policy.approved[ip] = { first_seen: now, last_seen: now, source: 'known_ip_seed' };
    }
  } catch {}
}

// ── Evaluate device policy ────────────────────────────────────────────────────

export async function evaluateDevicePolicy(
  user: string,
  currentIps: IpInfo[]
): Promise<DevicePolicyResult> {
  const now     = new Date().toISOString();
  const current = currentIps.map(i => i.ip).sort();
  const db      = loadDeviceDb();
  const policy  = userPolicy(db, user);
  const limit   = policy.limit ?? DEVICE_LIMIT;
  seedFromKnown(user, policy);

  // ISPs already trusted for this key (any approved IP's network). A new IP from
  // one of these is the same network = same customer (DHCP/mobile churn), so it
  // auto-trusts even past the device limit instead of nagging for approval.
  // Display stays IP-level; this is purely the "stop allow,allow,allow" brain.
  const trustedIsps = new Set(
    Object.keys(policy.approved)
      .map(ip => ipInfo(ip).isp)
      .filter(Boolean)
  );

  const newlyBlocked: string[] = [];

  for (const ip of current) {
    if (ip in policy.approved) {
      policy.approved[ip].last_seen = now;
      continue;
    }
    if (ip in policy.rejected) {
      policy.rejected[ip].last_seen = now;
      if (!policy.rejected[ip].blocked) {
        policy.rejected[ip].blocked    = true;
        policy.rejected[ip].blocked_at = now;
        newlyBlocked.push(ip);
      }
      continue;
    }
    const isp = ipInfo(ip).isp;
    if (isp && trustedIsps.has(isp)) {
      // Same network as an already-trusted IP — auto-trust regardless of limit.
      policy.approved[ip] = { first_seen: now, last_seen: now, source: 'auto_trusted_isp' };
      continue;
    }
    if (Object.keys(policy.approved).length < limit) {
      policy.approved[ip] = { first_seen: now, last_seen: now, source: 'auto_registered' };
      if (isp) trustedIsps.add(isp);
      continue;
    }
    if (!policy.pending[ip]) {
      policy.pending[ip] = { first_seen: now, last_seen: now };
    } else {
      policy.pending[ip].last_seen = now;
    }
    // Monitor only — don't auto-block. Manual blocking available from dashboard.
  }

  saveDeviceDb(db);
  if (newlyBlocked.length > 0) {
    syncDeviceBlockRoutes({
      source: 'dashboard-v3/device-policy/evaluate',
      reason: 'sync_rejected_device_routes',
      details: { user, blocked_count: newlyBlocked.length },
    });
  }

  const pendingNow  = current.filter(ip => ip in policy.pending);
  const rejectedNow = current.filter(ip => ip in policy.rejected);

  return {
    enabled:        !!policy.enabled,
    limit,
    approved:       Object.keys(policy.approved).sort(),
    approved_manual: Object.entries(policy.approved)
                       .filter(([, item]) => item.source === 'manual_approval')
                       .map(([ip]) => ip).sort(),
    pending:        Object.keys(policy.pending).sort(),
    rejected:       Object.keys(policy.rejected).sort(),
    pending_now:    pendingNow.sort(),
    rejected_now:   rejectedNow.sort(),
    approved_count: Object.keys(policy.approved).length,
    pending_count:  Object.keys(policy.pending).length,
    rejected_count: Object.keys(policy.rejected).length,
    warning:        pendingNow.length > 0 || rejectedNow.length > 0,
    approved_info:  Object.entries(policy.approved).map(([ip, item]) => ({ ...ipInfo(ip), source: item.source, firstSeen: item.first_seen, lastSeen: item.last_seen })),
    pending_info:   Object.entries(policy.pending).map(([ip, item])  => ({ ...ipInfo(ip), source: item.source, firstSeen: item.first_seen, lastSeen: item.last_seen })),
    rejected_info:  Object.entries(policy.rejected).map(([ip, item]) => ({ ...ipInfo(ip), source: item.source, firstSeen: item.first_seen, lastSeen: item.rejected_at ?? item.last_seen })),
  };
}

// ── Approve / reject / reset ──────────────────────────────────────────────────

export function approveDevice(
  user: string,
  ip: string,
  replaceOldest: boolean
): { result: { approved: string; replaced?: string } } | { error: string } {
  const now    = new Date().toISOString();
  const db     = loadDeviceDb();
  const policy = userPolicy(db, user);
  const limit  = policy.limit ?? DEVICE_LIMIT;
  let replaced: string | undefined;

  if (!(ip in policy.approved) && Object.keys(policy.approved).length >= limit) {
    if (!replaceOldest) return { error: 'Device limit is full — approve with replacement or reset first' };
    replaced = Object.entries(policy.approved)
      .sort((a, b) => a[1].first_seen.localeCompare(b[1].first_seen))[0][0];
    delete policy.approved[replaced];
  }

  delete policy.pending[ip];
  delete policy.rejected[ip];
  policy.approved[ip] = {
    first_seen: policy.approved[ip]?.first_seen ?? now,
    last_seen: now,
    source: 'manual_approval',
  };

  if (!saveDeviceDb(db)) return { error: 'Could not save device approval' };
  syncDeviceBlockRoutes({
    source: 'dashboard-v3/device-policy/approve',
    reason: 'approve_device',
    details: { user, ip, replaced },
  });
  return { result: { approved: ip, ...(replaced ? { replaced } : {}) } };
}

export function rejectDevice(
  user: string, ip: string
): { result: { rejected: string } } | { error: string } {
  const now    = new Date().toISOString();
  const db     = loadDeviceDb();
  const policy = userPolicy(db, user);
  const item: DeviceItem = policy.pending[ip] ?? { first_seen: now, last_seen: now };
  item.last_seen   = now;
  item.blocked     = true;
  item.rejected_at = now;
  delete policy.pending[ip];
  policy.rejected[ip] = item;
  if (!saveDeviceDb(db)) return { error: 'Could not save rejected device' };
  syncDeviceBlockRoutes({
    source: 'dashboard-v3/device-policy/reject',
    reason: 'reject_device',
    details: { user, ip },
  });
  return { result: { rejected: ip } };
}

export function clearDevice(
  user: string,
  ip: string
): { result: { cleared: string; removed_from: string[] } } | { error: string } {
  const db = loadDeviceDb();
  const policy = userPolicy(db, user);
  const removedFrom: string[] = [];

  if (policy.approved[ip]) {
    delete policy.approved[ip];
    removedFrom.push('approved');
  }
  if (policy.pending[ip]) {
    delete policy.pending[ip];
    removedFrom.push('pending');
  }
  if (policy.rejected[ip]) {
    delete policy.rejected[ip];
    removedFrom.push('rejected');
  }

  if (!removedFrom.length) return { error: 'Device not found' };
  if (!saveDeviceDb(db)) return { error: 'Could not save device change' };

  syncDeviceBlockRoutes({
    source: 'dashboard-v3/device-policy/clear',
    reason: 'clear_device',
    details: { user, ip, removed_from: removedFrom.join(',') },
  });

  return { result: { cleared: ip, removed_from: removedFrom } };
}

export function setDeviceLimit(
  user: string,
  limit: number
): { result: { user: string; limit: number } } | { error: string } {
  const db     = loadDeviceDb();
  const policy = userPolicy(db, user);
  // 0 (or negative) means "no explicit limit" — fall back to the DEVICE_LIMIT
  // default instead of persisting a literal 0, which evaluateDevicePolicy would
  // treat as "zero devices allowed" (every device forced to pending — an
  // accidental lockout when the modal is saved with its default 0). This
  // matches the connectionLimit convention where 0 = unlimited/default.
  policy.limit = limit > 0 ? limit : DEVICE_LIMIT;
  if (!saveDeviceDb(db)) return { error: 'Could not save device limit' };
  return { result: { user, limit: policy.limit } };
}

export function resetUserDevices(
  user: string
): { result: { reset: string; unblocked: string[] } } | { error: string } {
  const db     = loadDeviceDb();
  const policy = userPolicy(db, user);
  const blocked = [
    ...Object.keys(policy.pending),
    ...Object.keys(policy.rejected),
  ];
  policy.approved = {};
  policy.pending  = {};
  policy.rejected = {};
  if (!saveDeviceDb(db)) return { error: 'Could not reset devices' };
  syncDeviceBlockRoutes({
    source: 'dashboard-v3/device-policy/reset',
    reason: 'reset_user_devices',
    details: { user, unblocked_count: blocked.length },
  });
  return { result: { reset: user, unblocked: blocked.sort() } };
}

// ── AbuseIPDB reputation ──────────────────────────────────────────────────────

const ABUSE_CATEGORIES: Record<number, string> = {
  1:'DNS Compromise',2:'DNS Poisoning',3:'Fraud Orders',4:'DDoS',
  5:'FTP Brute-Force',6:'Ping of Death',7:'Phishing',8:'Fraud VoIP',
  9:'Open Proxy',10:'Web Spam',11:'Email Spam',12:'Blog Spam',
  13:'VPN IP',14:'Port Scan',15:'Hacking',16:'SQL Injection',
  17:'Spoofing',18:'Brute Force',19:'Bad Web Bot',20:'Exploited Host',
  21:'Web App Attack',22:'SSH Attack',23:'IoT Attack',
};

const abuseCache = new Map<string, ReputationResult | null>();

export async function checkReputation(
  ips: string[]
): Promise<Record<string, ReputationResult | null>> {
  const key = process.env.ABUSEIPDB_API_KEY ?? '';
  if (!key || !ips.length) return {};

  const need = ips.filter(ip => !abuseCache.has(ip));
  await Promise.all(need.map(async ip => {
    try {
      const res = await fetch(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90&verbose`,
        { headers: { Key: key, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) { abuseCache.set(ip, null); return; }
      const d = (await res.json() as { data: Record<string, unknown> }).data;
      const catIds = new Set<number>();
      for (const rep of (d.reports as Array<{ categories: number[] }>) ?? []) {
        rep.categories.forEach(c => catIds.add(c));
      }
      abuseCache.set(ip, {
        score:          d.abuseConfidenceScore as number,
        total_reports:  d.totalReports as number,
        distinct_users: d.numDistinctUsers as number,
        is_tor:         d.isTor as boolean,
        usage_type:     d.usageType as string,
        isp:            d.isp as string,
        domain:         d.domain as string,
        last_reported:  d.lastReportedAt as string,
        categories:     [...catIds].sort().map(c => ABUSE_CATEGORIES[c] ?? `#${c}`),
      });
    } catch {
      abuseCache.set(ip, null);
    }
  }));

  return Object.fromEntries(ips.map(ip => [ip, abuseCache.get(ip) ?? null]));
}

// Non-blocking reputation: return whatever is already cached immediately, and
// kick off a background fetch for any uncached IPs so the NEXT poll has them.
// Reputation is non-critical enrichment for the threat tables — awaiting up to
// 200 external AbuseIPDB calls (each up to a 5s timeout, and the cache is wiped
// on every container restart) inside /api/stats is what made the whole
// dashboard hang for seconds after login. This makes the response instant and
// self-warming: cold IPs simply show no reputation until the following 5s poll.
export function reputationSnapshot(
  ips: string[]
): Record<string, ReputationResult | null> {
  const uncached = ips.filter(ip => !abuseCache.has(ip));
  if (uncached.length) void checkReputation(uncached).catch(() => {});
  return Object.fromEntries(ips.map(ip => [ip, abuseCache.get(ip) ?? null]));
}
