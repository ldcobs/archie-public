import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
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

  if (!data) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  // Active key → encode the subscription URL (import into the VPN client), the
  // single config link when ?mode=direct (Amnezia etc.), or the WireGuard .conf
  // text when ?mode=wireguard (scan into the WireGuard app). Pending / preview →
  // encode the invite link so scanning opens the onboarding page.
  const mode = new URL(req.url).searchParams.get('mode');
  let payload = `${baseUrl}/invite/${token}`;
  if (data.state === 'active') {
    if (mode === 'wireguard' && data.email) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { wireguardConf } = require('@/lib/xray-config') as typeof import('@/lib/xray-config');
      const conf = wireguardConf(data.email);
      if (conf) payload = conf;
    } else if (mode === 'direct' && data.directLink) {
      payload = data.directLink;
    } else if (data.subUrl) {
      payload = data.subUrl;
    }
  }

  const png = await QRCode.toBuffer(payload, {
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
