import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import { geolocateBatch, ipInfo, geo } from './geo';
import { loadKnownIps, saveKnownIps } from './devices';
import { writeJsonFileAtomic } from './state-storage';
import type { UserStat, Session, DeviceEstimate, IpInfo, TopDomainEntry } from './types';

const LOG_ACCESS = process.env.LOG_ACCESS ?? '/var/log/xray/access.log';
const STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const NEW_IP_STATE_FILE = path.join(STATE_DIR, 'new_ip_observations.json');
const TAIL_BYTES = 2_000_000;
const W_ACTIVE   = 60;
const W5         = 300;
const W24        = 86400;
const NEW_IP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_GAP = 300; // 5 min gap = new session
const IP_RE       = /^\d+\.\d+\.\d+\.\d+$/;

type NewIpState = Record<string, Record<string, string>>;

function ensureStateDir(): void {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}
}

function loadNewIpState(): NewIpState {
  try {
    return JSON.parse(fs.readFileSync(NEW_IP_STATE_FILE, 'utf8')) as NewIpState;
  } catch {
    return {};
  }
}

function saveNewIpState(state: NewIpState): void {
  ensureStateDir();
  try {
    writeJsonFileAtomic(NEW_IP_STATE_FILE, state);
  } catch {}
}

// ── Reverse DNS cache ─────────────────────────────────────────────────────────

const rdnsCache = new Map<string, string>();

function resolveHost(host: string): string {
  if (!IP_RE.test(host)) return host;
  return rdnsCache.get(host) ?? host;
}

async function reverseDnsBatch(ips: string[]): Promise<void> {
  const need = [...new Set(ips)].filter(ip => IP_RE.test(ip) && !rdnsCache.has(ip));
  if (!need.length) return;
  await Promise.allSettled(need.map(async (ip) => {
    try {
      const names = await dns.reverse(ip);
      rdnsCache.set(ip, names[0] ?? ip);
    } catch {
      rdnsCache.set(ip, ip);
    }
  }));
}

function rootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return hostname.toLowerCase();
  return parts.slice(-2).join('.');
}

function canonicalSite(hostname: string, owner: string): string | undefined {
  const source = `${hostname} ${owner}`.toLowerCase();
  if (source.includes('telegram')) return 'telegram.org';
  if (!hostname || hostname === owner) return undefined;
  if (IP_RE.test(hostname)) return undefined;
  return rootDomain(hostname);
}

function enrichTopDomain(host: string, count: number): TopDomainEntry {
  if (!IP_RE.test(host)) return { host, count, site: rootDomain(host) };
  const hostname = resolveHost(host);
  const owner = geo(host).org || geo(host).isp || undefined;
  const site = canonicalSite(hostname, owner ?? '');
  return {
    host,
    count,
    hostname: hostname !== host ? hostname : undefined,
    owner,
    site,
  };
}

function shouldHideTopDomain(entry: TopDomainEntry): boolean {
  const host = entry.host.trim().toLowerCase();
  const hostname = entry.hostname?.trim().toLowerCase() ?? '';
  const owner = entry.owner?.trim().toLowerCase() ?? '';
  const site = entry.site?.trim().toLowerCase() ?? '';

  const infraIps = new Set([
    '1.1.1.1',
    '1.0.0.1',
    '8.8.8.8',
    '8.8.4.4',
    '9.9.9.9',
    '149.112.112.112',
  ]);

  if (infraIps.has(host)) return true;

  const haystack = `${hostname} ${owner} ${site}`;
  if (haystack.includes('cloudflare dns resolver')) return true;
  if (hostname === 'one.one.one.one') return true;
  if (site === 'one.one') return true;
  if (site === 'dns.google') return true;
  if (site === 'quad9.net') return true;

  return false;
}

// ── Tail ──────────────────────────────────────────────────────────────────────

function tailFile(path: string, size = TAIL_BYTES): string[] {
  try {
    const fd = fs.openSync(path, 'r');
    const stat = fs.fstatSync(fd);
    const start = Math.max(0, stat.size - size);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n');
  } catch {
    return [];
  }
}

