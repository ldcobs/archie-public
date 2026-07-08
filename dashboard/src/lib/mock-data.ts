import type { Fail2banEntry, ReputationResult, ServerHealth, Session, StatsResponse, ThreatEntry, TopDomainEntry, TrafficStats, UserMeta, UserStat } from '@/lib/types';
import type { ProtectionMode } from './security-policy';

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function shouldServeMockData(host: string): boolean {
  if (process.env.FORCE_SAMPLE_DATA === '1' || process.env.NEXT_PUBLIC_FORCE_SAMPLE_DATA === '1') return true;
  // When running against a pulled VPS snapshot, bypass the localhost mock gate
  if (process.env.USE_VPS_SNAPSHOT === '1') return false;
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

function normalizeMockEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rep(score: number, isp: string, domain: string, usageType: string, lastHoursAgo: number, categories: string[]): ReputationResult {
  return {
    score,
    total_reports: Math.max(1, Math.round(score / 4)),
    distinct_users: Math.max(1, Math.round(score / 10)),
    is_tor: false,
    usage_type: usageType,
    isp,
    domain,
    last_reported: isoHoursAgo(lastHoursAgo),
    categories,
  };
}

function traffic(upMb: number, downMb: number): TrafficStats {
  const up = Math.round(upMb * 1024 * 1024);
  const down = Math.round(downMb * 1024 * 1024);
  return { up, down, total: up + down, resetAt: isoHoursAgo(24) };
}

function session(startHoursAgo: number, durationMin: number, ips: string[], conns: number): Session {
  const start = Date.now() - startHoursAgo * 3_600_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + durationMin * 60_000).toISOString(),
    ips,
    conns,
    durMin: durationMin,
  };
}

function topDomains(entries: Array<[string, number, string?, string?, string?]>): TopDomainEntry[] {
  return entries.map(([host, count, hostname, owner, site]) => ({ host, count, hostname, owner, site }));
}

function user(uuid: string, email: string, meta: UserMeta, lastSeenMinutesAgo: number, conns24h: number, approvedInfo: UserStat['devices']['approved_info'], trafficStats: TrafficStats, ips24h: UserStat['ips_24h'], topDomainsData: TopDomainEntry[], sessionsData: Session[]): UserStat {
  return {
    uuid,
    email,
    meta,
    vpnProtocol: { protocol: 'vless', security: 'reality', flow: 'xtls-rprx-vision', network: 'tcp' },
    online: false,
    status: 'offline',
    ips: [],
    ips_24h: ips24h,
    conns_5m: 0,
    conns_24h: conns24h,
    last_seen: isoMinutesAgo(lastSeenMinutesAgo),
    first_seen: isoDaysAgo(18),
    top_domains: topDomainsData,
    sessions: sessionsData,
    new_ips: [],
    flows: [],
    devices: {
      enabled: true,
      limit: 6,
      approved: approvedInfo.map((item) => item.ip),
      approved_manual: [],
      pending: [],
      rejected: [],
      pending_now: [],
      rejected_now: [],
      approved_count: approvedInfo.length,
      pending_count: 0,
      rejected_count: 0,
      warning: false,
      approved_info: approvedInfo,
      pending_info: [],
      rejected_info: [],
    },
    deviceEstimate: {
      activeNow: 0,
      active5m: 0,
      peakToday: Math.max(1, ips24h.length),
      sourceIps: ips24h.map((entry) => entry.ip),
      ispConflict: false,
      conflictIsps: [],
    },
    traffic: trafficStats,
    expired: false,
  };
}

