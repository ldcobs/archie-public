import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { userProtocolMembership, emailToUuid } from '@/lib/xray-config';
import { getMetaByUuid, upsertMeta } from '@/lib/user-meta';

// One-shot, idempotent migration: set each user's meta.protocols to their CURRENT
// actual inbound membership. Makes the assigned-protocols model consistent with
// the live config so editing a legacy user's protocols never silently strips
// access. Only fills protocols that aren't already set; safe to run repeatedly.
export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const membership = userProtocolMembership();
  const map = emailToUuid();
  const applied: { email: string; protocols: string[] }[] = [];
  const skipped: { email: string; reason: string }[] = [];

  for (const [email, protocols] of Object.entries(membership)) {
    const uuid = map[email] ?? map[email.toLowerCase()];
    if (!uuid) { skipped.push({ email, reason: 'no uuid' }); continue; }
    const existing = getMetaByUuid(uuid);
    if (existing?.protocols?.length) { skipped.push({ email, reason: 'already set' }); continue; }
    const unique = [...new Set(protocols)].sort();
    upsertMeta(uuid, { protocols: unique });
    applied.push({ email, protocols: unique });
  }

  return NextResponse.json({ ok: true, applied, skipped });
}
