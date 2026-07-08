import { NextResponse } from 'next/server';
import { listAllClients as listClients, wireguardConf } from '@/lib/xray-config';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const clients = listClients();
  const client = clients.find(c => c.id === token);
  if (!client) {
    return new NextResponse('Not found', { status: 404 });
  }

  const conf = wireguardConf(client.email);
  if (!conf) {
    return new NextResponse('WireGuard config not available for this user', { status: 404 });
  }

  const name = client.email.split('@')[0];
  return new NextResponse(conf, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="ldc-vpn-${name}.conf"`,
    },
  });
}
