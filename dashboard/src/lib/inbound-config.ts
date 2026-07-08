import fs from 'fs';
import os from 'os';
import path from 'path';
import { PROTOCOL_CATALOG, type Inbound, type InboundClient } from './inbounds';
import { serverConfig } from './server-config';
import { appendLineAtomic, writeJsonFileAtomic, writeTextFileAtomic } from './state-storage';

const PRIMARY_XRAY_CFG = process.env.XRAY_CFG ?? '/etc/xray/config.json';
const PRIMARY_STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const DEV_DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

// Deployer-specific domain / SNI for inbound templates (env-driven).
const DOMAIN = serverConfig.serverDomain;
const SNI = serverConfig.vlessSni;
const DEV_XRAY_CFG = path.join(DEV_DATA_DIR, 'local-xray-config.json');
const DEV_PENDING_CFG = path.join(DEV_DATA_DIR, 'local-pending-config.json');
const DEV_PENDING_AUDIT = path.join(DEV_DATA_DIR, 'local-pending-config-audit.log');
const SNAPSHOT_XRAY_CFG = path.resolve(process.cwd(), '..', 'fixtures', 'vps-snapshot', 'xray', 'config.json');

export interface ManagedInbound extends Inbound {
  index: number;
  raw: Record<string, unknown>;
  protected: boolean;
}

