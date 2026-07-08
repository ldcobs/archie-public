import { serverConfig } from './server-config';

const {
  serverIp: IP,
  serverPort: PORT,
  serverDomain: DOMAIN,
  vlessPbk: PBK,
  vlessSid: SID,
  vlessSni: SNI,
  brandName: BRAND,
} = serverConfig;

// ── Proxy object builders ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProxyMap = Record<string, any>;

function clashProxy(protocol: string, uuid: string, name: string, email: string): ProxyMap | null {
  const user = email.split('@')[0] || email;
  switch (protocol) {
    case 'vless-reality':
      return {
        name, type: 'vless',
        server: IP, port: PORT, uuid,
        flow: 'xtls-rprx-vision',
        tls: true, servername: SNI,
        'reality-opts': { 'public-key': PBK, 'short-id': SID },
        'client-fingerprint': 'chrome',
      };
    case 'vmess-ws-tls':
      return {
        name, type: 'vmess',
        server: DOMAIN, port: PORT, uuid, alterId: 0, cipher: 'auto',
        tls: true, servername: DOMAIN, 'client-fingerprint': 'chrome',
        'ws-opts': { path: '/vmess-ws', headers: { Host: DOMAIN } },
      };
    case 'vmess-grpc-tls':
      return {
        name, type: 'vmess',
        server: DOMAIN, port: PORT, uuid, alterId: 0, cipher: 'auto',
        tls: true, servername: DOMAIN, network: 'grpc',
        'grpc-opts': { 'grpc-service-name': 'vmess-grpc' },
      };
    case 'trojan-tls':
      return {
        name, type: 'trojan',
        server: IP, port: 2053, password: uuid,
        sni: DOMAIN, 'client-fingerprint': 'chrome', 'skip-cert-verify': true,
      };
    case 'trojan-ws-tls':
      return {
        name, type: 'trojan',
        server: DOMAIN, port: PORT, password: uuid,
        sni: DOMAIN, 'client-fingerprint': 'chrome',
        'ws-opts': { path: '/trojan-ws', headers: { Host: DOMAIN } },
      };
    case 'vless-ws-tls':
      return {
        name, type: 'vless',
        server: DOMAIN, port: PORT, uuid,
        tls: true, servername: DOMAIN, 'client-fingerprint': 'chrome',
        'ws-opts': { path: '/vless-ws', headers: { Host: DOMAIN } },
      };
    case 'vless-grpc-tls':
      return {
        name, type: 'vless',
        server: DOMAIN, port: PORT, uuid,
        tls: true, servername: DOMAIN, network: 'grpc',
        'grpc-opts': { 'grpc-service-name': 'vless-grpc' },
      };
    case 'shadowsocks':
      return {
        name, type: 'ss',
        server: IP, port: 8388,
        cipher: 'chacha20-ietf-poly1305', password: uuid,
      };
    case 'hysteria2':
      return {
        name, type: 'hysteria2',
        server: IP, port: 2096, password: `${user}:${uuid}`,
        sni: DOMAIN,
      };
    // ── New transports ────────────────────────────────────────────────────────
    // XHTTP: supported by Mihomo (Clash.Meta) as the `xhttp` network type.
    case 'vless-xhttp-tls':
      return {
        name, type: 'vless',
        server: DOMAIN, port: PORT, uuid,
        tls: true, servername: DOMAIN, 'client-fingerprint': 'chrome',
        network: 'xhttp',
        'xhttp-opts': { path: '/vless-xhttp', host: DOMAIN, mode: 'auto' },
      };
    case 'vmess-xhttp-tls':
      return {
        name, type: 'vmess',
        server: DOMAIN, port: PORT, uuid, alterId: 0, cipher: 'auto',
        tls: true, servername: DOMAIN, 'client-fingerprint': 'chrome',
        network: 'xhttp',
        'xhttp-opts': { path: '/vmess-xhttp', host: DOMAIN, mode: 'auto' },
      };
    // ── Intentionally NOT emitted for Clash ───────────────────────────────────
    //  - *-httpupgrade: Mihomo lists httpupgrade as unsupported and has an open
    //    bug (#2609) where such nodes fail silently. SingBox-only; see below.
    //  - *-mkcp: mKCP is a V2Ray/Xray-native transport not implemented in
    //    Mihomo. Only Xray-core clients can use it; they get the raw URI.
    //  - http / socks / dokodemo: local/tunnel inbounds with no client-side
    //    outbound representation. Skip in every format.
    //  - wireguard: kernel VPN served via /api/wg-config, not a proxy outbound.
    default:
      return null;
  }
}

