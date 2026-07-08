import fs from 'fs';
import { geolocateBatch, geo, flag } from './geo';
import type { ThreatEntry, Fail2banEntry } from './types';

const LOG_AUTH = process.env.LOG_AUTH ?? '/var/log/auth.log';
const LOG_F2B  = process.env.LOG_F2B  ?? '/var/log/fail2ban.log';

function tailFile(path: string, size: number): string[] {
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

// Read current log + rotated .1 (logrotate runs at midnight — without this,
// the threat window loses all of yesterday's data every morning).
function tailWithRotated(path: string, size: number): string[] {
  const rotated = tailFile(`${path}.1`, size);
  const current = tailFile(path, size);
  return rotated.concat(current);
}

const SSH_WINDOW_DEFAULT = 7 * 86400;

export async function parseSshThreats(windowSeconds = SSH_WINDOW_DEFAULT): Promise<ThreatEntry[]> {
  const now = new Date();
  const nowMs = now.getTime();
  const year = now.getUTCFullYear();
  const counts = new Map<string, number>();
  const lastSeen = new Map<string, Date>();

  const isoRe = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
  const sysRe = /^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/;
  const ipRe = /(?:Failed \S+ for (?:invalid user )?\S+ from|Invalid user \S+ from) (\d+\.\d+\.\d+\.\d+)/;
  const repRe = /message repeated (\d+) times/;
  const userRe = /(?:Invalid user|Failed \S+ for invalid user|Failed \S+ for) (\S+) from (\d+\.\d+\.\d+\.\d+)/;
  const offerRe = /Unable to negotiate with (\d+\.\d+\.\d+\.\d+) port \d+: no matching [\w\s]+ found\. Their offer: (\S+)/;
  const usersByIp = new Map<string, Map<string, number>>();
  const offersByIp = new Map<string, Set<string>>();

  for (const line of tailWithRotated(LOG_AUTH, 20_000_000)) {
    let ts: Date | null = null;
    const isoM = isoRe.exec(line);
    const sysM = sysRe.exec(line);
    try {
      if (isoM) {
        ts = new Date(isoM[1] + 'Z');
      } else if (sysM) {
        ts = new Date(`${sysM[1]} ${year} UTC`);
        if (ts > now) ts = new Date(`${sysM[1]} ${year - 1} UTC`);
      }
    } catch {
      continue;
    }

    if (!ts || (nowMs - ts.getTime()) / 1000 > windowSeconds) continue;

    const userM = userRe.exec(line);
    if (userM) {
      const m = usersByIp.get(userM[2]) ?? new Map<string, number>();
      m.set(userM[1], (m.get(userM[1]) ?? 0) + 1);
      usersByIp.set(userM[2], m);
    }
    const offerM = offerRe.exec(line);
    if (offerM) {
      const s = offersByIp.get(offerM[1]) ?? new Set<string>();
      s.add(offerM[2]);
      offersByIp.set(offerM[1], s);
    }

    const ipM = ipRe.exec(line);
    if (!ipM) continue;
    const repM = repRe.exec(line);
    const count = repM ? parseInt(repM[1], 10) : 1;
    const ip = ipM[1];
    counts.set(ip, (counts.get(ip) ?? 0) + count);
    const prev = lastSeen.get(ip);
    if (!prev || ts > prev) lastSeen.set(ip, ts);
  }

  // Sort by most recently seen, fall back to highest count
  const threats = [...counts.entries()]
    .sort((a, b) => {
      const tA = lastSeen.get(a[0])?.getTime() ?? 0;
      const tB = lastSeen.get(b[0])?.getTime() ?? 0;
      return tB - tA || b[1] - a[1];
    })
    .slice(0, 200);

  await geolocateBatch(threats.map(([ip]) => ip));

  return threats.map(([ip, count]) => {
    const tried = usersByIp.get(ip);
    const users = tried
      ? [...tried.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([u, c]) => (c > 1 ? `${u} ×${c}` : u))
      : [];
    return {
      ip,
      count,
      last_seen: (lastSeen.get(ip) ?? now).toISOString(),
      banned: false,
      perm_blocked: false,
      reputation: null,
      attempts: { users, offers: [...(offersByIp.get(ip) ?? [])].slice(0, 5) },
      flag: flag(geo(ip).cc),
      ...geo(ip),
    };
  });
}

export async function parseFail2ban(): Promise<Fail2banEntry[]> {
  interface BanEvent { banned_at: Date; unbanned_at: Date | null; jail: string }
  const history = new Map<string, BanEvent[]>();
  const pending = new Map<string, BanEvent>();

  const tsRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
  const banRe = /NOTICE\s+\[(\w+)\] Ban (\d+\.\d+\.\d+\.\d+)/;
  const unbanRe = /NOTICE\s+\[(\w+)\] Unban (\d+\.\d+\.\d+\.\d+)/;

  for (const line of tailWithRotated(LOG_F2B, 1_000_000)) {
    const tsM = tsRe.exec(line);
    if (!tsM) continue;
    let ts: Date;
    try {
      ts = new Date(tsM[1].replace(' ', 'T') + 'Z');
    } catch {
      continue;
    }

    const banM = banRe.exec(line);
    const unbanM = unbanRe.exec(line);

    if (banM) {
      const [, jail, ip] = banM;
      pending.set(ip, { banned_at: ts, unbanned_at: null, jail });
    } else if (unbanM) {
      const ip = unbanM[2];
      const ev = pending.get(ip);
      if (ev) {
        ev.unbanned_at = ts;
        const arr = history.get(ip) ?? [];
        arr.push(ev);
        history.set(ip, arr);
        pending.delete(ip);
      }
    }
  }

  for (const [ip, ev] of pending) {
    const arr = history.get(ip) ?? [];
    arr.push(ev);
    history.set(ip, arr);
  }

  await geolocateBatch([...history.keys()]);

  return [...history.entries()]
    .sort((a, b) => {
      const aL = a[1][a[1].length - 1].banned_at.getTime();
      const bL = b[1][b[1].length - 1].banned_at.getTime();
      return bL - aL;
    })
    .map(([ip, events]) => {
      const latest = events[events.length - 1];
      const banCount = events.length;
      const active = latest.unbanned_at === null;
      const nextWeeks = Math.min(Math.pow(2, banCount), 52);
      return {
        ip,
        jail: latest.jail,
        ban_count: banCount,
        next_weeks: nextWeeks,
        banned_at: latest.banned_at.toISOString(),
        unbanned_at: latest.unbanned_at?.toISOString() ?? null,
        active,
        perm_blocked: false,
        reputation: null,
        flag: flag(geo(ip).cc),
        ...geo(ip),
      };
    });
}

export function getBannedIps(bans: Fail2banEntry[]): Set<string> {
  return new Set(bans.filter((b) => b.active).map((b) => b.ip));
}

export function getSshHourly(): { h: number; n: number }[] {
  const window24h = 86400;
  const now = new Date();
  const nowMs = now.getTime();
  const year = now.getUTCFullYear();
  const buckets = new Array<number>(24).fill(0);
  const isoRe = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
  const sysRe = /^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/;
  const failRe = /sshd.*(?:Invalid user|Failed \w+ for)/;
  for (const line of tailWithRotated(LOG_AUTH, 20_000_000)) {
    if (!failRe.test(line)) continue;
    let ts: Date | null = null;
    try {
      const isoM = isoRe.exec(line);
      const sysM = sysRe.exec(line);
      if (isoM) ts = new Date(isoM[1] + 'Z');
      else if (sysM) {
        ts = new Date(`${sysM[1]} ${year} UTC`);
        if (ts > now) ts = new Date(`${sysM[1]} ${year - 1} UTC`);
      }
    } catch {
      continue;
    }
    if (!ts) continue;
    const age = (nowMs - ts.getTime()) / 1000;
    if (age > window24h || age < 0) continue;
    const b = 23 - Math.floor(age / 3600);
    if (b >= 0 && b < 24) buckets[b]++;
  }
  return buckets.map((n, h) => ({ h, n }));
}
