import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie } from '@/lib/auth';
import { getAuthUserByUsername, hasAnyAuthUsers, verifyPassword } from '@/lib/auth-users';

export async function POST(req: NextRequest) {
  if (!hasAnyAuthUsers()) {
    return NextResponse.json({ error: 'Authentication setup required' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const user = getAuthUserByUsername(username);

  if (!user || user.disabled || !verifyPassword(password, user)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    user: { username: user.username, displayName: user.displayName, role: user.role },
  });
  return attachSessionCookie(response, user);
}
