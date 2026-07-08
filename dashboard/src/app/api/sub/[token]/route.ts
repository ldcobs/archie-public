import { NextResponse } from 'next/server';
import { listAllClients as listClients, protocolUri } from '@/lib/xray-config';
import { serverConfig } from '@/lib/server-config';
import { loadMeta, patchMeta } from '@/lib/user-meta';
import { toClashYaml, toSingBoxJson } from '@/lib/sub-formats';

export const dynamic = 'force-dynamic';

const PROTOCOL_NAMES: Record<string, string> = {
  'vless-reality':     'VLESS Reality',
  'vmess-ws-tls':      'VMess WS',
  'vmess-grpc-tls':    'VMess gRPC',
  'trojan-tls':        'Trojan TLS',
  'trojan-ws-tls':     'Trojan WS',
  'vless-ws-tls':      'VLESS WS',
  'vless-grpc-tls':    'VLESS gRPC',
  'shadowsocks':       'Shadowsocks',
  'hysteria2':         'Hysteria2',
  'wireguard':         'WireGuard',
  'vless-xhttp-tls':   'VLESS XHTTP',
  'vmess-xhttp-tls':   'VMess XHTTP',
  'vless-httpupgrade': 'VLESS HTTPUpgrade',
  'vmess-httpupgrade': 'VMess HTTPUpgrade',
  'vless-mkcp':        'VLESS mKCP',
  'vmess-mkcp':        'VMess mKCP',
};

function detectClient(ua: string): string {
  const u = ua.toLowerCase();
  if (u.includes('hiddify'))      return 'Hiddify';
  if (u.includes('shadowrocket')) return 'Shadowrocket';
  if (u.includes('v2rayn/'))      return 'v2rayN';
  if (u.includes('v2rayng'))      return 'v2rayNG';
  if (u.includes('nekobox'))      return 'NekoBox';
  if (u.includes('nekoray'))      return 'NekoRay';
  if (u.includes('sing-box'))     return 'sing-box';
  if (u.includes('foxray'))       return 'FoXray';
  if (u.includes('streisand'))    return 'Streisand';
  if (u.includes('clash'))        return 'Clash';
  if (u.includes('amnezia'))      return 'AmneziaVPN';
  if (u.includes('quantumult'))   return 'Quantumult X';
  if (u.includes('surge'))        return 'Surge';
  if (u.includes('loon'))         return 'Loon';
  if (u.includes('stash'))        return 'Stash';
  return 'Unknown';
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const uuid = token;
  const format = new URL(req.url).searchParams.get('format') ?? 'raw';

  const clients = listClients();
  const client = clients.find(c => c.id === uuid);
  if (!client) {
    return new NextResponse('Not found', { status: 404 });
  }

  const metaStore = loadMeta();
  const meta = metaStore[uuid];

  // Log subscription fetch
  const ua = req.headers.get('user-agent') ?? '';
  if (meta) {
    patchMeta(uuid, {
      lastSubFetch:     new Date().toISOString(),
      subFetchCount:    (meta.subFetchCount ?? 0) + 1,
      detectedClient:   detectClient(ua),
      detectedClientRaw: ua.slice(0, 200),
    });
  }

  if (meta?.expiresAt) {
    const expired = new Date(meta.expiresAt).getTime() < Date.now();
    if (expired) {
      const empty = Buffer.from('# Key expired\n').toString('base64');
      return new NextResponse(empty, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Profile-Update-Interval': '6',
          'Subscription-Userinfo': 'expire=0',
        },
      });
    }
  }

  const label = meta?.displayName
    ? `${meta.displayName} - ${serverConfig.brandName}`
    : `${client.email} - ${serverConfig.brandName}`;

  const protocols: string[] = meta?.protocols?.length ? meta.protocols : ['vless-reality'];
  const uris = protocols
    .map(p => {
      const name = PROTOCOL_NAMES[p] ?? p;
      const serverLabel = `${label} · ${name}`;
      return protocolUri(p, uuid, serverLabel, client.email);
    })
    .filter((u): u is string => u !== null);

  const userinfoParts: string[] = [];
  if (meta?.trafficLimitGB && meta.trafficLimitGB > 0) {
    userinfoParts.push(`total=${Math.round(meta.trafficLimitGB * 1e9)}`);
  }
  if (meta?.expiresAt) {
    userinfoParts.push(`expire=${Math.round(new Date(meta.expiresAt).getTime() / 1000)}`);
  }

  const displayName = meta?.displayName ?? client.email;
  const commonHeaders = {
    'Cache-Control': 'no-store',
    'Profile-Title': `${serverConfig.brandName} - ${displayName}`,
    'Profile-Update-Interval': '6',
    'Support-URL': `https://${serverConfig.serverDomain}`,
    ...(userinfoParts.length > 0 ? { 'Subscription-Userinfo': userinfoParts.join('; ') } : {}),
  };

  if (format === 'clash') {
    const yaml = toClashYaml(protocols, uuid, displayName, client.email);
    return new NextResponse(yaml, {
      headers: {
        ...commonHeaders,
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${client.email}.yaml"`,
      },
    });
  }

  if (format === 'singbox') {
    const json = toSingBoxJson(protocols, uuid, displayName, client.email);
    return new NextResponse(json, {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${client.email}.json"`,
      },
    });
  }

  // Default: raw base64 URI list
  const body = Buffer.from(uris.join('\n') + '\n').toString('base64');
  return new NextResponse(body, {
    headers: {
      ...commonHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${client.email}.txt"`,
    },
  });
}
