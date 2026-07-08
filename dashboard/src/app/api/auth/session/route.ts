import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserFromRequest } from '@/lib/auth';
import { hasAnyAuthUsers } from '@/lib/auth-users';

export async function GET(req: NextRequest) {
  const user = getSessionUserFromRequest(req);
  return NextResponse.json({
    setupRequired: !hasAnyAuthUsers(),
    authenticated: !!user,
    user: user ? {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    } : null,
  });
}
