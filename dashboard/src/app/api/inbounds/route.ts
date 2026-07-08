import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createInbound, getManagedInbounds } from '@/lib/inbound-config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  try {
    const { inbounds, configPath, writable } = getManagedInbounds();
    return NextResponse.json({ ok: true, inbounds, configPath, writable });
  } catch (err) {
    return NextResponse.json({ ok: false, inbounds: [], error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  try {
    const body = await req.json() as { inbound?: Record<string, unknown> };
    if (!body?.inbound) {
      return NextResponse.json({ error: 'Missing inbound payload' }, { status: 400 });
    }
    const inbound = createInbound(body.inbound);
    return NextResponse.json({ ok: true, inbound }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