function singboxOutbound(protocol: string, uuid: string, name: string, email: string): ProxyMap | null {
  const user = email.split('@')[0] || email;
  const tlsBase = (sni: string) => ({
    enabled: true,
    server_name: sni,
    utls: { enabled: true, fingerprint: 'chrome' },
  });

  switch (protocol) {
    case 'vless-reality':
      return {
        type: 'vless', tag: name,
        server: IP, server_port: PORT, uuid,
        flow: 'xtls-rprx-vision',
        tls: {
          ...tlsBase(SNI),
          reality: { enabled: true, public_key: PBK, short_id: SID },
        },
      };
    case 'vmess-ws-tls':
      return {
        type: 'vmess', tag: name,
        server: DOMAIN, server_port: PORT, uuid, alter_id: 0,
        transport: { type: 'ws', path: '/vmess-ws', headers: { Host: DOMAIN } },
        tls: tlsBase(DOMAIN),
      };
    case 'vmess-grpc-tls':
      return {
        type: 'vmess', tag: name,
        server: DOMAIN, server_port: PORT, uuid, alter_id: 0,
        transport: { type: 'grpc', service_name: 'vmess-grpc' },
        tls: tlsBase(DOMAIN),
      };
    case 'trojan-tls':
      return {
        type: 'trojan', tag: name,
        server: IP, server_port: 2053, password: uuid,
        tls: { ...tlsBase(DOMAIN), insecure: true },
      };
    case 'trojan-ws-tls':
      return {
        type: 'trojan', tag: name,
        server: DOMAIN, server_port: PORT, password: uuid,
        transport: { type: 'ws', path: '/trojan-ws', headers: { Host: DOMAIN } },
        tls: tlsBase(DOMAIN),
      };
    case 'vless-ws-tls':
      return {
        type: 'vless', tag: name,
        server: DOMAIN, server_port: PORT, uuid,
        transport: { type: 'ws', path: '/vless-ws', headers: { Host: DOMAIN } },
        tls: tlsBase(DOMAIN),
      };
    case 'vless-grpc-tls':
      return {
        type: 'vless', tag: name,
        server: DOMAIN, server_port: PORT, uuid,
        transport: { type: 'grpc', service_name: 'vless-grpc' },
        tls: tlsBase(DOMAIN),
      };
    case 'shadowsocks':
      return {
        type: 'shadowsocks', tag: name,
        server: IP, server_port: 8388,
        method: 'chacha20-ietf-poly1305', password: uuid,
      };
    case 'hysteria2':
      return {
        type: 'hysteria2', tag: name,
        server: IP, server_port: 2096,
        auth: `${user}:${uuid}`,
        tls: tlsBase(DOMAIN),
      };
    // ── New transports ────────────────────────────────────────────────────────
    // XHTTP: supported by sing-box as the `xhttp` V2Ray-transport type.
    case 'vless-xhttp-tls':
      return {
        type: 'vless', tag: name,
        server: DOMAIN, server_port: PORT, uuid,
        transport: { type: 'xhttp', path: '/vless-xhttp', host: DOMAIN },
        tls: tlsBase(DOMAIN),
      };
    case 'vmess-xhttp-tls':
      return {
        type: 'vmess', tag: name,
        server: DOMAIN, server_port: PORT, uuid, alter_id: 0,
        transport: { type: 'xhttp', path: '/vmess-xhttp', host: DOMAIN },
        tls: tlsBase(DOMAIN),
      };
    // HTTPUpgrade: supported by sing-box as the `httpupgrade` V2Ray-transport
    // type. (Mihomo support is broken — see clashProxy() note — SingBox only.)
    case 'vless-httpupgrade':
      return {
        type: 'vless', tag: name,
        server: DOMAIN, server_port: PORT, uuid,
        transport: { type: 'httpupgrade', path: '/vless-hu', host: DOMAIN },
        tls: tlsBase(DOMAIN),
      };
    case 'vmess-httpupgrade':
      return {
        type: 'vmess', tag: name,
        server: DOMAIN, server_port: PORT, uuid, alter_id: 0,
        transport: { type: 'httpupgrade', path: '/vmess-hu', host: DOMAIN },
        tls: tlsBase(DOMAIN),
      };
    // ── Intentionally NOT emitted for sing-box ─────────────────────────────────
    //  - *-mkcp: sing-box does not implement mKCP as a V2Ray transport (it has
    //    its own QUIC-based transports only). Xray-core-only; raw URI covers it.
    //  - http / socks / dokodemo: local/tunnel inbounds; no client-side outbound.
    //  - wireguard: kernel VPN served via /api/wg-config, not a proxy outbound.
    default:
      return null;
  }
}

