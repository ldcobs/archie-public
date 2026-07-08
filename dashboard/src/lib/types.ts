// ── Geo / IP ──────────────────────────────────────────────────────────────────

export interface GeoInfo {
  country: string;
  cc: string;
  city: string;
  isp: string;
  org?: string;
  mobile: boolean;
  // Extended ip-api fields (best-effort; IP-geo accuracy — region/metro, not a pin).
  region?: string;     // regionName, e.g. "Austin"
  district?: string;   // sub-region / borough when available
  lat?: number;
  lon?: number;
  timezone?: string;   // IANA tz of the IP's region
  asn?: string;        // "AS12345 Example Telecom"
  proxy?: boolean;     // known proxy / VPN / Tor exit
  hosting?: boolean;   // datacenter / hosting provider (not residential/mobile)
}

export interface IpInfo extends GeoInfo {
  ip: string;
  flag: string;
  label: string; // "city, CC"
}

// ── Xray config ───────────────────────────────────────────────────────────────

export interface XrayClient {
  id: string;   // UUID
  flow: string;
  email: string;
}

// ── User metadata (keyed by UUID, stored in user_meta.json) ───────────────────

export interface UserMeta {
  uuid: string;
  displayName: string;   // e.g. "Alex"
  group: string;         // e.g. "My VPN", "Work", "Family"
  isOwner?: boolean;
  expectedIsps?: string[]; // e.g. ["MTS", "Beeline"] — flag if unexpected ISP
  notes?: string;
  createdAt: string;
  expiresAt?: string | null;      // ISO date — null or absent = no expiry
  trafficLimitGB?: number;        // 0 or absent = unlimited
  connectionLimit?: number;       // max simultaneous device IPs (0 = unlimited)
  protocols?: string[];           // protocol profile keys e.g. ["vless-reality","vmess-ws-tls"]
  // Subscription tracking
  lastSubFetch?: string;          // ISO timestamp of last /api/sub/{uuid} pull
  subFetchCount?: number;         // total times subscription was fetched
  detectedClient?: string;        // VPN client name detected from User-Agent
  detectedClientRaw?: string;     // raw User-Agent string
  // Sharing policy (per-key overrides; absent = platform default)
  unknownDevice?:  'require_approval' | 'allow' | 'reject';
  newCountry?:     'require_approval' | 'allow' | 'reject';
  newIsp?:         'warn' | 'allow' | 'reject';
  overflowAction?: 'auto_reject' | 'allow';
  // Enforcement
  disabled?: boolean;             // true = removed from xray by enforcement
  disabledReason?: 'traffic_limit' | 'expired' | 'manual' | null;
}

// ── Traffic stats (from Xray Stats API, accumulated by host cron) ─────────────

export interface TrafficStats {
  up: number;       // bytes uploaded (cumulative)
  down: number;     // bytes downloaded (cumulative)
  total: number;    // up + down
  resetAt: string;  // when counters were last reset
}