// Read the file backward in growing chunks until the oldest line in the buffer
// is older than `cutoffMs`, so the full time window is covered even on a large,
// unrotated log (a fixed tail misses users whose recent activity isn't latest).
function tailFileSince(path: string, cutoffMs: number): string[] {
  try {
    const fd = fs.openSync(path, 'r');
    const stat = fs.fstatSync(fd);
    const tsRe = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
    const CAP = 48_000_000; // never read more than 48MB in one pass
    let chunk = Math.min(TAIL_BYTES * 2, stat.size);
    let lines: string[] = [];
    while (true) {
      const start = Math.max(0, stat.size - chunk);
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      lines = buf.toString('utf8').split('\n');
      let oldestMs = Infinity;
      for (const l of lines) {
        const m = tsRe.exec(l);
        if (m) { oldestMs = new Date(m[1].replace('/', '-').replace('/', '-').replace(' ', 'T') + 'Z').getTime(); break; }
      }
      if (start === 0 || oldestMs <= cutoffMs || chunk >= CAP) break;
      chunk = Math.min(chunk * 2, CAP, stat.size);
    }
    fs.closeSync(fd);
    return lines;
  } catch {
    return [];
  }
}

// ── Session builder ───────────────────────────────────────────────────────────

interface LogEntry { ts: Date; ip: string; port: number; dest: string }

function buildSessions(entries: LogEntry[]): Session[] {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const segs: { start: Date; end: Date; ips: Set<string>; conns: number }[] = [];
  let cur: typeof segs[0] | null = null;

  for (const e of sorted) {
    if (!cur || (e.ts.getTime() - cur.end.getTime()) / 1000 > SESSION_GAP) {
      if (cur) segs.push(cur);
      cur = { start: e.ts, end: e.ts, ips: new Set([e.ip]), conns: 1 };
    } else {
      cur.end = e.ts;
      cur.ips.add(e.ip);
      cur.conns++;
    }
  }
  if (cur) segs.push(cur);

  return segs
    .slice(-10)
    .reverse()
    .map(s => ({
      start: s.start.toISOString(),
      end:   s.end.toISOString(),
      ips:   [...s.ips],
      conns: s.conns,
      durMin: Math.max(1, Math.floor((s.end.getTime() - s.start.getTime()) / 60000)),
    }));
}

// ── Device estimate ───────────────────────────────────────────────────────────

function buildDeviceEstimate(allEntries: LogEntry[], now: Date, blockedIps?: Set<string>, approvedIps?: Set<string>): DeviceEstimate {
  const nowMs   = now.getTime();
  // Exclude IPs the operator has already blocked/rejected — they are no longer
  // this user's active devices, so they must not keep driving the risk signal
  // (otherwise blocking the offending IP never clears the at-risk flag).
  const entries = blockedIps && blockedIps.size
    ? allEntries.filter(e => !blockedIps.has(e.ip))
    : allEntries;
  const active1 = entries.filter(e => (nowMs - e.ts.getTime()) / 1000 <= W_ACTIVE);
  const active5 = entries.filter(e => (nowMs - e.ts.getTime()) / 1000 <= W5);

  // Count distinct IP:port combos (each unique combo = likely separate device session)
  const comboNow = new Set(active1.map(e => `${e.ip}:${e.port}`));
  const combo5m  = new Set(active5.map(e => `${e.ip}:${e.port}`));

  // Peak concurrent: sliding 10-second windows, find max simultaneous IP:port pairs
  let peakToday = 0;
  if (entries.length > 0) {
    const sorted = [...entries].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i].ts.getTime() + 10_000;
      const inWindow  = new Set<string>();
      for (let j = i; j < sorted.length && sorted[j].ts.getTime() <= windowEnd; j++) {
        inWindow.add(`${sorted[j].ip}:${sorted[j].port}`);
      }
      if (inWindow.size > peakToday) peakToday = inWindow.size;
    }
  }

  // Source IPs today
  const sourceIps = [...new Set(entries.map(e => e.ip))];

  // ISP conflict: same UUID active from 2+ different ISPs simultaneously (within
  // W_ACTIVE). Blocked IPs are already gone from `active1`. An operator can also
  // vouch for a network ("Keep" = approve); the conflict only stands while at
  // least one active IP is still UN-vouched — so once every conflicting network
  // is approved or blocked, the alert clears.
  const activeIsps = [...new Set(
    active1
      .map(e => geo(e.ip).isp)
      .filter(Boolean)
  )];
  const hasUnvouched = approvedIps && approvedIps.size
    ? active1.some(e => !approvedIps.has(e.ip))
    : true;
  const ispConflict  = activeIsps.length > 1 && hasUnvouched;
  const conflictIsps = ispConflict ? activeIsps : [];

  return {
    activeNow:    comboNow.size,
    active5m:     combo5m.size,
    peakToday,
    sourceIps,
    ispConflict,
    conflictIsps,
  };
}

