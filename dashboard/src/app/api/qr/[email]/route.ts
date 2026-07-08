import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { requireApiRole } from '@/lib/auth';
import { emailToUuid, vlessUri } from '@/lib/xray-config';
import { serverConfig } from '@/lib/server-config';
import { findMockUser, shouldServeMockData } from '@/lib/mock-data';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  // A user's QR encodes their full VLESS connection URI (UUID = the credential).
  // This route was only guarded by middleware's cookie-*presence* check, so any
  // request carrying an arbitrary cookie value could exfiltrate any user's key.
  // Validate the session for real.
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

  const useSub = url.searchParams.get('sub') === '1';
  const format = url.searchParams.get('format');
  const subUrl = format && format !== 'raw'
    ? `${serverConfig.publicBaseUrl}/api/sub/${uuid}?format=${encodeURIComponent(format)}`
    : `${serverConfig.publicBaseUrl}/api/sub/${uuid}`;
  const content = useSub ? subUrl : vlessUri(uuid, resolvedEmail);

  const png = await QRCode.toBuffer(content, {
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#ffffffFF', light: '#0a0a0fFF' },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
