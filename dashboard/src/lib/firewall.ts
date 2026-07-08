import fs from 'fs';
import path from 'path';
import { writeJsonFileAtomic } from './state-storage';

const STATE_DIR  = process.env.STATE_DIR ?? '/app/vpn-api';
const PENDING_FW = path.join(STATE_DIR, 'pending_firewall.json');

interface FwCommand {
  action: 'block' | 'unblock';
  ip: string;
  scope: string;
  user: string;
  ts: string;
}

interface FwQueue { commands: FwCommand[] }

export function queueFirewallCommand(
  action: 'block' | 'unblock',
  ip: string,
  scope = 'permanent',
  user = ''
): boolean {
  try {
    const cmd: FwCommand = { action, ip, scope, user, ts: new Date().toISOString() };
    let queued: FwCommand[] = [];
    if (fs.existsSync(PENDING_FW)) {
      try {
        const existing = JSON.parse(fs.readFileSync(PENDING_FW, 'utf8')) as FwQueue | FwCommand;
        if ('commands' in existing && Array.isArray(existing.commands)) {
          queued = existing.commands;
        } else if ('ip' in existing) {
          queued = [existing as FwCommand];
        }
      } catch {}
    }
    queued.push(cmd);
    writeJsonFileAtomic(PENDING_FW, { commands: queued });
    return true;
  } catch {
    return false;
  }
}
