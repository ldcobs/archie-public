import fs from 'fs';
import path from 'path';
import type { GeoInfo, IpInfo } from './types';
import { writeJsonFileAtomic } from './state-storage';

const STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const GEO_CACHE_FILE = path.join(STATE_DIR, 'geo_cache.json');
const GEO_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

// ip-api fields (free endpoint). The extended set (region/lat/lon/timezone/as/
// proxy/hosting) was previously discarded; we now capture it for area display,
// distance-based impossible-travel, and datacenter-IP detection.
const GEO_FIELDS = 'status,country,countryCode,regionName,district,city,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query';

function mapGeo(item: Record<string, unknown>): GeoInfo {
  const lat = typeof item.lat === 'number' ? item.lat : undefined;
  const lon = typeof item.lon === 'number' ? item.lon : undefined;
  return {
    country: (item.country as string) ?? '',
    cc: (item.countryCode as string) ?? '',
    city: (item.city as string) ?? '',
    isp: (item.isp as string) ?? '',
    org: (item.org as string) ?? '',
    mobile: !!item.mobile,
    region: (item.regionName as string) || undefined,
    district: (item.district as string) || undefined,
    lat, lon,
    timezone: (item.timezone as string) || undefined,
    asn: (item.as as string) || undefined,
    proxy: !!item.proxy,
    hosting: !!item.hosting,
  };
}

interface GeoCacheEntry {
  lookedUpAt: string;
  data: GeoInfo;
}

const cache = new Map<string, GeoCacheEntry>();
const IP_RE = /^\d+\.\d+\.\d+\.\d+$/;
let cacheLoaded = false;

function ensureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch {}
}

function loadPersistentCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8')) as Record<string, GeoCacheEntry>;
    for (const [ip, entry] of Object.entries(raw ?? {})) {
      if (!entry?.lookedUpAt || !entry?.data) continue;
      cache.set(ip, entry);
    }
  } catch {}
}

function savePersistentCache() {
  ensureStateDir();
  try {
    writeJsonFileAtomic(GEO_CACHE_FILE, Object.fromEntries(cache));
  } catch {}
}

function isFresh(entry?: GeoCacheEntry): boolean {
  if (!entry?.lookedUpAt) return false;
  const age = Date.now() - new Date(entry.lookedUpAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < GEO_CACHE_TTL_MS;
}

function setCache(ip: string, data: GeoInfo) {
  cache.set(ip, { lookedUpAt: new Date().toISOString(), data });
}

async function geolocateOne(ip: string): Promise<GeoInfo | null> {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=${GEO_FIELDS}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const item = await res.json() as Record<string, unknown>;
    if (item.status !== 'success') return null;
    return mapGeo(item);
  } catch {
    return null;
  }
}

export function flag(cc: string): string {
  if (!cc || cc.length !== 2) return '';
  return (
    String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65) +
    String.fromCodePoint(0x1f1e6 + cc.charCodeAt(1) - 65)
  );
}

export async function geolocateBatch(ips: string[]): Promise<void> {
  loadPersistentCache();
  const need = [...new Set(ips)].filter(ip => {
    if (!IP_RE.test(ip)) return false;
    return !isFresh(cache.get(ip));
  });
  if (!need.length) return;

  let changed = false;
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100).map(ip => ({
      query: ip,
      fields: GEO_FIELDS,
    }));
    try {
      const res = await fetch('http://ip-api.com/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        for (const ip of need.slice(i, i + 100)) {
          const item = await geolocateOne(ip);
          if (item) {
            setCache(ip, item);
            changed = true;
          }
        }
        continue;
      }
      const items = await res.json() as Array<Record<string, unknown>>;
      for (const item of items) {
        setCache(item.query as string, mapGeo(item));
        changed = true;
      }
    } catch {
      for (const ip of need.slice(i, i + 100)) {
        const item = await geolocateOne(ip);
        if (item) {
          setCache(ip, item);
          changed = true;
        }
      }
    }
  }

  if (changed) savePersistentCache();
}

export function geo(ip: string): GeoInfo {
  loadPersistentCache();
  return cache.get(ip)?.data ?? { country: '', cc: '', city: '', isp: '', org: '', mobile: false };
}

export function ipInfo(ip: string): IpInfo {
  const g = geo(ip);
  const parts = [g.city, g.cc].filter(Boolean);
  return {
    ...g,
    ip,
    flag: flag(g.cc),
    label: parts.join(', '),
  };
}
