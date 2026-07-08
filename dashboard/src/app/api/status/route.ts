import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { requireApiRole } from '@/lib/auth';
import { listAllClients as listClients } from '@/lib/xray-config';
import { getActiveIps } from '@/lib/live-connections';

export const dynamic = 'force-dynamic';

/**
 * Lightweight status endpoint — returns ONLY online/offline per user.
 * Designed for fast polling (every 5s).
 *
 * Combines two signals to avoid stale-TCP false positives:
 *  1. Live TCP table (kernel) — who has an open socket on port 443
 *  2. Recent Xray access log — last activity timestamp per user
 *
 * A user is ONLINE only if they have a live TCP connection AND
 * log activity within the last STALE_THRESHOLD seconds.
 * This prevents showing "online" for hours after an ungraceful disconnect.
 */

const LOG_ACCESS      = process.env.LOG_ACCESS ?? '/var/log/xray/access.log';
const TAIL_SIZE       = 2_000_000; // keep parity with full stats parser so online mapping does not lag
const STALE_THRESHOLD = 120;     // 2 minutes — if no log activity, TCP is stale


/**
 * Read recent log: build IP→email mapping AND track last-seen timestamp per email.
 */
function parseRecentLog(): { ipMap: Map<string, string>; lastActivity: Map<string, Date> } {
  const ipMap       = new Map<string, string>();
  const lastActivity = new Map<string, Date>();

  try {
    const fd   = fs.openSync(LOG_ACCESS, 'r');
    const stat = fs.fstatSync(fd);
    const start = Math.max(0, stat.size - TAIL_SIZE);
    const buf   = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);

    const tsRe    = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
    const ipRe    = /from (?:tcp:|udp:)?(\d+\.\d+\.\d+\.\d+):/;
    const emailRe = /email: (\S+)/;

    for (const line of buf.toString('utf8').split('\n')) {
      const ipM    = ipRe.exec(line);
      const emailM = emailRe.exec(line);
      if (!ipM || !emailM) continue;

      const email = emailM[1];
      ipMap.set(ipM[1], email);

      // Parse timestamp for last-activity tracking
      const tsM = tsRe.exec(line);
      if (tsM) {
        const ts = new Date(tsM[1].replace(/\//g, '-').replace(' ', 'T') + 'Z');
        const prev = lastActivity.get(email);
        if (!prev || ts > prev) lastActivity.set(email, ts);
      }
    }
  } catch {
    // Log not available
  }
  return { ipMap, lastActivity };
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  try {
    const now      = Date.now();
    const clients  = listClients();
    const emails   = clients.map(c => c.email);
    const liveIps  = getActiveIps();
    const { ipMap, lastActivity } = parseRecentLog();

    // Map live TCP IPs to emails
    const tcpOnline = new Set<string>();
    for (const ip of liveIps) {
      const email = ipMap.get(ip);
      if (email && emails.includes(email)) {
        tcpOnline.add(email);
      }
    }

    const users = emails.map(email => {
      const hasTcp    = tcpOnline.has(email);
      const lastTs    = lastActivity.get(email);
      const ageSec    = lastTs ? (now - lastTs.getTime()) / 1000 : Infinity;
      const online = hasTcp && ageSec <= STALE_THRESHOLD;

      return { email, online };
    });

    return NextResponse.json(
      { users, ts: now },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache' } }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
