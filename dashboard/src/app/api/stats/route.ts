import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { listAllClients, emailToUuid, getVpnProtocol } from '@/lib/xray-config';
import { buildUserStats, getHourlyBuckets, getUniqueIpsHourly, getPrev24hCount } from '@/lib/xray-log';
import { evaluateDevicePolicy, getPermanentBlocks, reputationSnapshot } from '@/lib/devices';
import { parseSshThreats, parseFail2ban, getBannedIps, getSshHourly } from '@/lib/threats';
import { applyProtectionModeToBans, getProtectionMode } from '@/lib/security-policy';
import { getServerHealth } from '@/lib/health';
import { loadMeta } from '@/lib/user-meta';
import { getActiveIps } from '@/lib/live-connections';
import { loadTrafficStatsWindow, isTimeExpired, isTrafficExceeded } from '@/lib/traffic';
import { createMockStatsResponse, shouldServeMockData } from '@/lib/mock-data';
import { runEnforcement } from '@/lib/traffic-enforce';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Run enforcement at most once every 5 minutes to avoid hammering Xray on every poll
let lastEnforcementMs = 0;
const ENFORCE_INTERVAL_MS = 5 * 60 * 1000;

const VPN_API_BASE = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
const VPN_API_TOKEN = process.env.VPN_API_V3_TOKEN ?? '';