function sampleThreats(): ThreatEntry[] {
  return [
    {
      ip: '27.79.0.80', flag: '🇻🇳', country: 'Vietnam', cc: 'VN', city: 'Da Nang', isp: 'Viettel Corporation', org: 'Viettel', mobile: false,
      count: 5, last_seen: isoDaysAgo(0), banned: true, perm_blocked: true,
      reputation: rep(100, 'Viettel Corporation', 'viettel.vn', 'Fixed Line ISP', 2, ['bruteforce', 'ssh']),
      attempts: { users: ['admin', 'installer', 'user', 'ubnt', 'squid'], offers: [] },
    },
    {
      ip: '34.78.115.170', flag: '🇧🇪', country: 'Belgium', cc: 'BE', city: 'Brussels', isp: 'Google LLC', org: 'Google Cloud', mobile: false,
      count: 1, last_seen: isoDaysAgo(1), banned: false, perm_blocked: false,
      reputation: rep(85, 'Google LLC', 'googleusercontent.com', 'Data Center/Web Hosting', 6, ['ssh']),
      attempts: { users: ['admin'], offers: [] },
    },
    {
      ip: '34.38.45.137', flag: '🇧🇪', country: 'Belgium', cc: 'BE', city: 'Brussels', isp: 'Google LLC', org: 'Google Cloud', mobile: false,
      count: 1, last_seen: isoDaysAgo(2), banned: false, perm_blocked: false,
      reputation: rep(80, 'Google LLC', 'googleusercontent.com', 'Data Center/Web Hosting', 8, ['ssh']),
      attempts: { users: ['ljvtf'], offers: ['diffie-hellman-group1-sha1'] },
    },
  ];
}

function sampleFail2ban(): Fail2banEntry[] {
  return [{
    ip: '27.79.0.80', flag: '🇻🇳', country: 'Vietnam', cc: 'VN', city: 'Da Nang', isp: 'Viettel Corporation', org: 'Viettel', mobile: false,
    jail: 'sshd', ban_count: 1, next_weeks: 2, banned_at: isoDaysAgo(4), unbanned_at: null, active: true, perm_blocked: true,
    reputation: rep(100, 'Viettel Corporation', 'viettel.vn', 'Fixed Line ISP', 2, ['bruteforce', 'ssh']),
  }];
}

function sampleServerHealth(): ServerHealth {
  return {
    uptime: '5d 20h 17m', uptime_seconds: 504000,
    load_1: 0.3, load_5: 0.44, load_15: 0.39,
    mem_total_mb: 15993, mem_used_mb: 4724, mem_pct: 30,
    disk_total_gb: 206.9, disk_used_gb: 96.8, disk_pct: 47,
    xray_running: true,
    hysteria2_running: true,
    nginx_running: true,
    wg_running: true,
    dashboard_running: true,
    vpn_api_running: true,
    net_tx_gb: 142.3,
    net_rx_gb: 88.7,
    xray_service: { running: true, uptime: '2d 14h 18m', uptime_seconds: 224280, last_restart: isoHoursAgo(62), source: 'systemd' },
    hysteria2_service: { running: true, uptime: '4d 3h 12m', uptime_seconds: 357120, last_restart: isoHoursAgo(99), source: 'systemd' },
    nginx_service: { running: true, uptime: '1d 7h 45m', uptime_seconds: 114300, last_restart: isoHoursAgo(31), source: 'systemd' },
    wg_service: { running: true, uptime: '5d 20h 17m', uptime_seconds: 504000, last_restart: isoDaysAgo(5), source: 'systemd' },
    dashboard_service: { running: true, uptime: '7h 26m', uptime_seconds: 26760, last_restart: isoHoursAgo(7), source: 'proc' },
    vpn_api_service: { running: true, uptime: '9h 11m', uptime_seconds: 33060, last_restart: isoHoursAgo(9), source: 'proc' },
  };
}

