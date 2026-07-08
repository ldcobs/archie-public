import fs from 'fs';
import crypto from 'crypto';
import type { ServerHealth, ServiceRuntimeHealth } from './types';

// Host network state is exposed one of two ways depending on the compose
// layout, and they are NOT interchangeable:
//   - bind-mounted at /host_net/*  (this dashboard container: no pid:host,
//     the host's /proc/1/net/* files are mounted in)
//   - directly at /proc/1/net/*    (when the container shares the host PID
//     namespace via `pid: host`, so /proc/1 IS the host init)
// Reading the wrong one silently reports EVERY host service as "not running"
// (the container's own netns has none of them), so try both layouts in order.
// An explicit env override still wins for anyone with a custom mount path.
const HOST_NET_ENV: Record<string, string | undefined> = {
  tcp6: process.env.HOST_TCP6,
  tcp:  process.env.HOST_TCP,
  udp6: process.env.HOST_UDP6,
  dev:  process.env.HOST_DEV,
};

function readHostNet(name: 'tcp' | 'tcp6' | 'udp6' | 'dev'): string {
  const candidates = [HOST_NET_ENV[name], `/host_net/${name}`, `/proc/1/net/${name}`]
    .filter((p): p is string => !!p);
  let lastErr: unknown;
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (err) { lastErr = err; }
  }
  throw lastErr ?? new Error(`host net ${name} unreadable`);
}

// Module-level cache for live throughput delta
let _prevNet: { ts: number; rx: number; tx: number } | null = null;

function formatDuration(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86400);
  const hr = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return d ? `${d}d ${hr}h ${m}m` : `${hr}h ${m}m`;
}

function serviceFallback(running: boolean | null): ServiceRuntimeHealth {
  return {
    running,
    uptime: null,
    uptime_seconds: null,
    last_restart: null,
    source: 'local-fallback',
  };
}

function readHostDev(): { iface: string; rx: number; tx: number } | null {
  try {
    for (const line of readHostNet('dev').split('\n')) {
      const m = line.trim().match(/^(eth\d+|ens\d+|enp\S+):\s+(\d+)(?:\s+\d+){7}\s+(\d+)/);
      if (m) return { iface: m[1], rx: parseInt(m[2], 10), tx: parseInt(m[3], 10) };
    }
  } catch { /* fallback below */ }
  return null;
}

