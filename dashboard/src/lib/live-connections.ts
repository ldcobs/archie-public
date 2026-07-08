import fs from 'fs';

// Read via the shared host PID namespace (`pid: host`) — no bind mount
// needed; see health.ts for why a static bind mount of this file is racy.
const HOST_TCP6 = process.env.HOST_TCP6 ?? '/proc/1/net/tcp6';
const ESTABLISHED = '01';
const PORT_HEX    = '01BB'; // 443 decimal

/**
 * Parse /proc/1/net/tcp6 (host namespace, visible via pid: host) to find IPs
 * with live established connections on port 443. Mirrors the Python
 * implementation.
 */
export function getActiveIps(): Set<string> {
  const ips = new Set<string>();
  try {
    const lines = fs.readFileSync(HOST_TCP6, 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const localHex  = p[1];
      const state     = p[3];
      if (state !== ESTABLISHED) continue;

      const [, localPortHex] = localHex.split(':');
      if (localPortHex?.toUpperCase() !== PORT_HEX) continue;

      const remoteHex      = p[2];
      const [remoteIpHex]  = remoteHex.split(':');
      if (!remoteIpHex) continue;

      // IPv4-mapped IPv6: bytes 16-24 == FFFF0000, last 8 hex = IPv4 little-endian
      if (remoteIpHex.slice(16, 24).toUpperCase() === 'FFFF0000') {
        const h  = remoteIpHex.slice(24);
        const ip = [6, 4, 2, 0].map(i => parseInt(h.slice(i, i + 2), 16)).join('.');
        if (ip && ip !== '0.0.0.0' &&
            !ip.startsWith('10.') && !ip.startsWith('172.') &&
            !ip.startsWith('192.168.') && !ip.startsWith('127.')) ips.add(ip);
      }
    }
  } catch {
    // Not mounted or not readable — fall back to log-based detection
  }
  return ips;
}
