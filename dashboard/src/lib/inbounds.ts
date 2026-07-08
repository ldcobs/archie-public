import fs from 'fs';
import path from 'path';

// ── Inbound introspection + protocol catalog (read-only) ──────────────────────
// Never mutates config.json. Mirrors api/vpn-api.py:list_inbounds().

const XRAY_CFG = process.env.XRAY_CFG ?? '/etc/xray/config.json';
const USER_META_FILE = process.env.USER_META_FILE ?? path.join(process.cwd(), 'data/user_meta.json');

export interface InboundClient {
  id: string;
  email: string;
  flow: string;
}

export interface InboundDetail {
  sni?: string | string[];
  dest?: string;
  path?: string;
  host?: string;
  serviceName?: string;
}

export interface Inbound {
  tag: string;
  protocol: string;
  port: number | null;
  listen: string;
  network: string;
  security: string;
  transport: string;
  detail: InboundDetail;
  clients: InboundClient[];
  clientCount: number;
  enabled: boolean;
}

export interface InboundListResponse {
  inbounds: Inbound[];
  ok: boolean;
  error?: string;
}

// ── Protocol catalog (all 10 supported protocols) ─────────────────────────────
// The canonical key set used by protocolUri() in xray-config.ts.
// family color drives the chip palette.

// Catalog + colors live in a client-safe module (no fs/path) so both server and
// client share one source of truth. Imported for internal use and re-exported
// here so existing `@/lib/inbounds` imports keep working.
import { PROTOCOL_CATALOG, PROTOCOL_BY_KEY, protocolColor, protocolName } from './protocol-catalog';
import type { ProtocolFamily, ProtocolCatalogEntry } from './protocol-catalog';
export type { ProtocolFamily, ProtocolCatalogEntry };
export { PROTOCOL_CATALOG, PROTOCOL_BY_KEY, protocolColor, protocolName };

// ── Merged view: catalog + live status ────────────────────────────────────────
// For each catalog entry, report whether a matching inbound exists in config.json
// and how many users (across all inbounds) have that protocol assigned.
export interface ProtocolStatus {
  entry: ProtocolCatalogEntry;
  live: boolean;          // a matching inbound exists in config.json (xray only)
  port: number | string | null;
  clientCount: number;    // clients attached to the matching inbound
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readCfg(): any {
  return JSON.parse(fs.readFileSync(XRAY_CFG, 'utf8'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyTransport(stream: any | undefined): string {
  if (!stream) return 'raw';
  const net = stream.network ?? 'tcp';
  const sec = stream.security ?? 'none';
  if (sec === 'reality') return 'reality';
  if (net === 'ws'          && sec === 'tls') return 'ws+tls';
  if (net === 'ws')                           return 'ws';
  if (net === 'grpc'        && sec === 'tls') return 'grpc+tls';
  if (net === 'grpc')                         return 'grpc';
  if (net === 'httpupgrade' && sec === 'tls') return 'httpupgrade+tls';
  if (net === 'httpupgrade')                  return 'httpupgrade';
  if (net === 'xhttp'       && sec === 'tls') return 'xhttp+tls';
  if (net === 'xhttp')                        return 'xhttp';
  if (net === 'kcp' || net === 'mkcp')        return 'mkcp';
  if (net === 'tcp'         && sec === 'tls') return 'tcp+tls';
  if (net === 'tcp')                          return 'raw';
  return `${net}+${sec}`;
}

// Match a live inbound to a catalog key. The VLESS Reality inbound is the
// canonical one in config.json[0]; the others are distinguished by transport.
function matchCatalogKey(ib: Inbound): string | null {
  const t = ib.transport;
  const proto = ib.protocol;
  if (proto === 'shadowsocks')  return 'shadowsocks';
  if (proto === 'http')         return 'http';
  if (proto === 'socks')        return 'socks';
  if (proto === 'dokodemo-door') return 'dokodemo';
  if (proto === 'vless') {
    if (t === 'reality')              return 'vless-reality';
    if (t === 'ws+tls')               return 'vless-ws-tls';
    if (t === 'grpc+tls')             return 'vless-grpc-tls';
    if (t === 'xhttp+tls' || t === 'xhttp') return 'vless-xhttp-tls';
    if (t === 'httpupgrade+tls' || t === 'httpupgrade') return 'vless-httpupgrade';
    if (t === 'mkcp')                 return 'vless-mkcp';
  }
  if (proto === 'vmess') {
    if (t === 'ws+tls')               return 'vmess-ws-tls';
    if (t === 'grpc+tls')             return 'vmess-grpc-tls';
    if (t === 'xhttp+tls' || t === 'xhttp') return 'vmess-xhttp-tls';
    if (t === 'httpupgrade+tls' || t === 'httpupgrade') return 'vmess-httpupgrade';
    if (t === 'mkcp')                 return 'vmess-mkcp';
  }
  if (proto === 'trojan') {
    if (t === 'tcp+tls' || t === 'raw') return 'trojan-tls';
    if (t === 'ws+tls')               return 'trojan-ws-tls';
  }
  return null;
}

export function listInbounds(): InboundListResponse {
  let inbounds: Inbound[] = [];
  try {
    const cfg = readCfg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inbounds = (cfg.inbounds ?? []).map((ib: any) => {
      const stream = ib.streamSettings;
      const clients: InboundClient[] = ib.settings?.clients ?? [];
      return {
        tag: ib.tag ?? '',
        protocol: ib.protocol ?? 'unknown',
        port: ib.port ?? null,
        listen: ib.listen ?? '0.0.0.0',
        network: stream?.network ?? 'tcp',
        security: stream?.security ?? 'none',
        transport: classifyTransport(stream),
        detail: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clients: clients.map((c: any) => ({ id: c.id ?? '', email: c.email ?? '', flow: c.flow ?? '' })),
        clientCount: clients.length,
        enabled: ib.listen !== '127.0.0.1' && !ib.disabled,
      };
    });
    return { inbounds, ok: true };
  } catch (e) {
    return { inbounds, ok: false, error: String(e) };
  }
}

// Catalog merged with live status. Hysteria2 / WireGuard can't be confirmed
// from config.json — their live state is determined by the engine (systemd).
// We surface them with their default port but mark them unconfirmed locally.
export function protocolStatus(): { status: ProtocolStatus[]; configReadable: boolean } {
  const { inbounds, ok } = listInbounds();
  const byKey = new Map<string, Inbound>();
  for (const ib of inbounds) {
    const key = matchCatalogKey(ib);
    if (key && !byKey.has(key)) byKey.set(key, ib);
  }
  const status: ProtocolStatus[] = PROTOCOL_CATALOG.map(entry => {
    const live = byKey.get(entry.key);
    const isXray = entry.engine === 'xray';
    return {
      entry,
      live: isXray && !!live,
      port: live?.port ?? entry.defaultPort,
      clientCount: live?.clientCount ?? 0,
    };
  });
  return { status, configReadable: ok };
}

// ── Groups (sourced from existing user_meta — never hardcoded) ────────────────
export function listGroups(): string[] {
  try {
    const meta = JSON.parse(fs.readFileSync(USER_META_FILE, 'utf8'));
    const groups = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of Object.values<any>(meta ?? {})) {
      if (m?.group) groups.add(m.group);
    }
    return Array.from(groups).sort();
  } catch {
    return [];
  }
}
