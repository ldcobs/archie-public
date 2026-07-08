import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { runEnforcement, runConnectionLimitEnforcement } from '@/lib/traffic-enforce';

export const dynamic = 'force-dynamic';

const VPN_API_URL   = process.env.VPN_API_URL        ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN   ?? '';

// ── Ingest sample from vpn-api ────────────────────────────────────────────────

async function ingestSample(): Promise<{ sampled: number }> {
  const res = await fetch(`${VPN_API_URL}/vpn-api/traffic`, {
    headers: { Authorization: `Bearer ${VPN_API_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return { sampled: 0 };

  const { daily } = await res.json() as { daily: Record<string, Record<string, { up: number; down: number }>> };

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO traffic_daily (email, day, upload, download)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (email, day) DO UPDATE SET
      upload   = MAX(upload, excluded.upload),
      download = MAX(download, excluded.download)
  `);

  let count = 0;
  db.transaction(() => {
    for (const [day, users] of Object.entries(daily)) {
      for (const [email, d] of Object.entries(users)) {
        upsert.run(email, day, d.up ?? 0, d.down ?? 0);
        count++;
      }
    }
  })();

  // Run enforcement after every ingest
  runEnforcement().catch(() => {});
  runConnectionLimitEnforcement().catch(() => {});

  return { sampled: count };
}

// ── GET /api/traffic — return per-user daily history ─────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(req, 'viewer');
  if (auth instanceof NextResponse) return auth;

  const url   = new URL(req.url);
  const email = url.searchParams.get('email');
  const days  = Math.min(Number(url.searchParams.get('days') ?? 30), 90);

  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const db = getDb();

  if (email) {
    const rows = db.prepare(
      'SELECT day, upload, download FROM traffic_daily WHERE email = ? AND day >= ? ORDER BY day'
    ).all(email, since) as { day: string; upload: number; download: number }[];
    return NextResponse.json({ email, rows });
  }

  // All users: sum per user over the period
  const rows = db.prepare(`
    SELECT email,
           SUM(upload)   AS total_up,
           SUM(download) AS total_down,
           MAX(day)      AS last_day
    FROM traffic_daily
    WHERE day >= ?
    GROUP BY email
    ORDER BY (total_up + total_down) DESC
  `).all(since) as { email: string; total_up: number; total_down: number; last_day: string }[];

  return NextResponse.json({ rows, days, since });
}

// ── POST /api/traffic/sample — trigger a manual ingest ───────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(req, 'operator');
  if (auth instanceof NextResponse) return auth;

  const result = await ingestSample();
  return NextResponse.json(result);
}

export { ingestSample };

// ── PUT /api/traffic — manual enforcement run ─────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(req, 'operator');
  if (auth instanceof NextResponse) return auth;

  const actions = await runEnforcement();
  return NextResponse.json({ actions });
}
