import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { XrayClient, UserDevicePolicy } from './types';
import { serverConfig } from './server-config';
import { appendLineAtomic, writeJsonFileAtomic, writeTextFileAtomic } from './state-storage';

const XRAY_CFG = process.env.XRAY_CFG ?? '/etc/xray/config.json';
const STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const PENDING_CFG = process.env.PENDING_CFG ?? path.join(STATE_DIR, 'pending_config.json');
const PENDING_AUDIT = process.env.PENDING_AUDIT ?? path.join(STATE_DIR, 'pending_config_audit.log');
const DEVICE_FILE = path.join(STATE_DIR, 'device_approvals.json');

// Deployer-specific server values now come from lib/server-config (env-driven).
const SERVER_IP   = serverConfig.serverIp;
const SERVER_PORT = serverConfig.serverPort;
const SERVER_DOMAIN = serverConfig.serverDomain;
const VLESS_PBK = serverConfig.vlessPbk;
const VLESS_SID = serverConfig.vlessSid;
const VLESS_SNI = serverConfig.vlessSni;

type RestartAuditDetails = Record<string, string | number | boolean | undefined>;

type RestartRequest = {
  source: string;
  reason: string;
  details?: RestartAuditDetails;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readCfg(): any {
  return JSON.parse(fs.readFileSync(XRAY_CFG, 'utf8'));
}

function queueRestart(request: RestartRequest): void {
  const entry = {
    ts: new Date().toISOString(),
    source: request.source,
    reason: request.reason,
    ...(request.details ?? {}),
  };

  try {
    appendLineAtomic(PENDING_AUDIT, JSON.stringify(entry) + '\n');
  } catch {
    // Ignore audit write failures — config change still takes precedence.
  }

  writeJsonFileAtomic(PENDING_CFG, entry);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeCfg(cfg: any, request: RestartRequest): void {
  try {
    const current = fs.readFileSync(XRAY_CFG, 'utf8');
    writeTextFileAtomic(XRAY_CFG + '.bak', current);
  } catch {
    // first run or read-only — skip backup
  }

  const newJson = JSON.stringify(cfg, null, 2);
  JSON.parse(newJson);
  writeTextFileAtomic(XRAY_CFG, newJson);
  queueRestart(request);
}

// Write config without queuing a cron restart — used for user add/remove where
// HandlerService live-syncs the runtime so no restart is needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeCfgOnly(cfg: any): void {
  try {
    const current = fs.readFileSync(XRAY_CFG, 'utf8');
    writeTextFileAtomic(XRAY_CFG + '.bak', current);
  } catch { /* skip */ }
  const newJson = JSON.stringify(cfg, null, 2);
  JSON.parse(newJson);
  writeTextFileAtomic(XRAY_CFG, newJson);
}

export function listClients(): XrayClient[] {
  try {
    const cfg = readCfg();
    return cfg.inbounds[0].settings.clients as XrayClient[];
  } catch {
    return [];
  }
}

export function vlessUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_IP}:${SERVER_PORT}` +
    `?encryption=none&flow=xtls-rprx-vision&security=reality` +
    `&sni=${VLESS_SNI}&fp=chrome&pbk=${VLESS_PBK}&sid=${VLESS_SID}` +
    `&type=tcp#${encodeURIComponent(label)}`
  );
}

function vmessWsUri(uuid: string, label: string): string {
  const cfg = { v: '2', ps: label, add: SERVER_DOMAIN, port: SERVER_PORT, id: uuid, aid: 0, net: 'ws', type: 'none', host: SERVER_DOMAIN, path: '/vmess-ws', tls: 'tls', sni: SERVER_DOMAIN, fp: 'chrome' };
  return `vmess://${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;
}

function vmessGrpcUri(uuid: string, label: string): string {
  const cfg = { v: '2', ps: label, add: SERVER_DOMAIN, port: SERVER_PORT, id: uuid, aid: 0, net: 'grpc', type: 'gun', host: SERVER_DOMAIN, path: 'vmess-grpc', tls: 'tls', sni: SERVER_DOMAIN, fp: 'chrome' };
  return `vmess://${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;
}

function vlessWsUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_DOMAIN}:${SERVER_PORT}` +
    `?encryption=none&security=tls&sni=${SERVER_DOMAIN}&fp=chrome` +
    `&type=ws&host=${SERVER_DOMAIN}&path=%2Fvless-ws#${encodeURIComponent(label)}`
  );
}

function vlessGrpcUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_DOMAIN}:${SERVER_PORT}` +
    `?encryption=none&security=tls&sni=${SERVER_DOMAIN}&fp=chrome` +
    `&type=grpc&serviceName=vless-grpc#${encodeURIComponent(label)}`
  );
}

function trojanTlsUri(uuid: string, label: string): string {
  return `trojan://${uuid}@${SERVER_IP}:2053?security=tls&sni=${SERVER_DOMAIN}&fp=chrome&type=tcp&allowInsecure=1#${encodeURIComponent(label)}`;
}

function trojanWsTlsUri(uuid: string, label: string): string {
  return `trojan://${uuid}@${SERVER_DOMAIN}:${SERVER_PORT}?security=tls&sni=${SERVER_DOMAIN}&fp=chrome&type=ws&path=%2Ftrojan-ws&host=${SERVER_DOMAIN}#${encodeURIComponent(label)}`;
}

const WG_SERVER_PUB = 'z8zdEqTJ6Bx9r6nu+40wRZ8I3YsjEuEyXlXk/CL9AD8=';
const WG_PORT = 51820;
const WG_CLIENTS_FILE = process.env.WG_CLIENTS_FILE ?? '/etc/wireguard/clients.json';

export function wireguardConf(email: string): string | null {
  try {
    const clients: Array<{ name: string; private: string; public: string; psk: string; ip: string }> =
      JSON.parse(fs.readFileSync(WG_CLIENTS_FILE, 'utf8'));
    const name = email.split('@')[0];
    const c = clients.find(x => x.name === name);
    if (!c) return null;
    return [
      '[Interface]',
      `PrivateKey = ${c.private}`,
      `Address = ${c.ip}/24`,
      'DNS = 1.1.1.1, 8.8.8.8',
      '',
      '[Peer]',
      `PublicKey = ${WG_SERVER_PUB}`,
      `PresharedKey = ${c.psk}`,
      `Endpoint = ${SERVER_IP}:${WG_PORT}`,
      'AllowedIPs = 0.0.0.0/0, ::/0',
      'PersistentKeepalive = 25',
    ].join('\n');
  } catch {
    return null;
  }
}

function hysteria2Uri(email: string, uuid: string, label: string): string {
  const user = email.split('@')[0];
  return `hysteria2://${encodeURIComponent(user)}:${uuid}@${SERVER_IP}:2096?sni=${SERVER_DOMAIN}&insecure=0#${encodeURIComponent(label)}`;
}

function shadowsocksUri(uuid: string, label: string): string {
  const userinfo = Buffer.from(`chacha20-ietf-poly1305:${uuid}`).toString('base64');
  return `ss://${userinfo}@${SERVER_IP}:8388#${encodeURIComponent(label)}`;
}

function vlessXhttpUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_DOMAIN}:${SERVER_PORT}` +
    `?encryption=none&security=tls&sni=${SERVER_DOMAIN}&fp=chrome` +
    `&type=xhttp&host=${SERVER_DOMAIN}&path=%2Fvless-xhttp#${encodeURIComponent(label)}`
  );
}

function vmessXhttpUri(uuid: string, label: string): string {
  const cfg = { v: '2', ps: label, add: SERVER_DOMAIN, port: SERVER_PORT, id: uuid, aid: 0, net: 'xhttp', type: 'none', host: SERVER_DOMAIN, path: '/vmess-xhttp', tls: 'tls', sni: SERVER_DOMAIN, fp: 'chrome' };
  return `vmess://${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;
}

function vlessHttpUpgradeUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_DOMAIN}:${SERVER_PORT}` +
    `?encryption=none&security=tls&sni=${SERVER_DOMAIN}&fp=chrome` +
    `&type=httpupgrade&host=${SERVER_DOMAIN}&path=%2Fvless-hu#${encodeURIComponent(label)}`
  );
}

function vmessHttpUpgradeUri(uuid: string, label: string): string {
  const cfg = { v: '2', ps: label, add: SERVER_DOMAIN, port: SERVER_PORT, id: uuid, aid: 0, net: 'httpupgrade', type: 'none', host: SERVER_DOMAIN, path: '/vmess-hu', tls: 'tls', sni: SERVER_DOMAIN, fp: 'chrome' };
  return `vmess://${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;
}

function vlessMkcpUri(uuid: string, label: string): string {
  return (
    `vless://${uuid}@${SERVER_IP}:4500` +
    `?encryption=none&security=none&type=kcp&headerType=none#${encodeURIComponent(label)}`
  );
}

