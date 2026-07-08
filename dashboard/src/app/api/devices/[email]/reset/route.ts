import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { resetUserDevices, setDeviceLimit } from '@/lib/devices';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  const { email } = await params;
  const body = await req.json().catch(() => ({}));

  // The Edit Limits modal calls this endpoint to SET the device limit — it
  // was previously ignored entirely, silently discarding the value and
  // always performing a full device wipe instead. Only do the destructive
  // reset when no limit is given.
  if (typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit >= 0) {
    const result = setDeviceLimit(email, body.limit);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result.result);
  }

  const result = resetUserDevices(email);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.result);
}
