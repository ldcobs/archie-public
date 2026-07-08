import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { getMetaByUuid, upsertMeta } from '@/lib/user-meta';
import { syncUserAcrossInbounds, uuidToEmail } from '@/lib/xray-config';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const auth = requireApiRole(_req, 'admin');
  if ('response' in auth) return auth.response;

  const { uuid } = await params;
  const meta = getMetaByUuid(uuid);
  if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(meta);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const { uuid } = await params;
  const body = await req.json().catch(() => ({}));
  const meta = upsertMeta(uuid, {
    displayName:    body.displayName,
    group:          body.group,
    isOwner:        body.isOwner,
    expectedIsps:   body.expectedIsps,
    notes:          body.notes,
    expiresAt:       body.expiresAt,
    trafficLimitGB:  body.trafficLimitGB,
    connectionLimit: body.connectionLimit,
    protocols:       Array.isArray(body.protocols) ? body.protocols : undefined,
    // Sharing-policy fields the limits editor sends — were previously dropped here,
    // so every policy change (unknown-device / new-country / new-ISP / overflow)
    // silently no-op'd. upsertMeta only overwrites keys that are not undefined.
    unknownDevice:   body.unknownDevice,
    newCountry:      body.newCountry,
    newIsp:          body.newIsp,
    overflowAction:  body.overflowAction,
  });

  // When the assigned protocols change, reconcile inbound membership. A disabled
  // key stays removed from every inbound (sync to []) until it's re-enabled.
  if (Array.isArray(body.protocols)) {
    const email = uuidToEmail()[uuid];
    if (email) {
      syncUserAcrossInbounds(uuid, email, meta.disabled ? [] : meta.protocols ?? [], 'dashboard-v3/api/meta');
    }
  }

  return NextResponse.json(meta);
}
