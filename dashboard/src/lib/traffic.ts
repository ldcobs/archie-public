import fs from 'fs';
import path from 'path';
import type { TrafficStats, UserMeta } from './types';
import { writeJsonFileAtomic } from './state-storage';
import { getDb } from './db';

const STATE_DIR   = process.env.STATE_DIR ?? '/app/vpn-api';
const TRAFFIC_FILE = path.join(STATE_DIR, 'traffic_stats.json');

interface TrafficDb {
  users: Record<string, { up: number; down: number; last_updated: string; reset_at: string }>;
  collected_at: string;
}

/** Read accumulated traffic stats from the host-collected JSON */
export function loadTrafficStats(): Record<string, TrafficStats> {
  try {
    const raw: TrafficDb = JSON.parse(fs.readFileSync(TRAFFIC_FILE, 'utf8'));
    const result: Record<string, TrafficStats> = {};
    for (const [email, data] of Object.entries(raw.users ?? {})) {
      result[email] = {
        up:      data.up ?? 0,
        down:    data.down ?? 0,
        total:   (data.up ?? 0) + (data.down ?? 0),
        resetAt: data.reset_at ?? '',
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Accumulated traffic per email over the last `days` days, from the persistent
 * traffic_daily table. Unlike loadTrafficStats() (live host counters), this is
 * NOT reset by Xray restarts, so it reflects real usage over the window.
 */
export function loadTrafficStatsWindow(days = 30): Record<string, TrafficStats> {
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = getDb().prepare(
      'SELECT email, SUM(upload) AS up, SUM(download) AS down FROM traffic_daily WHERE day >= ? GROUP BY email'
    ).all(cutoff) as { email: string; up: number; down: number }[];
    const result: Record<string, TrafficStats> = {};
    for (const r of rows) {
      const up = r.up ?? 0, down = r.down ?? 0;
      result[r.email] = { up, down, total: up + down, resetAt: cutoff };
    }
    return result;
  } catch {
    return {};
  }
}

/** Check if a key is expired by time */
export function isTimeExpired(meta: UserMeta | null): boolean {
  if (!meta?.expiresAt) return false;
  return new Date(meta.expiresAt).getTime() < Date.now();
}

/** Check if a key is over its traffic quota */
export function isTrafficExceeded(meta: UserMeta | null, traffic: TrafficStats | null): boolean {
  if (!meta?.trafficLimitGB || !traffic) return false;
  const limitBytes = meta.trafficLimitGB * 1e9;
  return traffic.total >= limitBytes;
}

/** Format bytes to human-readable string */
export function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Reset traffic stats for a user (writes to the traffic JSON) */
export function resetTrafficForUser(email: string): boolean {
  try {
    const raw: TrafficDb = JSON.parse(fs.readFileSync(TRAFFIC_FILE, 'utf8'));
    if (raw.users?.[email]) {
      raw.users[email].up = 0;
      raw.users[email].down = 0;
      raw.users[email].reset_at = new Date().toISOString();
    }
    writeJsonFileAtomic(TRAFFIC_FILE, raw);
    return true;
  } catch {
    return false;
  }
}
