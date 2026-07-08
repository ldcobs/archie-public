import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { rotateUserUuid, emailToUuid } from '@/lib/xray-config';
import { renameMetaUuid } from '@/lib/user-meta';
import { serverConfig } from '@/lib/server-config';

// Rotate / regenerate a key: assigns a new UUID across all the user's inbounds
// (old links die) and migrates the user_meta row to the new UUID.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  const oldUuid = emailToUuid()[email];

  const r = rotateUserUuid(email, 'dashboard-v3/api/users/rotate');
  if (!r.ok || !r.newUuid) {
    return NextResponse.json({ error: r.error ?? 'Rotation failed' }, { status: 400 });
  }
  if (oldUuid) renameMetaUuid(oldUuid, r.newUuid);

  return NextResponse.json({
    ok: true,
    uuid: r.newUuid,
    subUrl: `${serverConfig.publicBaseUrl}/api/sub/${r.newUuid}`,
    note: 'New UUID active within ~60s — old links no longer work',
  });
}
