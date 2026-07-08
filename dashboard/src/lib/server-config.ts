// ── Server configuration (central, env-driven) ───────────────────────────────
// Single source of truth for deployer-specific values. Every value reads from an
// environment variable; the installer bakes the real values in at build time
// (NEXT_PUBLIC_* in the dashboard image / .env). The fallbacks below are empty
// on purpose — this fails closed rather than shipping any one deployment's host,
// keys, or brand. For a fresh deployment, set these in .env.local / the wizard.

const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? '';  // full dashboard base, incl. basePath

// Bare host (no scheme/path) — used in VPN URIs where the client dials the host.
const SERVER_IP = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
const SERVER_DOMAIN = process.env.NEXT_PUBLIC_SERVER_DOMAIN ?? '';
const SERVER_PORT = Number(process.env.NEXT_PUBLIC_SERVER_PORT ?? 443);

// Reality (VLESS) public key + short ID — deployer-generated via `xray x25519`.
// Not cryptographic secrets (the pbk is handed to every client), but they ARE
// per-installation and must never be shared. Generated fresh at install time.
const VLESS_PBK = process.env.NEXT_PUBLIC_VLESS_PBK ?? '';
const VLESS_SID = process.env.NEXT_PUBLIC_VLESS_SID ?? '';
const VLESS_SNI = process.env.NEXT_PUBLIC_VLESS_SNI ?? 'www.cloudflare.com';

// Product brand — shown in subscription profile titles, client labels, etc.
// Set your own name via NEXT_PUBLIC_BRAND_NAME / the wizard.
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'VPN';

export const serverConfig = {
  publicBaseUrl: PUBLIC_BASE_URL,
  serverIp: SERVER_IP,
  serverDomain: SERVER_DOMAIN,
  serverPort: SERVER_PORT,
  vlessPbk: VLESS_PBK,
  vlessSid: VLESS_SID,
  vlessSni: VLESS_SNI,
  brandName: BRAND_NAME,
} as const;

export type ServerConfig = typeof serverConfig;
