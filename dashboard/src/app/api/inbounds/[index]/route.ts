import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { deleteInbound, updateInbound } from '@/lib/inbound-config';

export const dynamic = 'force-dynamic';

function parseIndex(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const { index: rawIndex } = await params;
  const index = parseIndex(rawIndex);
  if (index === null) {
    return NextResponse.json({ error: 'Invalid inbound index' }, { status: 400 });
  }

  try {
    const body = await req.json() as { inbound?: Record<string, unknown> };
    if (!body?.inbound) {
      return NextResponse.json({ error: 'Missing inbound payload' }, { status: 400 });
    }
    const inbound = updateInbound(index, body.inbound);
    return NextResponse.json({ ok: true, inbound });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const { index: rawIndex } = await params;
  const index = parseIndex(rawIndex);
  if (index === null) {
    return NextResponse.json({ error: 'Invalid inbound index' }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, ...deleteInbound(index) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
