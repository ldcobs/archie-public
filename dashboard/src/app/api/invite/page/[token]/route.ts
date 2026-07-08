import { NextResponse } from 'next/server';
import { getInvitePageData } from '@/lib/invite-tokens';
import { inviteBaseUrl } from '@/lib/invite-url';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const baseUrl = inviteBaseUrl(req);
  const data = getInvitePageData(token, baseUrl);
  if (!data) return NextResponse.json({ error: 'Invalid invite link.' }, { status: 404 });
  return NextResponse.json(data);
}
