import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { loadAuthUsers, saveAuthUsers, type AuthRole } from '@/lib/auth-users';
import { randomBytes, scryptSync } from 'crypto';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = requireApiRole(req, 'owner');
  if ('response' in check) return check.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const users = loadAuthUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.role) users[idx].role = body.role as AuthRole;
  if (body.displayName) users[idx].displayName = String(body.displayName).trim();
  if (typeof body.disabled === 'boolean') users[idx].disabled = body.disabled;
  if (body.password) {
    const salt = randomBytes(16).toString('hex');
    users[idx].passwordSalt = salt;
    users[idx].passwordHash = scryptSync(String(body.password), salt, 64).toString('hex');
  }

  if (!saveAuthUsers(users)) return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safe } = users[idx];
  return NextResponse.json(safe);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = requireApiRole(req, 'owner');
  if ('response' in check) return check.response;

  const { id } = await params;
  const users = loadAuthUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Never delete the last owner
  const isOwner = users[idx].role === 'owner';
  if (isOwner && users.filter(u => u.role === 'owner' && !u.disabled).length <= 1) {
    return NextResponse.json({ error: 'Cannot remove the last owner account' }, { status: 400 });
  }

  users.splice(idx, 1);
  if (!saveAuthUsers(users)) return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
