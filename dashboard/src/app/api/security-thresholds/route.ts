import { NextRequest, NextResponse } from 'next/server';
import { getSecurityThresholds, setSecurityThresholds } from '@/lib/security-thresholds';
import { requireApiRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getSecurityThresholds());
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  try {
    const body = await req.json() as Record<string, unknown>;
    return NextResponse.json(setSecurityThresholds(body));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