function vmessMkcpUri(uuid: string, label: string): string {
  const cfg = { v: '2', ps: label, add: SERVER_IP, port: 4500, id: uuid, aid: 0, net: 'kcp', type: 'none', tls: '' };
  return `vmess://${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;
}

export function protocolUri(protocolKey: string, uuid: string, label: string, email = ''): string | null {
  switch (protocolKey) {
    case 'vless-reality':     return vlessUri(uuid, label);
    case 'vmess-ws-tls':      return vmessWsUri(uuid, label);
    case 'vmess-grpc-tls':    return vmessGrpcUri(uuid, label);
    case 'vless-ws-tls':      return vlessWsUri(uuid, label);
    case 'vless-grpc-tls':    return vlessGrpcUri(uuid, label);
    case 'trojan-tls':        return trojanTlsUri(uuid, label);
    case 'trojan-ws-tls':     return trojanWsTlsUri(uuid, label);
    case 'shadowsocks':       return shadowsocksUri(uuid, label);
    case 'hysteria2':         return hysteria2Uri(email || uuid, uuid, label);
    case 'vless-xhttp-tls':   return vlessXhttpUri(uuid, label);
    case 'vmess-xhttp-tls':   return vmessXhttpUri(uuid, label);
    case 'vless-httpupgrade': return vlessHttpUpgradeUri(uuid, label);
    case 'vmess-httpupgrade': return vmessHttpUpgradeUri(uuid, label);
    case 'vless-mkcp':        return vlessMkcpUri(uuid, label);
    case 'vmess-mkcp':        return vmessMkcpUri(uuid, label);
    case 'wireguard':         return null; // served via /api/wg-config
    case 'http':              return null; // local proxy, no share URI
    case 'socks':             return null; // local proxy, no share URI
    case 'dokodemo':          return null; // transparent tunnel, no share URI
    default: return null;
  }
}

// ── Per-inbound client sync ───────────────────────────────────────────────────
// A user belongs in exactly the inbounds whose protocol is in their assigned
// `protocols` set. add / remove / disable / enable / rotate / protocol-edit all
// route through syncUserAcrossInbounds so client membership stays consistent
// across every inbound — not just inbounds[0]. Maps each inbound to a protocol
// key by structure (protocol + network + security), independent of its tag.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inboundProtocolKey(inbound: any): string | null {
  const p = inbound?.protocol;
  const net = inbound?.streamSettings?.network;
  const sec = inbound?.streamSettings?.security;
  if (p === 'vless') {
    if (sec === 'reality') return 'vless-reality';
    if (net === 'ws') return 'vless-ws-tls';
    if (net === 'grpc') return 'vless-grpc-tls';
    if (net === 'xhttp') return 'vless-xhttp-tls';
    if (net === 'httpupgrade') return 'vless-httpupgrade';
    if (net === 'kcp') return 'vless-mkcp';
    return 'vless-reality';
  }
  if (p === 'vmess') {
    if (net === 'grpc') return 'vmess-grpc-tls';
    if (net === 'xhttp') return 'vmess-xhttp-tls';
    if (net === 'httpupgrade') return 'vmess-httpupgrade';
    if (net === 'kcp') return 'vmess-mkcp';
    return 'vmess-ws-tls';
  }
  if (p === 'trojan') return net === 'ws' ? 'trojan-ws-tls' : 'trojan-tls';
  if (p === 'shadowsocks') return 'shadowsocks';
  return null; // api / http / socks / dokodemo — no per-user clients
}

// Build a client entry for an inbound by cloning an existing one's shape (so flow,
// method, etc. match exactly) and swapping the identifier; falls back to a
// protocol-derived shape when the inbound has no template client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildClientForInbound(inbound: any, uuid: string, email: string): Record<string, unknown> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = (inbound?.settings?.clients as any[])?.find?.(c => c && typeof c === 'object');
  if (template) {
    const c: Record<string, unknown> = { ...template };
    if ('id' in c) c.id = uuid;
    if ('password' in c) c.password = uuid;
    c.email = email;
    return c;
  }
  const p = inbound?.protocol;
  if (p === 'vless') return { id: uuid, flow: inbound?.streamSettings?.security === 'reality' ? 'xtls-rprx-vision' : '', email };
  if (p === 'vmess') return { id: uuid, email };
  if (p === 'trojan') return { password: uuid, email };
  if (p === 'shadowsocks') return { password: uuid, email, method: 'chacha20-ietf-poly1305' };
  return null;
}

// Reconcile a user's membership across every inbound to match `protocols`.
// Pass [] to remove them everywhere (disable). Idempotent: only writes when
// something actually changed. Also realigns id/password to `uuid` (rotation).
export function syncUserAcrossInbounds(
  uuid: string,
  email: string,
  protocols: string[],
  _source = 'dashboard-v3/sync',
): { ok: boolean; error?: string } {
  try {
    const cfg = readCfg();
    const wanted = new Set(protocols);
    let changed = false;
    for (const inbound of cfg.inbounds ?? []) {
      const key = inboundProtocolKey(inbound);
      if (!key) continue;
      if (!inbound.settings) inbound.settings = {};
      if (!Array.isArray(inbound.settings.clients)) inbound.settings.clients = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients: any[] = inbound.settings.clients;
      const has = clients.some(c => c?.email === email);
      const want = wanted.has(key);
      if (want && !has) {
        const c = buildClientForInbound(inbound, uuid, email);
        if (c) { clients.push(c); changed = true; }
      } else if (!want && has) {
        inbound.settings.clients = clients.filter(c => c?.email !== email);
        changed = true;
      } else if (want && has) {
        for (const c of clients) {
          if (c?.email !== email) continue;
          if ('id' in c && c.id !== uuid) { c.id = uuid; changed = true; }
          if ('password' in c && c.password !== uuid) { c.password = uuid; changed = true; }
        }
      }
    }
    if (changed) {
      writeCfgOnly(cfg);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function addUser(
  email: string,
  _source = 'dashboard-v3/api/users'
): { uuid: string; uri: string } | { error: string } {
  try {
    const cfg = readCfg();
    const clients: XrayClient[] = cfg.inbounds[0].settings.clients;
    if (clients.some(c => c.email === email)) {
      return { error: 'User already exists' };
    }
    const uuid = randomUUID();
    clients.push({ id: uuid, flow: 'xtls-rprx-vision', email });
    writeCfgOnly(cfg);
    return { uuid, uri: vlessUri(uuid, email) };
  } catch (e) {
    return { error: String(e) };
  }
}

// Rotate a user's UUID across every inbound they belong to — swaps id/password
// in place, preserving membership. The old subscription/links stop working.
// Returns the new UUID. Caller must migrate the user_meta row to the new UUID.
export function rotateUserUuid(
  email: string,
  source = 'dashboard-v3/api/users/rotate'
): { ok: boolean; newUuid?: string; error?: string } {
  try {
    const cfg = readCfg();
    const newUuid = randomUUID();
    let changed = 0;
    for (const inbound of cfg.inbounds ?? []) {
      if (!inboundProtocolKey(inbound)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients = inbound?.settings?.clients as any[] | undefined;
      if (!Array.isArray(clients)) continue;
      for (const c of clients) {
        if (c?.email !== email) continue;
        if ('id' in c) c.id = newUuid;
        if ('password' in c) c.password = newUuid;
        changed++;
      }
    }
    if (changed === 0) return { ok: false, error: 'User not found in any inbound (disabled keys cannot be rotated)' };
    writeCfg(cfg, { source, reason: 'rotate_user', details: { email, uuid: newUuid } });
    return { ok: true, newUuid };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Re-enable a user by syncing them back into their assigned protocols' inbounds.
export function restoreUser(
  email: string,
  uuid: string,
  protocols: string[] = ['vless-reality'],
  source = 'dashboard-v3/enforcement'
): { ok: boolean; error?: string } {
  return syncUserAcrossInbounds(uuid, email, protocols.length ? protocols : ['vless-reality'], source);
}

// Remove a user from EVERY inbound (full disable / delete).
export function removeUser(
  email: string,
  _source = 'dashboard-v3/api/users/delete'
): { ok: boolean; error?: string } {
  try {
    const cfg = readCfg();
    let removed = 0;
    for (const inbound of cfg.inbounds ?? []) {
      if (!inboundProtocolKey(inbound)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients = inbound?.settings?.clients as any[] | undefined;
      if (!Array.isArray(clients)) continue;
      const before = clients.length;
      inbound.settings.clients = clients.filter(c => c?.email !== email);
      removed += before - inbound.settings.clients.length;
    }
    if (removed === 0) return { ok: false, error: 'User not found' };
    writeCfgOnly(cfg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Current actual protocol membership per email, derived from the live config.
// Used to backfill meta.protocols so the assigned-protocols model matches reality
// (avoids stripping access the first time a legacy user's protocols are edited).
export function userProtocolMembership(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  try {
    const cfg = readCfg();
    for (const inbound of cfg.inbounds ?? []) {
      const key = inboundProtocolKey(inbound);
      if (!key) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients = inbound?.settings?.clients as any[] | undefined;
      if (!Array.isArray(clients)) continue;
      for (const c of clients) {
        const email = c?.email;
        if (!email) continue;
        (out[email] ??= []).push(key);
      }
    }
  } catch { /* config unreadable — return what we have */ }
  return out;
}

// Unique clients across EVERY inbound (not just inbounds[0]), keyed by email.
// Surfaces "ghost" users that exist on some inbounds but not the primary one,
// so they're visible and manageable in the dashboard. UUID is read from id
// (vless/vmess) or password (trojan/shadowsocks) — same value for a given user.
export function listAllClients(): XrayClient[] {
  const cfg = readCfg();
  const byEmail = new Map<string, XrayClient>();
  for (const inbound of cfg.inbounds ?? []) {
    if (!inboundProtocolKey(inbound)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clients = inbound?.settings?.clients as any[] | undefined;
    if (!Array.isArray(clients)) continue;
    for (const c of clients) {
      if (!c?.email || byEmail.has(c.email)) continue;
      byEmail.set(c.email, { id: c.id ?? c.password ?? '', flow: c.flow ?? '', email: c.email });
    }
  }
  return [...byEmail.values()];
}

// Resolvers union across all inbounds so any user (incl. ghosts) resolves.
export function emailToUuid(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of listAllClients()) map[c.email] = c.id;
  return map;
}

export function uuidToEmail(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of listAllClients()) map[c.id] = c.email;
  return map;
}

export function getVpnProtocol(): { protocol: string; security: string; network: string; flow: string } {
  try {
    const cfg = readCfg();
    const inbound = cfg.inbounds?.[0] ?? {};
    return {
      protocol: inbound.protocol ?? 'unknown',
      security: inbound.streamSettings?.security ?? 'none',
      network: inbound.streamSettings?.network ?? 'tcp',
      flow: inbound.settings?.clients?.[0]?.flow ?? '',
    };
  } catch {
    return { protocol: 'unknown', security: 'none', network: 'tcp', flow: '' };
  }
}

interface DeviceDb { users: Record<string, UserDevicePolicy> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isDeviceBlockRule(rule: any): boolean {
  return rule?.outboundTag === 'block' && Array.isArray(rule?.source) && Array.isArray(rule?.user);
}

export function syncDeviceBlockRoutes(
  _request: RestartRequest = { source: 'dashboard-v3/device-policy', reason: 'sync_device_block_routes' }
): void {
  let deviceDb: DeviceDb = { users: {} };
  try {
    deviceDb = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
  } catch {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newRules: any[] = [];
  for (const [email, policy] of Object.entries(deviceDb.users ?? {})) {
    const blockedIps: string[] = [];
    for (const [ip, item] of Object.entries(policy.rejected ?? {})) {
      if (item.blocked) blockedIps.push(ip);
    }
    for (const [ip, item] of Object.entries(policy.pending ?? {})) {
      if (item.blocked) blockedIps.push(ip);
    }
    for (const ip of blockedIps) {
      newRules.push({
        type: 'field',
        source: [ip],
        user: [email],
        outboundTag: 'block',
      });
    }
  }

  const cfg = readCfg();
  const routing = cfg.routing ?? { domainStrategy: 'IPIfNonMatch', rules: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRules = (routing.rules ?? []).filter((r: any) => !isDeviceBlockRule(r));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingDeviceRules = (routing.rules ?? []).filter((r: any) => isDeviceBlockRule(r));
  if (JSON.stringify(existingDeviceRules) === JSON.stringify(newRules)) {
    return;
  }

  routing.rules = [...existingRules, ...newRules];
  cfg.routing = routing;
  // Write routing rules to config.json (source of truth for next restart)
  // but do NOT queue a cron restart — UFW handles live enforcement instead.
  writeCfgOnly(cfg);
}