function canRead(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function canWrite(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveReadableConfigPath(): string {
  if (canRead(PRIMARY_XRAY_CFG)) return PRIMARY_XRAY_CFG;
  if (canRead(DEV_XRAY_CFG)) return DEV_XRAY_CFG;
  if (canRead(SNAPSHOT_XRAY_CFG)) return SNAPSHOT_XRAY_CFG;
  return PRIMARY_XRAY_CFG;
}

function resolveWritableConfigPath(): string {
  if (canRead(PRIMARY_XRAY_CFG) && canWrite(PRIMARY_XRAY_CFG)) return PRIMARY_XRAY_CFG;
  ensureDir(DEV_DATA_DIR);
  if (!canRead(DEV_XRAY_CFG)) {
    const seedPath = canRead(SNAPSHOT_XRAY_CFG) ? SNAPSHOT_XRAY_CFG : resolveReadableConfigPath();
    const raw = fs.readFileSync(seedPath, 'utf8');
    writeTextFileAtomic(DEV_XRAY_CFG, raw);
  }
  return DEV_XRAY_CFG;
}

function resolvePendingPaths() {
  try {
    ensureDir(PRIMARY_STATE_DIR);
    fs.accessSync(PRIMARY_STATE_DIR, fs.constants.W_OK);
    return {
      pendingCfg: process.env.PENDING_CFG ?? path.join(PRIMARY_STATE_DIR, 'pending_config.json'),
      pendingAudit: process.env.PENDING_AUDIT ?? path.join(PRIMARY_STATE_DIR, 'pending_config_audit.log'),
    };
  } catch {
    ensureDir(DEV_DATA_DIR);
    return { pendingCfg: DEV_PENDING_CFG, pendingAudit: DEV_PENDING_AUDIT };
  }
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function classifyTransport(stream: Record<string, unknown> | undefined): string {
  if (!stream) return 'raw';
  const net = String(stream.network ?? 'tcp');
  const sec = String(stream.security ?? 'none');
  if (sec === 'reality') return 'reality';
  if (net === 'ws' && sec === 'tls') return 'ws+tls';
  if (net === 'ws') return 'ws';
  if (net === 'grpc' && sec === 'tls') return 'grpc+tls';
  if (net === 'grpc') return 'grpc';
  if (net === 'httpupgrade' && sec === 'tls') return 'httpupgrade+tls';
  if (net === 'httpupgrade') return 'httpupgrade';
  if (net === 'xhttp' && sec === 'tls') return 'xhttp+tls';
  if (net === 'xhttp') return 'xhttp';
  if (net === 'kcp' || net === 'mkcp') return 'mkcp';
  if (net === 'tcp' && sec === 'tls') return 'tcp+tls';
  if (net === 'tcp') return 'raw';
  return `${net}+${sec}`;
}

function transportDetail(stream: Record<string, unknown> | undefined) {
  if (!stream) return {};
  const detail: Record<string, string | string[]> = {};
  const sec = String(stream.security ?? 'none');
  if (sec === 'reality') {
    const rs = (stream.realitySettings ?? {}) as Record<string, unknown>;
    if (rs.serverNames) detail.sni = rs.serverNames as string[];
    if (rs.dest) detail.dest = String(rs.dest);
  }
  if (sec === 'tls') {
    const ts = (stream.tlsSettings ?? {}) as Record<string, unknown>;
    if (ts.serverName) detail.sni = String(ts.serverName);
  }
  const ws = (stream.wsSettings ?? {}) as Record<string, unknown>;
  if (ws.path) detail.path = String(ws.path);
  const headers = (ws.headers ?? {}) as Record<string, unknown>;
  if (headers.Host) detail.host = String(headers.Host);
  const grpc = (stream.grpcSettings ?? {}) as Record<string, unknown>;
  if (grpc.serviceName) detail.serviceName = String(grpc.serviceName);
  const xhttp = (stream.xhttpSettings ?? {}) as Record<string, unknown>;
  if (xhttp.path) detail.path = String(xhttp.path);
  const hu = (stream.httpupgradeSettings ?? {}) as Record<string, unknown>;
  if (hu.path) detail.path = String(hu.path);
  if (hu.host) detail.host = String(hu.host);
  return detail;
}

function normalizeInbound(rawInbound: Record<string, unknown>, index: number): ManagedInbound {
  const stream = (rawInbound.streamSettings ?? {}) as Record<string, unknown>;
  const settings = (rawInbound.settings ?? {}) as Record<string, unknown>;
  const clients = Array.isArray(settings.clients) ? settings.clients : [];
  const mappedClients: InboundClient[] = clients.map((client) => {
    const c = client as Record<string, unknown>;
    return {
      id: String(c.id ?? ''),
      email: String(c.email ?? ''),
      flow: String(c.flow ?? ''),
    };
  });
  const tag = String(rawInbound.tag ?? '');
  const protocol = String(rawInbound.protocol ?? 'unknown');
  const protectedInbound = tag === 'api' || (protocol === 'dokodemo-door' && String(rawInbound.listen ?? '') === '127.0.0.1');
  return {
    index,
    raw: rawInbound,
    protected: protectedInbound,
    tag,
    protocol,
    port: typeof rawInbound.port === 'number' ? rawInbound.port : null,
    listen: String(rawInbound.listen ?? '0.0.0.0'),
    network: String(stream.network ?? 'tcp'),
    security: String(stream.security ?? 'none'),
    transport: classifyTransport(stream),
    detail: transportDetail(stream),
    clients: mappedClients,
    clientCount: mappedClients.length,
    enabled: String(rawInbound.listen ?? '0.0.0.0') !== '127.0.0.1' && rawInbound.disabled !== true,
  };
}

function validateInboundShape(inbound: Record<string, unknown>) {
  if (!inbound || typeof inbound !== 'object' || Array.isArray(inbound)) {
    throw new Error('Inbound must be a JSON object');
  }
  if (!inbound.protocol || typeof inbound.protocol !== 'string') {
    throw new Error('Inbound must include a protocol');
  }
  if ('port' in inbound && typeof inbound.port !== 'number') {
    throw new Error('Inbound port must be a number');
  }
}

function writeConfig(cfg: Record<string, unknown>, reason: string, details?: Record<string, unknown>) {
  const targetPath = resolveWritableConfigPath();
  const { pendingCfg, pendingAudit } = resolvePendingPaths();

  ensureDir(path.dirname(targetPath));
  ensureDir(path.dirname(pendingCfg));

  try {
    const current = fs.readFileSync(targetPath, 'utf8');
    writeTextFileAtomic(`${targetPath}.bak`, current);
  } catch {
    // skip if this is the first local write
  }

  const payload = JSON.stringify(cfg, null, 2);
  JSON.parse(payload);
  writeTextFileAtomic(targetPath, payload);

  const auditEntry = {
    ts: new Date().toISOString(),
    source: 'dashboard-v3/api/inbounds',
    reason,
    config_path: targetPath,
    ...(details ?? {}),
  };
  appendLineAtomic(pendingAudit, JSON.stringify(auditEntry) + os.EOL);
  writeJsonFileAtomic(pendingCfg, auditEntry);
}

export function getManagedInbounds(): { inbounds: ManagedInbound[]; configPath: string; writable: boolean } {
  const configPath = resolveReadableConfigPath();
  const writable = configPath === PRIMARY_XRAY_CFG ? canWrite(PRIMARY_XRAY_CFG) : true;
  const cfg = readJson(configPath);
  const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds : [];
  return {
    inbounds: inbounds.map((inbound, index) => normalizeInbound(inbound as Record<string, unknown>, index)),
    configPath,
    writable,
  };
}

export function createInbound(rawInbound: Record<string, unknown>) {
  validateInboundShape(rawInbound);
  const targetPath = resolveWritableConfigPath();
  const cfg = readJson(targetPath);
  const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds as Record<string, unknown>[] : [];
  const nextTag = String(rawInbound.tag ?? '').trim();
  if (nextTag && inbounds.some((item) => String(item.tag ?? '') === nextTag)) {
    throw new Error(`Inbound tag already exists: ${nextTag}`);
  }
  inbounds.push(rawInbound);
  cfg.inbounds = inbounds;
  writeConfig(cfg, 'create_inbound', { tag: nextTag || null, protocol: rawInbound.protocol });
  return normalizeInbound(rawInbound, inbounds.length - 1);
}

export function updateInbound(index: number, rawInbound: Record<string, unknown>) {
  validateInboundShape(rawInbound);
  const targetPath = resolveWritableConfigPath();
  const cfg = readJson(targetPath);
  const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds as Record<string, unknown>[] : [];
  if (!inbounds[index]) throw new Error('Inbound not found');
  const current = normalizeInbound(inbounds[index], index);
  if (current.protected) throw new Error('Protected system inbound cannot be modified here');
  const nextTag = String(rawInbound.tag ?? '').trim();
  if (nextTag && inbounds.some((item, i) => i !== index && String(item.tag ?? '') === nextTag)) {
    throw new Error(`Inbound tag already exists: ${nextTag}`);
  }
  inbounds[index] = rawInbound;
  cfg.inbounds = inbounds;
  writeConfig(cfg, 'update_inbound', { index, tag: nextTag || null, protocol: rawInbound.protocol });
  return normalizeInbound(rawInbound, index);
}

export function deleteInbound(index: number) {
  const targetPath = resolveWritableConfigPath();
  const cfg = readJson(targetPath);
  const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds as Record<string, unknown>[] : [];
  if (!inbounds[index]) throw new Error('Inbound not found');
  const current = normalizeInbound(inbounds[index], index);
  if (current.protected) throw new Error('Protected system inbound cannot be deleted here');
  if (current.clientCount > 0) throw new Error('Remove client assignments before deleting this inbound');
  inbounds.splice(index, 1);
  cfg.inbounds = inbounds;
  writeConfig(cfg, 'delete_inbound', { index, tag: current.tag || null, protocol: current.protocol });
  return { deleted: index };
}

export function inboundTemplate(protocolKey: string): Record<string, unknown> {
  const catalog = PROTOCOL_CATALOG.find((entry) => entry.key === protocolKey);
  const tag = protocolKey.replace(/[^a-z0-9-]/gi, '-');
  const defaultPort = typeof catalog?.defaultPort === 'number' ? catalog.defaultPort : 443;

  const templates: Record<string, Record<string, unknown>> = {
    'vless-reality': {
      tag,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          dest: `${SNI}:443`,
          serverNames: [SNI],
          privateKey: 'REPLACE_ME',
          shortIds: ['REPLACE_ME'],
        },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
    'vless-ws-tls': {
      tag,
      port: defaultPort,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/vless-ws', headers: { Host: DOMAIN } },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
    'vless-grpc-tls': {
      tag,
      port: defaultPort,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'grpc',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        grpcSettings: { serviceName: 'vless-grpc' },
      },
    },
    'vmess-ws-tls': {
      tag,
      port: defaultPort,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/vmess-ws', headers: { Host: DOMAIN } },
      },
    },
    'vmess-grpc-tls': {
      tag,
      port: defaultPort,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'grpc',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        grpcSettings: { serviceName: 'vmess-grpc' },
      },
    },
    'trojan-tls': {
      tag,
      port: 2053,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
      },
    },
    'trojan-ws-tls': {
      tag,
      port: defaultPort,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/trojan-ws', headers: { Host: DOMAIN } },
      },
    },
    shadowsocks: {
      tag,
      port: 8388,
      protocol: 'shadowsocks',
      settings: { method: 'chacha20-ietf-poly1305', password: 'REPLACE_ME', network: 'tcp,udp' },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
    'vless-xhttp-tls': {
      tag,
      port: defaultPort,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'xhttp',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        xhttpSettings: { path: '/vless-xhttp', host: DOMAIN },
      },
    },
    'vmess-xhttp-tls': {
      tag,
      port: defaultPort,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'xhttp',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        xhttpSettings: { path: '/vmess-xhttp', host: DOMAIN },
      },
    },
    'vless-httpupgrade': {
      tag,
      port: defaultPort,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'httpupgrade',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        httpupgradeSettings: { path: '/vless-hu', host: DOMAIN },
      },
    },
    'vmess-httpupgrade': {
      tag,
      port: defaultPort,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'httpupgrade',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        httpupgradeSettings: { path: '/vmess-hu', host: DOMAIN },
      },
    },
    'vless-mkcp': {
      tag,
      port: 4500,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'kcp', security: 'none', kcpSettings: { header: { type: 'none' } } },
    },
    'vmess-mkcp': {
      tag,
      port: 4500,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: { network: 'kcp', security: 'none', kcpSettings: { header: { type: 'none' } } },
    },
    http: {
      tag,
      port: 8080,
      protocol: 'http',
      settings: { timeout: 300 },
    },
    socks: {
      tag,
      port: 1080,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
    },
    dokodemo: {
      tag,
      port: 12345,
      protocol: 'dokodemo-door',
      settings: { address: '1.1.1.1', port: 443, network: 'tcp,udp' },
    },
  };

  return templates[protocolKey] ?? {
    tag,
    port: defaultPort,
    protocol: catalog?.engine === 'xray' ? 'vless' : 'http',
    settings: {},
  };
}