// ── Protocol display names ────────────────────────────────────────────────────

const PROTO_LABEL: Record<string, string> = {
  'vless-reality': 'Reality',
  'vmess-ws-tls': 'VMess WS',
  'vmess-grpc-tls': 'VMess gRPC',
  'trojan-tls': 'Trojan TLS',
  'trojan-ws-tls': 'Trojan WS',
  'vless-ws-tls': 'VLESS WS',
  'vless-grpc-tls': 'VLESS gRPC',
  'shadowsocks': 'Shadowsocks',
  'hysteria2': 'Hysteria2',
  'vless-xhttp-tls': 'VLESS XHTTP',
  'vmess-xhttp-tls': 'VMess XHTTP',
  'vless-httpupgrade': 'VLESS HTTPUpgrade',
  'vmess-httpupgrade': 'VMess HTTPUpgrade',
  'vless-mkcp': 'VLESS mKCP',
  'vmess-mkcp': 'VMess mKCP',
};

// ── YAML serializer (no external dep) ────────────────────────────────────────

function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Quote strings that contain special YAML chars or look ambiguous
    if (/[:#\[\]{}&*!|>'"%@`,]/.test(value) || value.includes('\n') || value === '') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(v => `${pad}- ${toYaml(v, indent + 2).trimStart()}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      const rendered = toYaml(v, indent + 2);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return `${pad}${k}:\n${rendered}`;
      }
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
        return `${pad}${k}:\n${rendered}`;
      }
      return `${pad}${k}: ${rendered}`;
    }).join('\n');
  }
  return String(value);
}

// ── Public formatters ─────────────────────────────────────────────────────────

export function toClashYaml(
  protocols: string[],
  uuid: string,
  displayName: string,
  email: string,
): string {
  const proxies = protocols
    .map(p => clashProxy(p, uuid, `${PROTO_LABEL[p] ?? p}`, email))
    .filter((p): p is ProxyMap => p !== null);

  if (proxies.length === 0) return '# No supported protocols for Clash format\n';

  const proxyNames = proxies.map(p => p.name as string);

  const doc = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    proxies,
    'proxy-groups': [
      { name: '🚀 Proxy', type: 'select', proxies: ['DIRECT', ...proxyNames] },
      { name: '🔄 Auto', type: 'url-test', proxies: proxyNames, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    ],
    rules: ['GEOIP,CN,DIRECT', 'MATCH,🚀 Proxy'],
  };

  return (
    `# ${BRAND} — Clash.Meta config for ${displayName}\n` +
    `# Generated ${new Date().toISOString().slice(0, 10)}\n` +
    `# Requires Mihomo (Clash.Meta) for VLESS/Reality support\n\n` +
    toYaml(doc) + '\n'
  );
}

export function toSingBoxJson(
  protocols: string[],
  uuid: string,
  displayName: string,
  email: string,
): string {
  const outbounds: ProxyMap[] = protocols
    .map(p => singboxOutbound(p, uuid, `${PROTO_LABEL[p] ?? p}`, email))
    .filter((p): p is ProxyMap => p !== null);

  if (outbounds.length === 0) {
    return JSON.stringify({ outbounds: [] }, null, 2);
  }

  const tags = outbounds.map(o => o.tag as string);

  const doc = {
    log: { level: 'info' },
    dns: {
      servers: [
        { tag: 'remote', address: 'tls://1.1.1.1' },
        { tag: 'local', address: '223.5.5.5', detour: 'direct' },
      ],
      rules: [{ geosite: 'cn', server: 'local' }],
    },
    inbounds: [
      { type: 'tun', tag: 'tun-in', inet4_address: '172.19.0.1/30', auto_route: true, strict_route: true, sniff: true },
    ],
    outbounds: [
      { type: 'selector', tag: 'proxy', outbounds: ['auto', ...tags] },
      { type: 'urltest', tag: 'auto', outbounds: tags, url: 'http://www.gstatic.com/generate_204', interval: '5m' },
      ...outbounds,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules: [
        { geosite: 'cn', outbound: 'direct' },
        { geoip: 'cn', outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
    },
  };

  return (
    `// ${BRAND} — sing-box config for ${displayName}\n` +
    `// Generated ${new Date().toISOString().slice(0, 10)}\n` +
    JSON.stringify(doc, null, 2) + '\n'
  );
}