async function getRuntimeServiceHealth() {
  try {
    const headers: Record<string, string> = {};
    if (VPN_API_TOKEN) headers.Authorization = `Bearer ${VPN_API_TOKEN}`;
    const response = await fetch(`${VPN_API_BASE}/vpn-api/server-health`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  if (shouldServeMockData(url.host)) {
    return NextResponse.json(createMockStatsResponse());
  }
  try {
    const threatWindow = url.searchParams.get('threatWindow') === '24h' ? '24h' : '7d';
    const threatWindowSeconds = threatWindow === '24h' ? 86400 : 7 * 86400;

    const clients = listAllClients();
    const users = clients.map((c) => c.email);
    const e2u = emailToUuid();
    const metaStore = loadMeta();
    const proto = getVpnProtocol();
    const emailFlow = Object.fromEntries(clients.map((c) => [c.email, c.flow ?? '']));

    const liveIps = getActiveIps();

    const { stats, topDests, recent, allIps } = await buildUserStats(
      e2u,
      users,
      (email, ips) => evaluateDevicePolicy(email, ips),
      liveIps,
    );

    // Persistent 30-day totals from traffic_daily (not the live host counters,
    // which Xray resets to 0 on every restart — that was the "167 MB" bug).
    const trafficMap = loadTrafficStatsWindow(30);

    for (const s of stats) {
      s.meta = s.uuid ? (metaStore[s.uuid] ?? null) : null;
      s.vpnProtocol = {
        protocol: proto.protocol,
        security: proto.security,
        network: proto.network,
        flow: emailFlow[s.email] ?? '',
      };

      s.traffic = trafficMap[s.email] ?? null;

      // devices.limit is its own persisted value (device_approvals.json,
      // set via the Edit Limits "Device limit" field) - it used to get
      // silently overwritten here from meta.connectionLimit ("Max
      // concurrent networks"), which is a separate, independently-editable
      // field. That's why setting a device limit appeared to do nothing:
      // the very next /api/stats poll clobbered it back.

      const timeExpired = isTimeExpired(s.meta);
      const trafficExceeded = isTrafficExceeded(s.meta, s.traffic);
      s.expired = timeExpired || trafficExceeded;
      s.expiredReason = timeExpired ? 'time' : trafficExceeded ? 'traffic' : undefined;
    }

    stats.sort((a, b) => {
      const rank = (u: typeof a) => (u.status === 'online' ? 0 : u.conns_24h > 0 ? 1 : 2);
      return rank(a) - rank(b);
    });

    // Auto-enforce: if any user is expired or over quota, kick off enforcement
    // (debounced — at most once every 5 minutes to avoid Xray config churn)
    if (stats.some(s => s.expired)) {
      const now = Date.now();
      if (now - lastEnforcementMs > ENFORCE_INTERVAL_MS) {
        lastEnforcementMs = now;
        runEnforcement().catch(() => {});
      }
    }

    // Group ordering is derived from real metadata, not a hardcoded name list:
    // the owner's group sorts first, then alphabetical. "Ungrouped" always sinks last.
    const ownerGroups = new Set(
      stats.filter((s) => s.meta?.isOwner && s.meta?.group).map((s) => s.meta!.group),
    );
    const usedGroups = [...new Set(stats.map((s) => s.meta?.group ?? 'Ungrouped'))].sort((a, b) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      const oa = ownerGroups.has(a) ? 0 : 1;
      const ob = ownerGroups.has(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });

    const destList: StatsResponse['top_destinations'] = [];
    for (const [host, userMap] of topDests) {
      for (const [user, count] of userMap) {
        destList.push({ host, raw: host, user, count });
      }
    }
    destList.sort((a, b) => b.count - a.count);

    const [sshThreats, f2bBans, runtimeServiceHealth] = await Promise.all([
      parseSshThreats(threatWindowSeconds),
      parseFail2ban(),
      getRuntimeServiceHealth(),
    ]);

    const banned = getBannedIps(f2bBans);
    const protectionMode = getProtectionMode();
    const { permanentBlocks: enforcedBlocks } = applyProtectionModeToBans(protectionMode, f2bBans);
    const permBlocks = enforcedBlocks.size > 0 ? enforcedBlocks : getPermanentBlocks();

    // Non-blocking: reputation is threat-table enrichment, not core dashboard
    // data. Awaiting it here (up to 200 external AbuseIPDB calls, cold on every
    // restart) is what made the dashboard hang for seconds after login. Take a
    // cache snapshot now; uncached IPs warm in the background for the next poll.
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

    const base = getServerHealth();
    const rt = runtimeServiceHealth ?? {};
    // Only merge runtime service data when it has real uptime info (running !== null).
    // systemd-error responses have running: null — those must never replace the
    // proc-based detections already in base.
    function mergeService(baseKey: keyof typeof base, rtSvc: typeof rt.xray_service) {
      if (rtSvc && rtSvc.running !== null) return { [baseKey]: rtSvc };
      return {};
    }
    const serverHealth = {
      ...base,
      ...mergeService('xray_service',       rt.xray_service),
      ...mergeService('hysteria2_service',   rt.hysteria2_service),
      ...mergeService('nginx_service',       rt.nginx_service),
      ...mergeService('wg_service',          rt.wg_service),
      ...mergeService('dashboard_service',   rt.dashboard_service),
      ...mergeService('vpn_api_service',     rt.vpn_api_service),
      ...(rt.vpn_api_service?.running != null ? { vpn_api_running: rt.vpn_api_service!.running } : {}),
    };

    const response: StatsResponse = {
      users,
      active: stats,
      groups: usedGroups,
      top_destinations: destList.slice(0, 30),
      recent: recent.slice(0, 30),
      stats: {
        conns_24h: stats.reduce((s, u) => s + u.conns_24h, 0),
        unique_ips_24h: allIps.size,
      },
      ssh_threats: sshThreats,
      fail2ban_bans: f2bBans,
      server_health: serverHealth,
      perm_blocks: [...permBlocks],
      conns_hourly: getHourlyBuckets(),
      unique_ips_hourly: getUniqueIpsHourly(),
      ssh_hourly: getSshHourly(),
      conns_trend_pct: (() => {
        const prev = getPrev24hCount();
        const curr = stats.reduce((s, u) => s + u.conns_24h, 0);
        if (prev === 0) return null;
        return Math.round(((curr - prev) / prev) * 1000) / 10;
      })(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[stats]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
