import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { emailToUuid, vlessUri } from '@/lib/xray-config';
import { findMockUser, shouldServeMockData } from '@/lib/mock-data';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  // Returns the user's full VLESS URI (their connection credential). Was only
  // behind middleware's cookie-presence check; enforce a real session here.
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  const { email } = await params;
  const url = new URL(req.url);
  const map  = emailToUuid();
  const mockUser = shouldServeMockData(url.host) ? findMockUser(email) : null;
  const resolvedEmail = mockUser?.email ?? email;
  const uuid = map[email] ?? map[email.toLowerCase()] ?? mockUser?.uuid;

  if (!uuid) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ email: resolvedEmail, uuid, uri: vlessUri(uuid, resolvedEmail) });
}