export function createMockStatsResponse(): StatsResponse {
  const familyMeta: UserMeta = { uuid: '28ea575a-0c28-463e-b816-5b5002ef9dcf', displayName: 'Family', group: 'My VPN', isOwner: false, expectedIsps: [], createdAt: isoDaysAgo(90) };
  const alexMeta: UserMeta = { uuid: '135ee5e7-8aa4-44c7-8ac3-46cb2e682a8c', displayName: 'Alex', group: 'Work', isOwner: false, expectedIsps: [], createdAt: isoDaysAgo(88) };
  const ownerMeta: UserMeta = { uuid: '15bcda6e-d84d-4fcc-93e6-6b190912b411', displayName: 'Owner', group: 'Family', isOwner: true, expectedIsps: [], createdAt: isoDaysAgo(120) };

  const familyIps = [{ ip: '203.0.113.51', flag: '🇺🇸', city: 'Chicago', country: 'United States', cc: 'US', isp: 'Example ISP', label: 'Chicago, United States', mobile: false }];
  const alexIps = [{ ip: '198.51.100.61', flag: '🇺🇸', city: 'Austin', country: 'United States', cc: 'US', isp: 'Example ISP 3', label: 'Austin, United States', mobile: false }];
  const ownerIps = [{ ip: '203.0.113.20', flag: '🇺🇸', city: 'Denver', country: 'United States', cc: 'US', isp: 'Example ISP', label: 'Denver, United States', mobile: false }];

  const users: UserStat[] = [
    user('28ea575a-0c28-463e-b816-5b5002ef9dcf', 'family@vpn.local', familyMeta, 240, 15909,
      [
        { ip: '203.0.113.51', flag: '🇺🇸', city: 'Chicago', country: 'United States', cc: 'US', isp: 'Example ISP', label: 'Chicago, United States', mobile: false },
        { ip: '203.0.113.52', flag: '🇺🇸', city: 'Chicago', country: 'United States', cc: 'US', isp: 'Example ISP 2', label: 'Chicago, United States', mobile: false },
      ],
      traffic(26.1, 58.5), familyIps,
      topDomains([
        ['149.154.167.151', 72, 'telegram.org', 'Telegram Messenger Network', 'telegram.org'],
        ['149.154.167.51', 72, 'telegram.org', 'Telegram Messenger Network', 'telegram.org'],
        ['91.105.192.100', 32, 'telegram.org', 'Telegram Messenger Inc', 'telegram.org'],
        ['198.51.100.71', 14, 'example.com', 'Example Corp', 'example.com'],
        ['142.250.74.110', 9, 'googlevideo.com', 'Google LLC', 'googlevideo.com'],
      ]),
      [session(26, 58, ['203.0.113.51'], 3), session(8, 91, ['203.0.113.51', '91.105.192.100'], 6)]),
    user('135ee5e7-8aa4-44c7-8ac3-46cb2e682a8c', 'alex@vpn.local', alexMeta, 540, 613,
      [{ ip: '198.51.100.61', flag: '🇺🇸', city: 'Austin', country: 'United States', cc: 'US', isp: 'Example ISP 3', label: 'Austin, United States', mobile: false }],
      traffic(0, 0), alexIps,
      topDomains([
        ['149.154.167.151', 20, 'telegram.org', 'Telegram Messenger Network', 'telegram.org'],
        ['149.154.167.41', 18, 'telegram.org', 'Telegram Messenger Network', 'telegram.org'],
        ['91.108.56.151', 11, 'telegram.org', 'Telegram Messenger Inc', 'telegram.org'],
        ['198.51.100.72', 6, 'example.com', 'Example Corp', 'example.com'],
      ]),
      [session(30, 24, ['198.51.100.61'], 2)]),
    user('15bcda6e-d84d-4fcc-93e6-6b190912b411', 'owner@vpn.local', ownerMeta, 14, 449,
      [
        { ip: '203.0.113.20', flag: '🇺🇸', city: 'Denver', country: 'United States', cc: 'US', isp: 'Example ISP', label: 'Denver, United States', mobile: false },
        { ip: '172.58.44.101', flag: '🇺🇸', city: 'Fort Lauderdale', country: 'United States', cc: 'US', isp: 'T-Mobile', label: 'Fort Lauderdale, United States', mobile: true },
        { ip: '104.28.240.1', flag: '🇺🇸', city: 'Miami', country: 'United States', cc: 'US', isp: 'Cloudflare', label: 'Miami, United States', mobile: false },
      ],
      traffic(3.2, 71.7), ownerIps,
      topDomains([
        ['104.26.6.171', 42, 'telegram.org', 'Cloudflare', 'telegram.org'],
        ['162.159.135.42', 25, 'cloudflare-dns.com', 'Cloudflare', 'one.one'],
        ['31.13.71.36', 16, 'whatsapp.net', 'Meta Platforms', 'whatsapp.net'],
        ['52.84.217.72', 8, 'amazonaws.com', 'Amazon.com', 'aws.amazon.com'],
      ]),
      [session(15, 66, ['203.0.113.20'], 4)]),
  ];

  const threats = sampleThreats();
  const fail2ban = sampleFail2ban();

  return {
    users: users.map((entry) => entry.email),
    active: users,
    groups: ['Family', 'My VPN', 'Work'],
    top_destinations: [
      { host: '149.154.167.151', raw: '149.154.167.151', user: 'family@vpn.local', count: 72 },
      { host: '149.154.167.51', raw: '149.154.167.51', user: 'family@vpn.local', count: 72 },
      { host: '91.105.192.100', raw: '91.105.192.100', user: 'family@vpn.local', count: 32 },
      { host: '149.154.167.151', raw: '149.154.167.151', user: 'alex@vpn.local', count: 20 },
      { host: '104.26.6.171', raw: '104.26.6.171', user: 'owner@vpn.local', count: 42 },
      { host: '31.13.71.36', raw: '31.13.71.36', user: 'owner@vpn.local', count: 16 },
    ],
    recent: [
      { time: isoMinutesAgo(14), email: 'owner@vpn.local', ip: '203.0.113.20', dest: '104.26.6.171' },
      { time: isoHoursAgo(4), email: 'family@vpn.local', ip: '203.0.113.51', dest: '149.154.167.151' },
      { time: isoHoursAgo(9), email: 'alex@vpn.local', ip: '198.51.100.61', dest: '149.154.167.41' },
    ],
    stats: { conns_24h: 16971, unique_ips_24h: 3 },
    conns_hourly: [220, 1080, 940, 980, 4550, 3720, 610, 120, 1860, 2920, 2780, 3170, 2550, 1230, 410, 980, 2250, 1970, 1670, 1550, 1700, 50, 410, 120].map((n, h) => ({ h, n })),
    unique_ips_hourly: [1, 1, 1, 2, 3, 2, 2, 1, 3, 2, 2, 3, 2, 2, 1, 1, 2, 2, 3, 2, 2, 1, 1, 1].map((n, h) => ({ h, n })),
    ssh_hourly: [0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0].map((n, h) => ({ h, n })),
    conns_trend_pct: -16.2,
    ssh_threats: threats,
    fail2ban_bans: fail2ban,
    server_health: sampleServerHealth(),
    perm_blocks: ['27.79.0.80', '203.0.113.12', '203.0.113.22', '203.0.113.32', '203.0.113.42', '203.0.113.52', '203.0.113.62', '203.0.113.72', '203.0.113.82', '203.0.113.92', '203.0.113.102', '203.0.113.112', '203.0.113.122', '203.0.113.132'],
  };
}

export function findMockUser(email: string): UserStat | null {
  const normalized = normalizeMockEmail(email);
  return createMockStatsResponse().active.find((user) => normalizeMockEmail(user.email) === normalized) ?? null;
}

export function createMockSecurityResponse(threatWindow: '24h' | '7d', protectionMode: ProtectionMode): { threatWindow: '24h' | '7d'; ssh_threats: ThreatEntry[]; fail2ban_bans: Fail2banEntry[]; protection_mode: ProtectionMode } {
  return {
    threatWindow,
    ssh_threats: sampleThreats(),
    fail2ban_bans: sampleFail2ban(),
    protection_mode: protectionMode,
  };
}
