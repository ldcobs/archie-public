import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { reputationSnapshot, getPermanentBlocks } from '@/lib/devices';
import { parseSshThreats, parseFail2ban, getBannedIps } from '@/lib/threats';
import { applyProtectionModeToBans, getProtectionMode, type ProtectionMode } from '@/lib/security-policy';
import { createMockSecurityResponse, shouldServeMockData } from '@/lib/mock-data';
import type { ThreatEntry, Fail2banEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface SecurityResponse {
  threatWindow: '24h' | '7d';
  ssh_threats: ThreatEntry[];
  fail2ban_bans: Fail2banEntry[];
  protection_mode: ProtectionMode;
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  const threatWindow = url.searchParams.get('threatWindow') === '24h' ? '24h' : '7d';
  const protectionMode = getProtectionMode();
  if (shouldServeMockData(url.host)) {
    return NextResponse.json(createMockSecurityResponse(threatWindow, protectionMode));
  }
  try {
    const threatWindowSeconds = threatWindow === '24h' ? 86400 : 7 * 86400;

    const [sshThreats, f2bBans] = await Promise.all([
      parseSshThreats(threatWindowSeconds),
      parseFail2ban(),
    ]);

    const banned = getBannedIps(f2bBans);
    const { permanentBlocks: enforcedBlocks } = applyProtectionModeToBans(protectionMode, f2bBans);
    const permBlocks = enforcedBlocks.size > 0 ? enforcedBlocks : getPermanentBlocks();

    // Non-blocking snapshot (see /api/stats): return cached reputation now and
    // warm uncached IPs in the background so the page renders instantly instead
    // of blocking on up to 200 external AbuseIPDB calls.
    const sshIps = sshThreats.map((t) => t.ip);
    const sshRep = reputationSnapshot(sshIps);
    for (const t of sshThreats) {
      t.banned = banned.has(t.ip);
      t.perm_blocked = permBlocks.has(t.ip);
      t.reputation = sshRep[t.ip] ?? null;
    }

    const f2bIps = f2bBans.map((b) => b.ip);
    const f2bRep = reputationSnapshot(f2bIps);
    for (const b of f2bBans) {
      b.perm_blocked = permBlocks.has(b.ip);
      b.reputation = f2bRep[b.ip] ?? null;
    }

    const response: SecurityResponse = {
      threatWindow,
      ssh_threats: sshThreats,
      fail2ban_bans: f2bBans,
      protection_mode: protectionMode,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[security]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