// ── Main parser ───────────────────────────────────────────────────────────────

export interface ParsedAccessLog {
  userStats: Map<string, {
    email: string;
    entries: LogEntry[];
    ips5m: Set<string>;
    ips24h: Set<string>;
    c5: number;
    cActive: number;
    c24: number;
    last: Date | null;
    first: Date | null;
    domains: Map<string, number>;
  }>;
  topDests:  Map<string, Map<string, number>>; // host → email → count
  recent:    { time: string; email: string; ip: string; dest: string }[];
  allIps:    Set<string>;
}

export async function parseAccessLog(
  emailUuidMap: Record<string, string>,   // email → uuid
  users: string[]                          // known emails
): Promise<ParsedAccessLog> {
  const now   = new Date();
  const nowMs = now.getTime();

  // Initialise per-user buckets
  const userStats = new Map<string, ParsedAccessLog['userStats'] extends Map<string, infer V> ? V : never>();
  for (const u of users) {
    userStats.set(u, {
      email: u,
      entries: [],
      ips5m: new Set(),
      ips24h: new Set(),
      c5: 0,
      cActive: 0,
      c24: 0,
      last: null,
      first: null,
      domains: new Map(),
    });
  }

  const topDests = new Map<string, Map<string, number>>();
  const recent:   ParsedAccessLog['recent'] = [];
  const allIps    = new Set<string>();

  const tsRe   = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
  const ipRe   = /from (?:tcp:|udp:)?(\d+\.\d+\.\d+\.\d+):(\d+)/;
  const destRe = /accepted \w+:(\S+)/;
  const emailRe = /email: (\S+)/;

  for (const line of tailFileSince(LOG_ACCESS, nowMs - W24 * 1000)) {
    const tsM = tsRe.exec(line);
    if (!tsM) continue;
    const ts  = new Date(tsM[1].replace('/', '-').replace('/', '-').replace(' ', 'T') + 'Z');
    // Xray timestamps are local server time — treat as UTC for simplicity
    const age = (nowMs - ts.getTime()) / 1000;
    if (age > W24 || age < 0) continue;

    const ipM    = ipRe.exec(line);
    const destM  = destRe.exec(line);
    const emailM = emailRe.exec(line);
    if (!ipM || !emailM) continue;

    const ip    = ipM[1];
    const port  = parseInt(ipM[2], 10);
    const email = emailM[1];
    const dest  = destM ? destM[1] : '?';
    const host  = dest.includes(':') ? dest.replace(/\[|\]/g, '').split(':').slice(0, -1).join(':') : dest;

    allIps.add(ip);

    const u = userStats.get(email);
    if (u) {
      u.c24++;
      u.ips24h.add(ip);
      u.domains.set(host, (u.domains.get(host) ?? 0) + 1);
      if (!u.last || ts > u.last) u.last = ts;
      if (!u.first || ts < u.first) u.first = ts;
      if (age <= W5) { u.c5++; u.ips5m.add(ip); }
      if (age <= W_ACTIVE) u.cActive++;
      u.entries.push({ ts, ip, port, dest });
    }

    const destMap = topDests.get(host) ?? new Map<string, number>();
    destMap.set(email, (destMap.get(email) ?? 0) + 1);
    topDests.set(host, destMap);

    if (recent.length < 60) {
      recent.push({ time: ts.toISOString(), email, ip, dest });
    }
  }

  // Geolocate all IPs
  await geolocateBatch([...allIps]);

  return { userStats, topDests, recent: recent.reverse(), allIps };
}

// ── Build UserStat objects ────────────────────────────────────────────────────

