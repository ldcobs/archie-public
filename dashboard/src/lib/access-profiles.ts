// Single source of truth for invite "access profiles" — the named protocol
// bundles an operator picks when generating an invite. Client-safe (no node
// deps) so it can be imported by both the invite page UI and the API routes.
//
// Keep these IDs/protocol lists in sync with the PRESETS in NewKeyPanel.tsx and
// the chips on the invite page — they are intentionally identical.

export interface AccessProfile {
  id: string;
  label: string;
  protocols: string[];
}

export const ACCESS_PROFILES: AccessProfile[] = [
  { id: 'standard',    label: 'Standard',    protocols: ['vless-reality'] },
  { id: 'compatible',  label: 'Compatible',  protocols: ['vless-reality', 'vmess-ws-tls'] },
  { id: 'universal',   label: 'Universal',   protocols: ['vless-reality', 'vmess-ws-tls', 'trojan-tls'] },
  { id: 'performance', label: 'Performance', protocols: ['vless-reality', 'hysteria2', 'wireguard'] },
  { id: 'cdn-safe',    label: 'CDN Safe',    protocols: ['vless-ws-tls', 'vless-grpc-tls'] },
  { id: 'legacy',      label: 'Legacy',      protocols: ['vmess-ws-tls', 'vmess-grpc-tls', 'shadowsocks'] },
];

const DEFAULT_PROFILE = ACCESS_PROFILES[0]; // standard

/** Protocols for a profile id. Unknown/missing id falls back to Standard. */
export function profileProtocols(id?: string): string[] {
  const p = ACCESS_PROFILES.find(p => p.id === id);
  return [...(p ?? DEFAULT_PROFILE).protocols];
}

/** Human label for a profile id (falls back to the id itself). */
export function profileLabel(id?: string): string {
  return ACCESS_PROFILES.find(p => p.id === id)?.label ?? (id ?? DEFAULT_PROFILE.label);
}

/** Reverse-lookup: which profile id matches this exact protocol set (else 'custom'). */
export function detectProfile(protocols: string[]): string {
  const sorted = [...protocols].sort().join(',');
  for (const p of ACCESS_PROFILES) {
    if ([...p.protocols].sort().join(',') === sorted) return p.id;
  }
  return 'custom';
}

/**
 * Map the invite builder's device policy to a connectionLimit (max simultaneous
 * device IPs; 0 = unlimited). 'approval' is a posture concept enforced elsewhere
 * and is left unlimited here for now.
 */
export function devicePolicyToLimit(policy?: string): number {
  switch (policy) {
    case 'single': return 1;
    case 'multiple': return 0;
    case 'approval': return 0;
    default: return 0;
  }
}
