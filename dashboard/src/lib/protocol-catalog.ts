// ── Protocol catalog (client-safe, no node deps) ──────────────────────────────
// Single source of truth for protocol keys, display names, and colors.
// Imported by both server code (lib/inbounds.ts re-exports this) and client
// components (keys/vpn-users panels) so colors stay consistent everywhere.
// family color drives the chip palette.

export type ProtocolFamily = 'reality' | 'ws' | 'grpc' | 'trojan' | 'ss' | 'h2' | 'wg' | 'mkcp' | 'xhttp' | 'http' | 'socks' | 'dokodemo';

export interface ProtocolCatalogEntry {
  key: string;          // canonical key (matches protocolUri switch)
  name: string;         // display name
  badges: string[];
  family: ProtocolFamily;
  color: string;
  transport: string;    // human label
  desc: string;         // one-line explanation of this configuration type
  docsUrl: string;      // public protocol documentation
  engine: 'xray' | 'hysteria2' | 'wireguard';  // where it lives
  defaultPort: number | string;
}

export const PROTOCOL_CATALOG: ProtocolCatalogEntry[] = [
  { key: 'vless-reality',  name: 'VLESS Reality',   badges: ['VLESS', 'Reality', 'XTLS'], family: 'reality', color: '#00d4ff', transport: 'TCP · Reality',  desc: 'Best performance · direct connection, no CDN',           docsUrl: 'https://xtls.github.io/en/config/inbounds/vless.html',      engine: 'xray',      defaultPort: 443 },
  { key: 'vmess-ws-tls',   name: 'VMess WS',        badges: ['VMess', 'WS', 'TLS'],       family: 'ws',      color: '#5b8def', transport: 'WebSocket · TLS', desc: 'Routes via Cloudflare CDN · bypasses restrictions',      docsUrl: 'https://xtls.github.io/en/config/inbounds/vmess.html',      engine: 'xray',      defaultPort: '443 (CDN)' },
  { key: 'vmess-grpc-tls', name: 'VMess gRPC',      badges: ['VMess', 'gRPC', 'TLS'],     family: 'grpc',    color: '#7c6ff5', transport: 'gRPC · TLS',      desc: 'CDN-routed · for legacy clients + gRPC',                 docsUrl: 'https://xtls.github.io/en/config/inbounds/vmess.html',      engine: 'xray',      defaultPort: '443 (CDN)' },
  { key: 'vless-ws-tls',   name: 'VLESS WS',        badges: ['VLESS', 'WS', 'TLS'],       family: 'ws',      color: '#3fb8d4', transport: 'WebSocket · TLS', desc: 'VLESS over CDN · for restricted networks',               docsUrl: 'https://xtls.github.io/en/config/inbounds/vless.html',      engine: 'xray',      defaultPort: '443 (CDN)' },
  { key: 'vless-grpc-tls', name: 'VLESS gRPC',      badges: ['VLESS', 'gRPC', 'TLS'],     family: 'grpc',    color: '#9d6bd6', transport: 'gRPC · TLS',      desc: 'VLESS + gRPC over CDN',                                  docsUrl: 'https://xtls.github.io/en/config/inbounds/vless.html',      engine: 'xray',      defaultPort: '443 (CDN)' },
  { key: 'trojan-tls',     name: 'Trojan TLS',      badges: ['Trojan', 'TLS'],            family: 'trojan',  color: '#bd93f9', transport: 'TCP · TLS',       desc: 'Lightweight · direct IP connection',                     docsUrl: 'https://xtls.github.io/en/config/inbounds/trojan.html',                  engine: 'xray',      defaultPort: 2053 },
  { key: 'trojan-ws-tls',  name: 'Trojan WS',       badges: ['Trojan', 'WS', 'TLS'],      family: 'trojan',  color: '#bd93f9', transport: 'WebSocket · TLS', desc: 'Trojan over CDN · for restricted networks',              docsUrl: 'https://xtls.github.io/en/config/inbounds/trojan.html',                  engine: 'xray',      defaultPort: '443 (CDN)' },
  { key: 'shadowsocks',    name: 'Shadowsocks',     badges: ['Shadowsocks', 'chacha20'],  family: 'ss',      color: '#f1c40f', transport: 'TCP+UDP',         desc: 'Legacy compatibility · simple encrypted proxy',          docsUrl: 'https://xtls.github.io/en/config/inbounds/shadowsocks.html',         engine: 'xray',      defaultPort: 8388 },
  { key: 'hysteria2',           name: 'Hysteria2',        badges: ['Hysteria2', 'QUIC'],               family: 'h2',       color: '#22e66b', transport: 'UDP · QUIC',          desc: 'Maximum speed · QUIC-based, very fast',                        docsUrl: 'https://v2.hysteria.network/docs/developers/Protocol/',             engine: 'hysteria2',  defaultPort: 2096 },
  { key: 'wireguard',           name: 'WireGuard',        badges: ['WireGuard', 'Kernel'],             family: 'wg',       color: '#00c4a0', transport: 'UDP · Kernel',        desc: 'Kernel-level VPN · conf file, not a URI',                     docsUrl: 'https://www.wireguard.com/protocol/',                               engine: 'wireguard',  defaultPort: 51820 },
  // ── New transports ────────────────────────────────────────────────────────────
  { key: 'vless-xhttp-tls',     name: 'VLESS XHTTP',      badges: ['VLESS', 'XHTTP', 'TLS'],          family: 'xhttp',    color: '#00e5cc', transport: 'XHTTP · TLS',         desc: 'VLESS over XHTTP · CDN-compatible, replaces H2',              docsUrl: 'https://xtls.github.io/en/config/transports/xhttp.html',           engine: 'xray',       defaultPort: '443 (CDN)' },
  { key: 'vmess-xhttp-tls',     name: 'VMess XHTTP',      badges: ['VMess', 'XHTTP', 'TLS'],          family: 'xhttp',    color: '#00bfae', transport: 'XHTTP · TLS',         desc: 'VMess over XHTTP · CDN-compatible, replaces H2',              docsUrl: 'https://xtls.github.io/en/config/transports/xhttp.html',           engine: 'xray',       defaultPort: '443 (CDN)' },
  { key: 'vless-httpupgrade',   name: 'VLESS HTTPUpgrade', badges: ['VLESS', 'HTTPUpgrade', 'TLS'],   family: 'ws',       color: '#4db8ff', transport: 'HTTPUpgrade · TLS',   desc: 'VLESS over HTTPUpgrade · CDN WebSocket upgrade path',         docsUrl: 'https://xtls.github.io/en/config/transports/httpupgrade.html',     engine: 'xray',       defaultPort: '443 (CDN)' },
  { key: 'vmess-httpupgrade',   name: 'VMess HTTPUpgrade', badges: ['VMess', 'HTTPUpgrade', 'TLS'],   family: 'ws',       color: '#3a9fd6', transport: 'HTTPUpgrade · TLS',   desc: 'VMess over HTTPUpgrade · CDN WebSocket upgrade path',         docsUrl: 'https://xtls.github.io/en/config/transports/httpupgrade.html',     engine: 'xray',       defaultPort: '443 (CDN)' },
  { key: 'vless-mkcp',          name: 'VLESS mKCP',       badges: ['VLESS', 'mKCP'],                  family: 'mkcp',     color: '#e06c75', transport: 'mKCP · UDP',           desc: 'VLESS over mKCP · UDP-based, lower latency on packet loss',   docsUrl: 'https://xtls.github.io/en/config/transports/mkcp.html',            engine: 'xray',       defaultPort: 4500 },
  { key: 'vmess-mkcp',          name: 'VMess mKCP',       badges: ['VMess', 'mKCP'],                  family: 'mkcp',     color: '#c95f67', transport: 'mKCP · UDP',           desc: 'VMess over mKCP · UDP-based, lower latency on packet loss',   docsUrl: 'https://xtls.github.io/en/config/transports/mkcp.html',            engine: 'xray',       defaultPort: 4500 },
  // ── Utility inbounds ─────────────────────────────────────────────────────────
  { key: 'http',                name: 'HTTP Proxy',       badges: ['HTTP'],                            family: 'http',     color: '#f0a500', transport: 'HTTP',                desc: 'Plain HTTP proxy inbound · local or internal use',            docsUrl: 'https://xtls.github.io/en/config/inbounds/http.html',              engine: 'xray',       defaultPort: 8080 },
  { key: 'socks',               name: 'SOCKS Mixed',      badges: ['SOCKS5', 'UDP'],                  family: 'socks',    color: '#e8965c', transport: 'SOCKS5 · UDP',        desc: 'SOCKS5 mixed inbound with UDP associate support',             docsUrl: 'https://xtls.github.io/en/config/inbounds/socks.html',             engine: 'xray',       defaultPort: 1080 },
  { key: 'dokodemo',            name: 'Dokodemo-door',    badges: ['Tunnel', 'Transparent'],          family: 'dokodemo', color: '#98c379', transport: 'Transparent',          desc: 'Transparent tunnel · accepts any protocol to a fixed target', docsUrl: 'https://xtls.github.io/en/config/inbounds/dokodemo-door.html',     engine: 'xray',       defaultPort: 12345 },
];

// Quick lookup: protocol key → catalog entry
export const PROTOCOL_BY_KEY: Record<string, ProtocolCatalogEntry> =
  Object.fromEntries(PROTOCOL_CATALOG.map(p => [p.key, p]));

export function protocolColor(key: string): string {
  return PROTOCOL_BY_KEY[key]?.color ?? 'rgba(180,195,215,0.4)';
}
export function protocolName(key: string): string {
  return PROTOCOL_BY_KEY[key]?.name ?? key;
}