export async function buildUserStats(
  emailUuidMap: Record<string, string>,
  users: string[],
  getDevicePolicy: (email: string, ips: IpInfo[]) => ReturnType<typeof import('./devices').evaluateDevicePolicy>,
  liveIps: Set<string> = new Set()
): Promise<{ stats: UserStat[]; topDests: ParsedAccessLog['topDests']; recent: ParsedAccessLog['recent']; allIps: Set<string> }> {
  const { userStats, topDests, recent, allIps } = await parseAccessLog(emailUuidMap, users);
  const now = new Date();
  const destIps = [...new Set([...topDests.keys()].filter(host => IP_RE.test(host)))];
  await geolocateBatch(destIps);
  await reverseDnsBatch(destIps);

  // Update known IPs
  const knownIps = await loadKnownIps();
  const newIpState = loadNewIpState();
  let knownIpsChanged = false;
  let newIpStateChanged = false;

  for (const [email, u] of userStats) {
    const current = [...u.ips24h];
    const known   = new Set<string>(knownIps[email] ?? []);
    const pending = { ...(newIpState[email] ?? {}) };
    const nowIso = new Date().toISOString();

    for (const ip of current) {
      if (known.has(ip)) {
        if (pending[ip]) {
          delete pending[ip];
          newIpStateChanged = true;
        }
        continue;
      }
      if (!pending[ip]) {
        pending[ip] = nowIso;
        newIpStateChanged = true;
      }
    }

    for (const [ip, firstSeen] of Object.entries(pending)) {
      if (known.has(ip)) {
        delete pending[ip];
        newIpStateChanged = true;
        continue;
      }
      const age = Date.now() - new Date(firstSeen).getTime();
      if (!Number.isFinite(age) || age >= NEW_IP_WINDOW_MS) {
        known.add(ip);
        delete pending[ip];
        knownIpsChanged = true;
        newIpStateChanged = true;
      }
    }

    knownIps[email] = [...known].sort();
    newIpState[email] = pending;
  }
  if (knownIpsChanged) await saveKnownIps(knownIps);
  if (newIpStateChanged) saveNewIpState(newIpState);

  const stats: UserStat[] = [];
  for (const email of users) {
    const u = userStats.get(email)!;
    const uuid = emailUuidMap[email] ?? '';

    const allIps24hInfo = [...u.ips24h].map(ip => ipInfo(ip));

    const knownSet = new Set<string>(knownIps[email] ?? []);
    const pendingState = newIpState[email] ?? {};
    const newIpsSet = [...u.ips24h].filter(ip => !knownSet.has(ip) && !!pendingState[ip]);

    // Evaluate device policy with ALL IPs (so it can classify them)
    const devPolicy = await getDevicePolicy(email, allIps24hInfo);

    // Filter out rejected/pending-blocked IPs from display lists AND the risk
    // estimate. These IPs belong to someone else's device, not this user — and
    // once blocked they must stop feeding the ispConflict/at-risk signal.
    const blockedIps = new Set([
      ...devPolicy.rejected,
      ...devPolicy.pending,
    ]);
    // Only OPERATOR-vouched IPs ("Keep") silence a conflict — not the
    // auto-registered ones, which are trusted on a dumb first-come basis.
    const vouchedIps = new Set(devPolicy.approved_manual);
    const devEst    = buildDeviceEstimate(u.entries, now, blockedIps, vouchedIps);
    const ips24hInfo = allIps24hInfo.filter(ip => !blockedIps.has(ip.ip));
    const ips5mInfo  = [...u.ips5m].filter(ip => !blockedIps.has(ip)).map(ip => ipInfo(ip));

    const topDomains: TopDomainEntry[] = [...u.domains.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([host, count]) => enrichTopDomain(host, count))
      .filter((entry) => !shouldHideTopDomain(entry))
      .slice(0, 20);

    const sessions = buildSessions(u.entries);

    // Recent connection flows (Zeek vpn.log-style) — most-recent first, capped.
    // Split the parsed "host:port" dest into host + dport. Blocked IPs excluded.
    const flows = u.entries
      .slice(-300)
      .filter((e) => !blockedIps.has(e.ip))
      .map((e) => {
        let host = e.dest;
        let dport = '';
        if (e.dest.includes(':')) {
          const parts = e.dest.replace(/\[|\]/g, '').split(':');
          dport = parts[parts.length - 1];
          host = parts.slice(0, -1).join(':');
        }
        return { ts: e.ts.toISOString(), ip: e.ip, sport: e.port, host, dport };
      })
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, 100);

    // Per-IP activity from the 24h log: connection count + most-recent timestamp.
    // Merge into the device info arrays so the operator sees how active each IP is
    // and when it was last seen (device-store lastSeen is refined by the log).
    const ipAgg = new Map<string, { conns: number; last: Date }>();
    for (const e of u.entries) {
      const a = ipAgg.get(e.ip);
      if (a) { a.conns++; if (e.ts > a.last) a.last = e.ts; }
      else ipAgg.set(e.ip, { conns: 1, last: e.ts });
    }
    const enrichDeviceIps = (arr: typeof devPolicy.approved_info) => arr.map((d) => {
      const a = ipAgg.get(d.ip);
      const logLast = a ? a.last.toISOString() : undefined;
      return {
        ...d,
        conns: a?.conns ?? 0,
        lastSeen: logLast && (!d.lastSeen || logLast > d.lastSeen) ? logLast : d.lastSeen,
      };
    });
    devPolicy.approved_info = enrichDeviceIps(devPolicy.approved_info);
    devPolicy.pending_info  = enrichDeviceIps(devPolicy.pending_info);
    devPolicy.rejected_info = enrichDeviceIps(devPolicy.rejected_info);

    // Treat stale TCP sockets as offline if there has been no recent Xray activity.
    const userLiveIps = [...u.ips24h].filter(ip => liveIps.has(ip) && !blockedIps.has(ip));
    const lastActivityAgeSec = u.last ? (now.getTime() - u.last.getTime()) / 1000 : Infinity;
    let status: UserStat['status'] = 'offline';
    if (userLiveIps.length > 0 && lastActivityAgeSec <= W_ACTIVE) status = 'online';
    else if (lastActivityAgeSec <= W5) status = 'recent';

    stats.push({
      uuid,
      email,
      meta: null,           // filled in by stats route from user-meta
      vpnProtocol: null,    // filled in by stats route from xray config
      online: status === 'online',
      status,
      ips: ips5mInfo,
      ips_24h: ips24hInfo,
      conns_5m: u.c5,
      conns_24h: u.c24,
      last_seen:  u.last?.toISOString()  ?? null,
      first_seen: u.first?.toISOString() ?? null,
      top_domains: topDomains,
      sessions,
      new_ips: [...new Set(newIpsSet)],
      flows,
      devices: devPolicy,
      deviceEstimate: devEst,
      traffic: null,        // filled in by stats route
      expired: false,       // filled in by stats route
      expiredReason: undefined,
    });
  }

  return { stats, topDests, recent, allIps };
}

