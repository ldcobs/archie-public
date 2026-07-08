import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiRole } from '@/lib/auth';
import { writeJsonFileAtomic } from '@/lib/state-storage';

export const dynamic = 'force-dynamic';

const STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const DATA_DIR  = process.env.DATA_DIR  ?? '/app/data';

const FILES = [
  { dir: DATA_DIR,  name: 'user_meta.json' },
  { dir: STATE_DIR, name: 'device_approvals.json' },
  { dir: STATE_DIR, name: 'known_ips.json' },
  { dir: STATE_DIR, name: 'traffic_stats.json' },
  { dir: STATE_DIR, name: 'permanent_blocks.json' },
];

/** GET — export all dashboard state as a single JSON download */
export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const files: Record<string, unknown> = {};

  for (const { dir, name } of FILES) {
    const fp = path.join(dir, name);
    try {
      files[name] = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
      files[name] = null;
    }
  }

  const backup = { version: 1, exported_at: new Date().toISOString(), files };

  const body = JSON.stringify(backup, null, 2);
  const ts = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ldc-vpn-backup-${ts}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** POST — import backup JSON to restore state */
export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  try {
    const backup = await req.json();

    if (backup.version !== 1 || !backup.files) {
      return NextResponse.json({ error: 'Invalid backup format' }, { status: 400 });
    }

    const restored: string[] = [];

    for (const { dir, name } of FILES) {
      const data = backup.files[name];
      if (data === null || data === undefined) continue;
      const fp = path.join(dir, name);
      try {
        fs.mkdirSync(dir, { recursive: true });
        writeJsonFileAtomic(fp, data);
        restored.push(name);
      } catch {
        // skip files that can't be written
      }
    }

    return NextResponse.json({
      ok: true,
      restored,
      note: 'Dashboard state restored. Refresh the page to see changes.',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