export function getServerHealth(): ServerHealth {
  const h: Partial<ServerHealth> = {};
  const dashboardUptimeSeconds = Math.max(0, Math.floor(process.uptime()));

  // Uptime
  try {
    const s = Math.floor(parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]));
    const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    h.uptime = d ? `${d}d ${hr}h ${m}m` : `${hr}h ${m}m`;
    h.uptime_seconds = s;
  } catch { h.uptime = 'unknown'; h.uptime_seconds = 0; }

  // Load
  try {
    const parts = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
    h.load_1 = parseFloat(parts[0]); h.load_5 = parseFloat(parts[1]); h.load_15 = parseFloat(parts[2]);
  } catch { h.load_1 = h.load_5 = h.load_15 = 0; }

  // Memory
  try {
    const mem: Record<string, number> = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const [k, v] = line.split(':');
      if (k && v) mem[k.trim()] = parseInt(v.trim(), 10);
    }
    const total = mem['MemTotal'] ?? 1, avail = mem['MemAvailable'] ?? 0, used = total - avail;
    h.mem_total_mb = Math.round(total / 1024);
    h.mem_used_mb  = Math.round(used / 1024);
    h.mem_pct      = Math.round((used / total) * 100);
  } catch { h.mem_total_mb = h.mem_used_mb = h.mem_pct = 0; }

  // Disk
  try {
    const stat = fs.statfsSync('/');
    const total = stat.blocks * stat.bsize, free = stat.bfree * stat.bsize, used = total - free;
    h.disk_total_gb = Math.round(total / 1e9 * 10) / 10;
    h.disk_used_gb  = Math.round(used  / 1e9 * 10) / 10;
    h.disk_pct      = total ? Math.round((used / total) * 100) : 0;
  } catch { h.disk_total_gb = h.disk_used_gb = h.disk_pct = 0; }

  // CPU model + cores — /proc/cpuinfo is shared with host (same kernel)
  try {
    let model = '', cores = 0;
    for (const line of fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
      if (line.startsWith('model name') && !model) model = line.split(':')[1]?.trim() ?? '';
      if (line.startsWith('processor')) cores++;
    }
    h.cpu_model = model || 'Unknown';
    h.cpu_cores = cores || 1;
  } catch { /* optional */ }

  // Xray — port 443 listening in host tcp6
  try {
    const tcp6 = readHostNet('tcp6');
    h.xray_running = tcp6.includes(':01BB') && tcp6.includes(' 0A ');
  } catch {
    try {
      const logPath = process.env.LOG_ACCESS ?? '/var/log/xray/access.log';
      h.xray_running = (Date.now() - fs.statSync(logPath).mtimeMs) / 1000 < 300;
    } catch { h.xray_running = null; }
  }

  // Hysteria2 — UDP port 2096 (hex 0x0830) — binds IPv6 dual-stack, check udp6
  try {
    h.hysteria2_running = readHostNet('udp6').includes(':0830');
  } catch { h.hysteria2_running = null; }

  // nginx — TCP port 80 (hex 0x0050) in HOST tcp namespace
  try {
    const tcp = readHostNet('tcp');
    h.nginx_running = tcp.includes(':0050') && tcp.includes(' 0A ');
  } catch { h.nginx_running = null; }

  // WireGuard — wg0 interface in HOST net/dev
  try {
    h.wg_running = readHostNet('dev').includes('wg0:');
  } catch { h.wg_running = null; }

  h.xray_service = serviceFallback(h.xray_running ?? null);
  h.hysteria2_service = serviceFallback(h.hysteria2_running ?? null);
  h.nginx_service = serviceFallback(h.nginx_running ?? null);
  h.wg_service = serviceFallback(h.wg_running ?? null);
  h.dashboard_running = true;
  h.dashboard_service = {
    running: true,
    uptime: formatDuration(dashboardUptimeSeconds),
    uptime_seconds: dashboardUptimeSeconds,
    last_restart: new Date(Date.now() - dashboardUptimeSeconds * 1000).toISOString(),
    source: 'node-process',
  };
  h.vpn_api_running = null;
  h.vpn_api_service = serviceFallback(null);

  // TLS certificate expiry — read from Let's Encrypt live dir mounted at /host_certs
  try {
    const certsDir = '/host_certs/live';
    const domains = fs.readdirSync(certsDir).filter(d => !d.startsWith('README'));
    if (domains.length > 0) {
      const domain = domains[0];
      const pem = fs.readFileSync(`${certsDir}/${domain}/fullchain.pem`, 'utf8');
      const cert = crypto.X509Certificate ? new crypto.X509Certificate(pem) : null;
      if (cert) {
        const expiry = new Date(cert.validTo);
        h.cert_expiry_days = Math.floor((expiry.getTime() - Date.now()) / 86400000);
        h.cert_domain = domain;
      }
    }
  } catch { h.cert_expiry_days = null; }

  // Live network throughput — delta since last call
  try {
    const now = Date.now() / 1000;
    const cur = readHostDev();
    if (cur) {
      h.net_iface = cur.iface;
      if (_prevNet && now - _prevNet.ts > 0.5) {
        const dt = now - _prevNet.ts;
        h.net_rx_mbps = Math.max(0, Math.round(((cur.rx - _prevNet.rx) * 8 / dt / 1e6) * 100) / 100);
        h.net_tx_mbps = Math.max(0, Math.round(((cur.tx - _prevNet.tx) * 8 / dt / 1e6) * 100) / 100);
      } else {
        h.net_rx_mbps = 0; h.net_tx_mbps = 0;
      }
      _prevNet = { ts: now, rx: cur.rx, tx: cur.tx };
      h.net_rx_gb = Math.round(cur.rx / 1e9 * 10) / 10;
      h.net_tx_gb = Math.round(cur.tx / 1e9 * 10) / 10;
    }
  } catch { h.net_rx_gb = h.net_tx_gb = null; }

  return h as ServerHealth;
}