export interface UserMetaStore {
  [uuid: string]: UserMeta;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface Session {
  start: string;
  end: string;
  ips: string[];
  conns: number;
  durMin: number;
}

// ── Connection flow (Zeek vpn.log-style, from the xray access log) ──────────────
export interface ConnFlow {
  ts: string;     // ISO timestamp of the connection
  ip: string;     // source IP (id.orig_h / client_ip)
  sport: number;  // source port (id.orig_p)
  host: string;   // tunneled destination host / SNI (id.resp_h / sni)
  dport: string;  // destination port (id.resp_p), '' if unknown
}

// ── Device counting ───────────────────────────────────────────────────────────

export interface DeviceEstimate {
  // Heuristic device count from source port diversity
  activeNow: number;       // distinct IP:port combos in last 60s
  active5m: number;        // distinct IP:port combos in last 5min
  peakToday: number;       // peak concurrent in any 10s window today
  sourceIps: string[];     // distinct public IPs seen today
  ispConflict: boolean;    // same UUID active from 2+ different ISPs simultaneously
  conflictIsps: string[];  // the conflicting ISP names
}

// ── Device approval policy (ported from Python) ───────────────────────────────

export interface DeviceItem {
  first_seen: string;
  last_seen: string;
  source?: string;
  blocked?: boolean;
  blocked_at?: string;
  rejected_at?: string;
}

export interface UserDevicePolicy {
  enabled: boolean;
  limit: number;
  approved: Record<string, DeviceItem>;
  pending: Record<string, DeviceItem>;
  rejected: Record<string, DeviceItem>;
}

// Per-IP info enriched with device-store provenance + log activity, so the
// operator can see WHY an IP is here and HOW active it is — not just its geo.
export interface DeviceIpInfo extends IpInfo {
  source?: string;       // why approved: known_ip_seed | auto_trusted_isp | auto_registered | manual_approval
  firstSeen?: string;    // ISO — first time this IP was recorded for the key (device store)
  lastSeen?: string;     // ISO — most recent activity (device store, refined by log)
  conns?: number;        // connections in the 24h log window
}

export interface DevicePolicyResult {
  enabled: boolean;
  limit: number;
  approved: string[];
  approved_manual: string[];   // operator-vouched only (excludes auto_registered)
  pending: string[];
  rejected: string[];
  pending_now: string[];
  rejected_now: string[];
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  warning: boolean;
  approved_info: DeviceIpInfo[];
  pending_info: DeviceIpInfo[];
  rejected_info: DeviceIpInfo[];
}

// ── User stat (per key/UUID) ───────────────────────────────────────────────────

export interface VpnProtocol {
  protocol: string;   // e.g. "vless"
  security: string;   // e.g. "reality"
  flow: string;       // e.g. "xtls-rprx-vision"
  network: string;    // e.g. "tcp"
}

export interface UserStat {
  uuid: string;
  email: string;
  meta: UserMeta | null;
  vpnProtocol: VpnProtocol | null;
  online: boolean;
  status: 'online' | 'recent' | 'offline';
  ips: IpInfo[];           // active last 5min
  ips_24h: IpInfo[];       // all today
  conns_5m: number;
  conns_24h: number;
  last_seen: string | null;
  first_seen: string | null;
  top_domains: TopDomainEntry[];
  sessions: Session[];
  new_ips: string[];
  flows: ConnFlow[];       // recent connections (capped), most-recent first
  devices: DevicePolicyResult;
  deviceEstimate: DeviceEstimate;
  traffic: TrafficStats | null;
  expired: boolean;          // true if key is past expiry or over quota
  expiredReason?: string;    // 'time' | 'traffic' | null
}

export interface TopDomainEntry {
  host: string;
  count: number;
  hostname?: string;
  owner?: string;
  site?: string;
}

// ── Threats ───────────────────────────────────────────────────────────────────

export interface ThreatEntry extends GeoInfo {
  ip: string;
  flag: string;
  count: number;
  last_seen: string;   // ISO timestamp of most recent attack
  banned: boolean;
  perm_blocked: boolean;
  reputation: ReputationResult | null;
  attempts?: { users: string[]; offers: string[] };
}

export interface Fail2banEntry extends GeoInfo {
  ip: string;
  flag: string;
  jail: string;
  ban_count: number;
  next_weeks: number;
  banned_at: string;
  unbanned_at: string | null;
  active: boolean;
  perm_blocked: boolean;
  reputation: ReputationResult | null;
}

// ── Reputation ────────────────────────────────────────────────────────────────

export interface ReputationResult {
  score: number;
  total_reports: number;
  distinct_users: number;
  is_tor: boolean;
  usage_type: string;
  isp: string;
  domain: string;
  last_reported: string;
  categories: string[];
}

// ── Server health ─────────────────────────────────────────────────────────────

export interface ServiceRuntimeHealth {
  running: boolean | null;
  uptime: string | null;
  uptime_seconds: number | null;
  last_restart: string | null;
  source?: string;
}

export interface ServerHealth {
  uptime: string;
  uptime_seconds: number;
  load_1: number;
  load_5: number;
  load_15: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_pct: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_pct: number;
  xray_running: boolean | null;
  hysteria2_running: boolean | null;
  nginx_running: boolean | null;
  wg_running: boolean | null;
  net_tx_gb: number | null;
  net_rx_gb: number | null;
  cpu_model?: string;
  cpu_cores?: number;
  net_rx_mbps?: number | null;
  net_tx_mbps?: number | null;
  net_iface?: string;
  cert_expiry_days?: number | null;   // days until TLS cert expires; null = unreadable
  cert_domain?: string;
  dashboard_running?: boolean | null;
  vpn_api_running?: boolean | null;
  xray_service?: ServiceRuntimeHealth | null;
  hysteria2_service?: ServiceRuntimeHealth | null;
  nginx_service?: ServiceRuntimeHealth | null;
  wg_service?: ServiceRuntimeHealth | null;
  dashboard_service?: ServiceRuntimeHealth | null;
  vpn_api_service?: ServiceRuntimeHealth | null;
}

// ── API response ──────────────────────────────────────────────────────────────

export interface StatsResponse {
  users: string[];               // emails
  active: UserStat[];
  groups: string[];              // sorted group names from metadata
  top_destinations: { host: string; raw: string; user: string; count: number }[];
  recent: { time: string; email: string; ip: string; dest: string }[];
  stats: { conns_24h: number; unique_ips_24h: number };
  conns_hourly:      { h: number; n: number }[];  // 24 buckets, index 0 = 23h ago, 23 = most recent
  unique_ips_hourly: { h: number; n: number }[];  // unique source IPs per hour
  ssh_hourly:        { h: number; n: number }[];  // SSH fail attempts per hour
  conns_trend_pct:   number | null;               // % change vs previous 24h
  ssh_threats: ThreatEntry[];
  fail2ban_bans: Fail2banEntry[];
  server_health: ServerHealth;
  perm_blocks: string[];
}
