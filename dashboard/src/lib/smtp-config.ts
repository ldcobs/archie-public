// ── SMTP configuration (per-install, operator-editable, env fallback) ─────────
// Stored override lives in smtp_config.json (atomic JSON state, same pattern as
// posture-store); environment variables provide the defaults so a fresh install
// can be email-capable from .env / the installer without touching the UI.
//
// Secrets (pass) are never returned to the client — see redactedSmtpConfig().

import { readStateJson, writeStateJson } from './state-storage';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;       // true = implicit TLS (465); false = STARTTLS/none (587/25)
  user?: string;
  pass?: string;
  from: string;          // From: header, e.g. "My VPN <invites@example.com>"
}

// Public-safe shape for the Settings UI: no password, just whether one is set.
export interface RedactedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPass: boolean;
  configured: boolean;   // host + from present → sendable
  source: 'stored' | 'env' | 'none';
}

type StoredSmtp = Partial<SmtpConfig>;

function envSmtp(): StoredSmtp {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : undefined;
  const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw ? secureRaw === 'true' || secureRaw === '1' : undefined;
  return {
    host: host || undefined,
    port,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: from || undefined,
  };
}

function loadStored(): StoredSmtp | null {
  return readStateJson<StoredSmtp>('smtp_config.json');
}

/** Effective config: stored override wins per-field, env fills the gaps. */
export function loadSmtpConfig(): SmtpConfig {
  const env = envSmtp();
  const stored = loadStored() ?? {};
  const merged: StoredSmtp = {
    host: stored.host ?? env.host,
    port: stored.port ?? env.port ?? 587,
    secure: stored.secure ?? env.secure ?? false,
    user: stored.user ?? env.user,
    pass: stored.pass ?? env.pass,
    from: stored.from ?? env.from,
  };
  return {
    host: merged.host ?? '',
    port: merged.port ?? 587,
    secure: merged.secure ?? false,
    user: merged.user,
    pass: merged.pass,
    from: merged.from ?? '',
  };
}

export function isSmtpConfigured(cfg: SmtpConfig = loadSmtpConfig()): boolean {
  return Boolean(cfg.host && cfg.from);
}

/** Persist operator-edited fields. A blank `pass` keeps the existing stored one. */
export function saveSmtpConfig(input: Partial<SmtpConfig>): void {
  const stored = loadStored() ?? {};
  const next: StoredSmtp = { ...stored };
  if (input.host !== undefined) next.host = input.host.trim() || undefined;
  if (input.from !== undefined) next.from = input.from.trim() || undefined;
  if (input.user !== undefined) next.user = input.user.trim() || undefined;
  if (input.port !== undefined && Number.isFinite(input.port)) next.port = input.port;
  if (input.secure !== undefined) next.secure = input.secure;
  // Only overwrite pass when a non-empty value is provided (UI sends "" to keep).
  if (typeof input.pass === 'string' && input.pass.length > 0) next.pass = input.pass;
  writeStateJson('smtp_config.json', next);
}

export function redactedSmtpConfig(): RedactedSmtpConfig {
  const stored = loadStored() ?? {};
  const env = envSmtp();
  const cfg = loadSmtpConfig();
  const source: RedactedSmtpConfig['source'] =
    Object.keys(stored).length > 0 ? 'stored' : (env.host ? 'env' : 'none');
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user ?? '',
    from: cfg.from,
    hasPass: Boolean(cfg.pass),
    configured: isSmtpConfigured(cfg),
    source,
  };
}
