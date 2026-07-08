// Security-posture model — "parental controls" for a VPN key. Pure logic, no fs,
// so it is safe to import on the client. The JSON store lives in posture-store.ts
// (server-only).

export type PosturePreset = 'strict' | 'balanced' | 'open';

export interface PostureRules {
  maxNetworks: number;                        // distinct ISPs live at once (Infinity = unlimited)
  geoScope: 'home' | 'warn_new' | 'any';      // allowed countries
  newIsp: 'block' | 'warn' | 'allow';         // first sighting of a network
  overflow: 'block' | 'warn' | 'allow';       // when networks exceed maxNetworks
  datacenter: 'block' | 'warn' | 'allow';     // active from a hosting/proxy IP (reseller tell)
}

export const PRESETS: Record<PosturePreset, PostureRules> = {
  strict:   { maxNetworks: 1,        geoScope: 'home',     newIsp: 'block', overflow: 'block', datacenter: 'block' },
  balanced: { maxNetworks: 2,        geoScope: 'warn_new', newIsp: 'warn',  overflow: 'warn',  datacenter: 'warn'  },
  open:     { maxNetworks: Infinity, geoScope: 'any',      newIsp: 'allow', overflow: 'allow', datacenter: 'allow' },
};

export const PRESET_META: Record<PosturePreset, { label: string; blurb: string }> = {
  strict:   { label: 'Strict',   blurb: '1 network · home country · block new ISPs' },
  balanced: { label: 'Balanced', blurb: '2 networks · warn on new ISP/country' },
  open:     { label: 'Open',     blurb: 'no limits' },
};

export const PRESET_ORDER: PosturePreset[] = ['strict', 'balanced', 'open'];
export const DEFAULT_PRESET: PosturePreset = 'balanced';

export type PostureState = 'in' | 'review' | 'out';

export interface Violation {
  severity: 'hard' | 'soft';   // hard → out of posture, soft → needs review
  rule: 'max_networks' | 'impossible_travel' | 'new_isp' | 'geo' | 'traffic' | 'datacenter' | 'conflict';
  title: string;               // plain-English, operator-facing
  isp?: string;                // offending network (enables a targeted Block/Allow action)
}

export interface ActiveNet {
  isp: string;
  country: string;
  knownIsp: boolean;      // ISP is part of the locked baseline
  knownCountry: boolean;  // country is part of the locked baseline
  lat?: number;
  lon?: number;
  datacenter?: boolean;   // proxy / hosting IP — not a residential/mobile user
}

// Generous threshold: IP-geo is coarse (mobile = carrier gateway), so only flag
// concurrent positions that are implausibly far apart regardless of accuracy.
const IMPOSSIBLE_KM = 600;
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface PostureInput {
  preset: PosturePreset;
  activeNets: ActiveNet[];     // networks live *now*
  trafficGB?: number;          // key total this period
  trafficCapGB?: number;       // 0/undefined = no cap
  ispConflict?: boolean;       // deviceEstimate: 2+ un-vouched ISPs active in 60s
  conflictIsps?: string[];     // the conflicting ISP names
}

export interface PostureResult {
  state: PostureState;
  violations: Violation[];
}

