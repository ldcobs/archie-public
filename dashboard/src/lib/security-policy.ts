import type { Fail2banEntry } from './types';
import { readStateJson, writeStateJson } from './state-storage';

const POLICY_FILE = 'protection_mode.json';
const BLOCKS_FILE = 'permanent_blocks.json';
const PENDING_FW = 'pending_firewall.json';

export type ProtectionMode = 'temp-ban' | 'permanent-deny';

interface ProtectionModeState {
  mode: ProtectionMode;
  updated_at: string;
  effective_from?: string;
}

interface FirewallCommand {
  action: 'block' | 'unblock';
  ip: string;
  scope: string;
  user: string;
  ts: string;
}

interface FirewallQueue {
  commands: FirewallCommand[];
}

export function getProtectionMode(): ProtectionMode {
  try {
    const raw = readStateJson<Partial<ProtectionModeState>>(POLICY_FILE);
    if (!raw) return 'temp-ban';
    return raw.mode === 'permanent-deny' ? 'permanent-deny' : 'temp-ban';
  } catch {
    return 'temp-ban';
  }
}

function getProtectionModeState(): ProtectionModeState {
  try {
    const raw = readStateJson<Partial<ProtectionModeState>>(POLICY_FILE);
    if (!raw) return { mode: 'temp-ban', updated_at: '', effective_from: '' };
    return {
      mode: raw.mode === 'permanent-deny' ? 'permanent-deny' : 'temp-ban',
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
      effective_from: typeof raw.effective_from === 'string' ? raw.effective_from : '',
    };
  } catch {
    return { mode: 'temp-ban', updated_at: '', effective_from: '' };
  }
}

export function setProtectionMode(mode: ProtectionMode): ProtectionModeState {
  const changedAt = new Date().toISOString();
  const state: ProtectionModeState = {
    mode,
    updated_at: changedAt,
    effective_from: mode === 'permanent-deny' ? changedAt : '',
  };
  writeStateJson(POLICY_FILE, state);
  return state;
}

function getPermanentBlocksRecord(): { ips: string[] } {
  try {
    const raw = readStateJson<{ ips?: string[] }>(BLOCKS_FILE);
    if (!raw) return { ips: [] };
    return { ips: Array.isArray(raw.ips) ? raw.ips : [] };
  } catch {
    return { ips: [] };
  }
}

function writePermanentBlocks(ips: string[]) {
  writeStateJson(BLOCKS_FILE, { ips });
}

function getQueuedFirewallCommands(): FirewallCommand[] {
  try {
    const raw = readStateJson<FirewallQueue | FirewallCommand>(PENDING_FW);
    if (!raw) return [];
    if ('commands' in raw && Array.isArray(raw.commands)) return raw.commands;
    if ('ip' in raw && raw.ip) return [raw as FirewallCommand];
  } catch {}
  return [];
}

function queuePermanentBlock(ip: string) {
  const queued = getQueuedFirewallCommands();
  const alreadyQueued = queued.some((command) =>
    command.action === 'block' && command.ip === ip && command.scope === 'permanent'
  );
  if (alreadyQueued) return;

  queued.push({
    action: 'block',
    ip,
    scope: 'permanent',
    user: '',
    ts: new Date().toISOString(),
  });
  writeStateJson(PENDING_FW, { commands: queued });
}

export function applyProtectionModeToBans(
  mode: ProtectionMode,
  bans: Fail2banEntry[]
): { promoted: string[]; permanentBlocks: Set<string> } {
  const protectionState = getProtectionModeState();
  const current = getPermanentBlocksRecord();
  const permanent = new Set(current.ips);
  const promoted: string[] = [];
  const effectiveFromMs = protectionState.effective_from ? new Date(protectionState.effective_from).getTime() : NaN;

  if (mode === 'permanent-deny') {
    for (const ban of bans) {
      if (!ban.active || permanent.has(ban.ip)) continue;
      const bannedAtMs = new Date(ban.banned_at).getTime();
      if (!Number.isFinite(bannedAtMs) || !Number.isFinite(effectiveFromMs) || bannedAtMs < effectiveFromMs) {
        continue;
      }
      permanent.add(ban.ip);
      promoted.push(ban.ip);
      queuePermanentBlock(ban.ip);
    }
  }

  if (promoted.length > 0) {
    writePermanentBlocks([...permanent].sort());
  }

  return { promoted, permanentBlocks: permanent };
}
