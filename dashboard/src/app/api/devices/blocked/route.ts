import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiRole } from '@/lib/auth';
import { ipInfo } from '@/lib/geo';
import { writeJsonFileAtomic } from '@/lib/state-storage';
import { syncDeviceBlockRoutes } from '@/lib/xray-config';

const STATE_DIR   = process.env.STATE_DIR ?? '/app/vpn-api';
const DEVICE_FILE = path.join(STATE_DIR, 'device_approvals.json');

interface DeviceItem {
  first_seen: string;
  last_seen: string;
  blocked?: boolean;
  blocked_at?: string;
  rejected_at?: string;
}

function loadDeviceDb() {
  try {
    return JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
  } catch { return { users: {} }; }
}

function saveDeviceDb(db: Record<string, unknown>) {
  writeJsonFileAtomic(DEVICE_FILE, db);
}

/** GET /api/devices/blocked — list all rejected + pending-blocked devices */
export async function GET() {
  const db = loadDeviceDb();
  const entries: Record<string, unknown>[] = [];

  for (const [email, policy] of Object.entries(db.users ?? {} as Record<string, Record<string, Record<string, DeviceItem>>>)) {
    const p = policy as { rejected?: Record<string, DeviceItem>; pending?: Record<string, DeviceItem> };
    for (const [ip, item] of Object.entries(p.rejected ?? {})) {
      entries.push({
        email, ip, status: 'rejected', ...item, geo: ipInfo(ip),
      });
    }
    for (const [ip, item] of Object.entries(p.pending ?? {})) {
      if (item.blocked) {
        entries.push({
          email, ip, status: 'pending_blocked', ...item, geo: ipInfo(ip),
        });
      }
    }
  }

  // Sort newest first
  entries.sort((a, b) => String(b.last_seen ?? '').localeCompare(String(a.last_seen ?? '')));
  return NextResponse.json({ blocked: entries });
}

/** DELETE /api/devices/blocked?email=alex&ip=1.2.3.4 — remove from rejected/pending and unblock */
export async function DELETE(req: NextRequest) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const email = req.nextUrl.searchParams.get('email');
  const ip    = req.nextUrl.searchParams.get('ip');
  if (!email || !ip) return NextResponse.json({ error: 'email and ip required' }, { status: 400 });

  const db = loadDeviceDb();
  const policy = db.users?.[email];
  if (!policy) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let removed = false;
  if (policy.rejected?.[ip]) { delete policy.rejected[ip]; removed = true; }
  if (policy.pending?.[ip])  { delete policy.pending[ip];  removed = true; }

  if (!removed) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  saveDeviceDb(db);
  syncDeviceBlockRoutes({
    source: 'dashboard-v3/api/devices/blocked',
    reason: 'clear_blocked_device',
    details: { user: email, ip },
  });
  return NextResponse.json({ deleted: { email, ip } });
}