// Evaluate a key against its posture. Pure — same logic can run client (display) or
// server (enforcement).
export function evaluatePosture(inp: PostureInput): PostureResult {
  const r = PRESETS[inp.preset];
  const v: Violation[] = [];
  const active = inp.activeNets;

  // Always-on tripwire (independent of preset, even Open): the same key live from 2+
  // different un-vouched ISPs within 60s. Clears when you Keep/Block the conflicting
  // networks (deviceEstimate already excludes vouched ones).
  if (inp.ispConflict) {
    const isps = inp.conflictIsps?.length ? inp.conflictIsps.join(' + ') : 'two different ISPs';
    v.push({ severity: 'hard', rule: 'conflict', title: `Live from 2+ networks at once (${isps}) — concurrent use from different ISPs` });
  }

  // Max concurrent networks
  if (active.length > r.maxNetworks) {
    const sev = r.overflow === 'block' || r.maxNetworks <= 1 ? 'hard' : r.overflow === 'warn' ? 'soft' : null;
    if (sev) v.push({ severity: sev, rule: 'max_networks', title: `Live from ${active.length} networks at once — posture allows ${r.maxNetworks === Infinity ? '∞' : r.maxNetworks}` });
  }

  // Impossible travel — concurrent positions implausibly far apart (always-on tripwire).
  // Distance-based when we have coordinates; falls back to country-level otherwise.
  const located = active.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
  let maxKm = 0; let farPair: [ActiveNet, ActiveNet] | null = null;
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const km = haversineKm(located[i].lat!, located[i].lon!, located[j].lat!, located[j].lon!);
      if (km > maxKm) { maxKm = km; farPair = [located[i], located[j]]; }
    }
  }
  if (farPair && maxKm > IMPOSSIBLE_KM) {
    v.push({ severity: 'hard', rule: 'impossible_travel', title: `Live ${Math.round(maxKm)} km apart at once — ${farPair[0].country || farPair[0].isp} and ${farPair[1].country || farPair[1].isp}` });
  } else {
    const countries = [...new Set(active.map((a) => a.country).filter(Boolean))];
    if (countries.length > 1) {
      v.push({ severity: 'hard', rule: 'impossible_travel', title: `Live from ${countries.join(' and ')} at the same time` });
    }
  }

  // Datacenter / proxy — a residential/mobile key live from a hosting IP is a reseller
  // tell. Severity scales with preset: Strict = hard, Balanced = review, Open = off.
  for (const n of active) {
    if (n.datacenter && r.datacenter !== 'allow') {
      v.push({ severity: r.datacenter === 'block' ? 'hard' : 'soft', rule: 'datacenter', title: `Active from a datacenter/proxy IP (${n.isp}) — not a residential or mobile network`, isp: n.isp });
    }
  }

  // New network / ISP, and geographic scope
  for (const n of active) {
    if (!n.knownIsp) {
      if (r.newIsp === 'block') v.push({ severity: 'hard', rule: 'new_isp', title: `New network ${n.isp}${n.country ? ` (${n.country})` : ''} — posture blocks new ISPs`, isp: n.isp });
      else if (r.newIsp === 'warn') v.push({ severity: 'soft', rule: 'new_isp', title: `New network ${n.isp}${n.country ? ` (${n.country})` : ''} appeared`, isp: n.isp });
    }
    if (r.geoScope === 'home' && n.country && !n.knownCountry) {
      v.push({ severity: 'hard', rule: 'geo', title: `Active from ${n.country} — posture allows home country only`, isp: n.isp });
    } else if (r.geoScope === 'warn_new' && n.country && !n.knownCountry && n.knownIsp) {
      v.push({ severity: 'soft', rule: 'geo', title: `New country ${n.country} for a known network`, isp: n.isp });
    }
  }

  // Per-key traffic cap
  if (inp.trafficCapGB && inp.trafficGB && inp.trafficGB > inp.trafficCapGB) {
    v.push({ severity: 'soft', rule: 'traffic', title: `Used ${inp.trafficGB.toFixed(1)} GB — over the ${inp.trafficCapGB} GB cap` });
  }

  const state: PostureState = v.some((x) => x.severity === 'hard') ? 'out' : v.length ? 'review' : 'in';
  return { state, violations: dedupe(v) };
}

function dedupe(v: Violation[]): Violation[] {
  const seen = new Set<string>();
  return v.filter((x) => {
    const k = `${x.rule}:${x.isp ?? ''}:${x.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Posture store shape (persisted as JSON by posture-store.ts) ─────────────────
export interface PostureStore {
  groups: Record<string, PosturePreset>;   // group default
  keys: Record<string, PosturePreset>;     // per-key override (by email)
}

export function resolvePreset(store: PostureStore | undefined, email: string, group: string | undefined): PosturePreset {
  return store?.keys?.[email] ?? (group ? store?.groups?.[group] : undefined) ?? DEFAULT_PRESET;
}
