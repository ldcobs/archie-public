import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { deleteInviteToken } from '@/lib/invite-tokens';

// Remove an invite from the list (cleanup — does not affect a provisioned user's key).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;
  const { token } = await params;
  const ok = deleteInviteToken(token);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
