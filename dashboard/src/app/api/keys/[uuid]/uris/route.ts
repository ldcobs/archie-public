import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { listAllClients as listClients, protocolUri } from '@/lib/xray-config';
import { serverConfig } from '@/lib/server-config';
import { loadMeta } from '@/lib/user-meta';

export const dynamic = 'force-dynamic';

const PROTOCOL_NAMES: Record<string, string> = {
  'vless-reality': 'VLESS Reality', 'vless-ws-tls': 'VLESS WS',
  'vless-grpc-tls': 'VLESS gRPC', 'vless-xhttp-tls': 'XHTTP',
  'vless-httpupgrade': 'HTTPUpgrade', 'vmess-ws-tls': 'VMess WS',
  'vmess-grpc-tls': 'VMess gRPC', 'trojan-tls': 'Trojan TLS',
  'trojan-ws-tls': 'Trojan WS', 'shadowsocks': 'Shadowsocks',
  'hysteria2': 'Hysteria2', 'wireguard': 'WireGuard',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const check = requireApiRole(req, 'viewer');
  if ('response' in check) return check.response;

  const { uuid } = await params;
  const clients = listClients();
  const client = clients.find(c => c.id === uuid);
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const metaStore = loadMeta();
  const meta = metaStore[uuid];
  const label = meta?.displayName ? `${meta.displayName} - ${serverConfig.brandName}` : `${client.email} - ${serverConfig.brandName}`;
  const protocols: string[] = meta?.protocols?.length ? meta.protocols : ['vless-reality'];

  const uris = protocols.map(p => ({
    protocol: p,
    label: PROTOCOL_NAMES[p] ?? p,
    uri: protocolUri(p, uuid, `${label} · ${PROTOCOL_NAMES[p] ?? p}`, client.email),
  })).filter(u => u.uri !== null);

  return NextResponse.json({ uris, subUrl: `${serverConfig.publicBaseUrl}/api/sub/${uuid}` });
}
