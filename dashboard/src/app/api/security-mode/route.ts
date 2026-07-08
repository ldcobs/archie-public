import { NextRequest, NextResponse } from 'next/server';
import { getProtectionMode, setProtectionMode, type ProtectionMode } from '@/lib/security-policy';
import { requireApiRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function isProtectionMode(value: unknown): value is ProtectionMode {
  return value === 'temp-ban' || value === 'permanent-deny';
}

export async function GET() {
  return NextResponse.json({ mode: getProtectionMode() });
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'operator');
  if ('response' in auth) return auth.response;

  try {
    const body = await req.json() as { mode?: unknown };
    if (!isProtectionMode(body.mode)) {
      return NextResponse.json({ error: 'Invalid protection mode' }, { status: 400 });
    }
    return NextResponse.json(setProtectionMode(body.mode));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
