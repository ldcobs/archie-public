import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import {
  loadAuthUsers, createAuthUser,
  type AuthRole,
} from '@/lib/auth-users';

// GET — list all dashboard accounts (owner only)
export async function GET(req: NextRequest) {
  const check = requireApiRole(req, 'owner');
  if ('response' in check) return check.response;

  const users = loadAuthUsers().map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    disabled: u.disabled ?? false,
  }));
  return NextResponse.json(users);
}

// POST — create a new dashboard account (owner only)
export async function POST(req: NextRequest) {
  const check = requireApiRole(req, 'owner');
  if ('response' in check) return check.response;

  const body = await req.json().catch(() => ({}));
  const result = createAuthUser({
    username: String(body.username ?? ''),
    displayName: String(body.displayName ?? ''),
    password: String(body.password ?? ''),
    role: (body.role as AuthRole) ?? 'viewer',
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safe } = result.user;
  return NextResponse.json(safe, { status: 201 });
}
