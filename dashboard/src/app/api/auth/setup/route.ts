import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie } from '@/lib/auth';
import { createAuthUser, hasAnyAuthUsers } from '@/lib/auth-users';

export async function POST(req: NextRequest) {
  if (hasAnyAuthUsers()) {
    return NextResponse.json({ error: 'Authentication already configured' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const displayName = String(body.displayName ?? '').trim();
  const password = String(body.password ?? '');

  const created = createAuthUser({
    username,
    displayName,
    password,
    role: 'owner',
  });

  if ('error' in created) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const response = NextResponse.json({
    ok: true,
    user: {
      username: created.user.username,
      displayName: created.user.displayName,
      role: created.user.role,
    },
  });
  return attachSessionCookie(response, created.user);
}