// ── Unique IPs per hour (for sparkline) ───────────────────────────────────────
export function getUniqueIpsHourly(): { h: number; n: number }[] {
  const now = new Date();
  const nowMs = now.getTime();
  const buckets = Array.from({ length: 24 }, () => new Set<string>());
  const tsRe = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
  const ipRe = /from (?:tcp:|udp:)?(\d+\.\d+\.\d+\.\d+):\d+/;
  for (const line of tailFileSince(LOG_ACCESS, nowMs - W24 * 1000)) {
    const tsM = tsRe.exec(line);
    if (!tsM) continue;
    const ts = new Date(tsM[1].replace('/', '-').replace('/', '-').replace(' ', 'T') + 'Z');
    const age = (nowMs - ts.getTime()) / 1000;
    if (age > W24 || age < 0) continue;
    const ipM = ipRe.exec(line);
    if (!ipM) continue;
    const b = 23 - Math.floor(age / 3600);
    if (b >= 0 && b < 24) buckets[b].add(ipM[1]);
  }
  return buckets.map((s, h) => ({ h, n: s.size }));
}

// ── Prev-24h count (for trend %) ──────────────────────────────────────────────

export function getPrev24hCount(): number {
  const W24 = 86400;
  const W48 = 86400 * 2;
  const now = new Date();
  const nowMs = now.getTime();
  let count = 0;
  const tsRe = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
  for (const line of tailFile(LOG_ACCESS, 4_000_000)) {
    const tsM = tsRe.exec(line);
    if (!tsM) continue;
    const ts = new Date(tsM[1].replace('/', '-').replace('/', '-').replace(' ', 'T') + 'Z');
    const age = (nowMs - ts.getTime()) / 1000;
    if (age <= W24 || age > W48) continue;
    count++;
  }
  return count;
}

// ── Hourly connection buckets (for chart) ─────────────────────────────────────

export function getHourlyBuckets(): { h: number; n: number }[] {
  const now   = new Date();
  const nowMs = now.getTime();
  const buckets = new Array<number>(24).fill(0);

  const tsRe = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;

  for (const line of tailFileSince(LOG_ACCESS, nowMs - W24 * 1000)) {
    const tsM = tsRe.exec(line);
    if (!tsM) continue;
    const ts  = new Date(tsM[1].replace('/', '-').replace('/', '-').replace(' ', 'T') + 'Z');
    const age = (nowMs - ts.getTime()) / 1000;
    if (age > W24 || age < 0) continue;
    const bucket = 23 - Math.floor(age / 3600);
    if (bucket >= 0 && bucket < 24) buckets[bucket]++;
  }

  return buckets.map((n, h) => ({ h, n }));
}
