import { createHmac, randomBytes } from 'crypto';
import { readStateJson, writeStateJson } from './state-storage';
import { profileProtocols, devicePolicyToLimit } from './access-profiles';

const AUTH_SECRET = process.env.AUTH_SECRET ?? 'dev-only-change-me';
const DEFAULT_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface InviteToken {
  token: string;
  hmac: string;
  group: string;
  displayName?: string;
  email?: string;          // operator-suggested username/email for the invitee
  client?: string;         // VPN client the operator chose (e.g. 'hiddify', 'amnezia', 'v2rayng')
  profile?: string;        // access profile id → protocol bundle (e.g. 'performance')
  posture?: string;        // device posture preset: 'strict' | 'balanced' | 'open' (per-user, enforced)
  securityPolicy?: string; // 'temp-ban' | 'permanent-deny' (server-wide setting; recorded for display)
  trafficLimitGB?: number; // per-device traffic cap applied to the provisioned key
  devicePolicy?: string;   // 'single' | 'multiple' | 'approval'
  connectionLimit?: number; // derived from devicePolicy (0 = unlimited)
  brand?: string;          // customer/brand name shown on the invite page
  logo?: string;           // brand logo (data URL or URL) shown on the invite page
  supportContact?: string; // support email/URL shown on the invite page
  welcomeMessage?: string; // greeting shown to the invitee
  sentVia?: 'link' | 'email'; // how the operator delivered it (for the invites table)
  emailSent?: boolean;        // true once an invite email was successfully delivered
  emailError?: string;        // last SMTP error, when an email delivery failed
  resend?: boolean;           // true = re-access link for an existing user (pre-bound)
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  usedAt?: string;
  usedBy?: string; // the email that was created
}

export interface CreateInviteOptions {
  group: string;
  displayName?: string;
  email?: string;
  client?: string;
  profile?: string;
  posture?: string;
  securityPolicy?: string;
  trafficLimitGB?: number;
  devicePolicy?: string;
  brand?: string;
  logo?: string;
  supportContact?: string;
  welcomeMessage?: string;
  expiresInDays?: number;  // invite-link TTL (time to redeem); default 7
  sentVia?: 'link' | 'email';
  boundEmail?: string;     // resend: bind to an existing user so the link shows their access
  createdBy: string;
}

interface TokenStore {
  tokens: InviteToken[];
}

function hmacToken(token: string): string {
  return createHmac('sha256', AUTH_SECRET).update(token).digest('hex');
}

function load(): TokenStore {
  return readStateJson<TokenStore>('invite_tokens.json') ?? { tokens: [] };
}

function save(store: TokenStore) {
  writeStateJson('invite_tokens.json', store);
}

export function createInviteToken(opts: CreateInviteOptions): InviteToken {
  const token = randomBytes(24).toString('base64url');
  const now = new Date();
  const ttlDays = opts.expiresInDays && opts.expiresInDays > 0 ? opts.expiresInDays : DEFAULT_TTL_DAYS;
  const entry: InviteToken = {
    token,
    hmac: hmacToken(token),
    group: opts.group,
    displayName: opts.displayName,
    email: opts.email,
    client: opts.client,
    profile: opts.profile,
    posture: opts.posture,
    securityPolicy: opts.securityPolicy,
    trafficLimitGB: opts.trafficLimitGB,
    devicePolicy: opts.devicePolicy,
    connectionLimit: devicePolicyToLimit(opts.devicePolicy),
    brand: opts.brand,
    logo: opts.logo,
    supportContact: opts.supportContact,
    welcomeMessage: opts.welcomeMessage,
    sentVia: opts.sentVia ?? 'link',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlDays * DAY_MS).toISOString(),
    createdBy: opts.createdBy,
  };
  // Resend: bind the link to an existing user so it opens straight onto their
  // active access (no redeem step — the username already exists).
  if (opts.boundEmail) {
    entry.usedAt = now.toISOString();
    entry.usedBy = opts.boundEmail;
    entry.resend = true;
  }
  const store = load();
  store.tokens.push(entry);
  save(store);
  return entry;
}

/** Record the outcome of an invite-email delivery attempt on the token. */
export function recordInviteDelivery(token: string, ok: boolean, error?: string): void {
  const store = load();
  const entry = store.tokens.find(t => t.token === token);
  if (!entry) return;
  entry.emailSent = ok;
  entry.emailError = ok ? undefined : (error ?? 'Send failed.');
  save(store);
}

export function deleteInviteToken(token: string): boolean {
  const store = load();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter(t => t.token !== token);
  if (store.tokens.length === before) return false;
  save(store);
  return true;
}

export type InviteStatus = 'accepted' | 'expired' | 'revoked' | 'pending';

export interface InviteSummary {
  token: string;
  displayName?: string;
  email?: string;       // operator-suggested or the redeemed username
  group: string;
  profile?: string;
  sentVia: 'link' | 'email';
  emailSent?: boolean;
  emailError?: string;
  resend: boolean;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

function statusOf(entry: InviteToken): InviteStatus {
  if (entry.usedAt) return 'accepted';
  if (new Date(entry.expiresAt) < new Date()) return 'expired';
  return 'pending';
}

/** Safe, status-enriched list for the invites table (no hmac/secret fields). */
export function listInviteSummaries(): InviteSummary[] {
  return listInviteTokens()
    .map((t): InviteSummary => ({
      token: t.token,
      displayName: t.displayName,
      email: t.usedBy ?? t.email,
      group: t.group,
      profile: t.profile,
      sentVia: t.sentVia ?? 'link',
      emailSent: t.emailSent,
      emailError: t.emailError,
      resend: t.resend ?? false,
      status: statusOf(t),
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      usedAt: t.usedAt,
      usedBy: t.usedBy,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function validateInviteToken(token: string): InviteToken | { error: string } {
  const store = load();
  const entry = store.tokens.find(t => t.token === token);
  if (!entry) return { error: 'Invalid or expired invite link.' };
  if (entry.hmac !== hmacToken(token)) return { error: 'Invalid invite link.' };
  if (entry.usedAt) return { error: 'This invite link has already been used.' };
  if (new Date(entry.expiresAt) < new Date()) return { error: 'This invite link has expired.' };
  return entry;
}

export function consumeInviteToken(token: string, usedBy: string): boolean {
  const store = load();
  const entry = store.tokens.find(t => t.token === token);
  if (!entry || entry.usedAt) return false;
  entry.usedAt = new Date().toISOString();
  entry.usedBy = usedBy;
  save(store);
  return true;
}

export type InvitePageState = 'pending' | 'active' | 'expired' | 'revoked';

export interface InvitePageData {
  state: InvitePageState;
  token: string;
  group: string;
  displayName?: string;
  client?: string;          // VPN client the operator chose
  email?: string;           // set after provisioning
  profile?: string;         // access profile id selected by the operator
  devicePolicy?: string;    // 'single' | 'multiple' | 'approval'
  brand?: string;           // customer/brand name shown on the page
  logo?: string;            // brand logo shown on the page
  supportContact?: string;  // support email/URL shown on the page
  welcomeMessage?: string;  // greeting shown to the invitee
  expiresAt?: string;       // key expiry (from user meta) or invite-link expiry (pending)
  trafficLimitGB?: number;
  connectionLimit?: number; // max simultaneous device IPs (0 = unlimited)
  protocols?: string[];
  posture?: { preset: string; label: string; blurb: string };  // device posture enforcement
  securityPolicy?: { mode: string; label: string };            // fail2ban response policy
  keyDisabled?: boolean;
  subUrl?: string;
  directLink?: string;  // single protocol share URI (vless://…) for clients that
                        // import one config instead of a subscription (e.g. Amnezia)
  wgConfigUrl?: string; // downloadable WireGuard .conf, present when the profile has WG
}

// Resolve the device posture + security policy that apply to this invite. Read
// server-side (lazy require) so the public invite page can show them without an
// authed API call. Posture is resolved per-key when provisioned, else by group.
function resolvePolicies(
  email: string | undefined,
  group: string,
  overrides?: { posture?: string; securityPolicy?: string },
): Pick<InvitePageData, 'posture' | 'securityPolicy'> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadPostureStore } = require('./posture-store') as typeof import('./posture-store');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolvePreset, PRESET_META, PRESET_ORDER } = require('./posture') as typeof import('./posture');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProtectionMode } = require('./security-policy') as typeof import('./security-policy');

    // Posture: operator's per-invite choice wins; else the resolved per-key/group preset.
    const chosen = overrides?.posture;
    const preset = chosen && (PRESET_ORDER as string[]).includes(chosen)
      ? chosen as keyof typeof PRESET_META
      : resolvePreset(loadPostureStore(), email ?? '', group);
    const meta = PRESET_META[preset];

    // Security policy: per-invite choice if set, else the server-wide mode.
    const mode = overrides?.securityPolicy === 'permanent-deny' || overrides?.securityPolicy === 'temp-ban'
      ? overrides.securityPolicy
      : getProtectionMode();

    return {
      posture: { preset, label: meta.label, blurb: meta.blurb },
      securityPolicy: {
        mode,
        label: mode === 'permanent-deny' ? 'Permanent deny' : 'Temporary ban',
      },
    };
  } catch {
    return {};
  }
}

export function getInvitePageData(token: string, subBaseUrl: string): InvitePageData | null {
  const store = load();
  const entry = store.tokens.find(t => t.token === token);
  if (!entry) return null;
  if (entry.hmac !== hmacToken(token)) return null;

  // Operator-chosen branding/policy carried by the token, shown in every state.
  const tokenFields = {
    group: entry.group,
    client: entry.client,
    profile: entry.profile,
    devicePolicy: entry.devicePolicy,
    brand: entry.brand,
    logo: entry.logo,
    supportContact: entry.supportContact,
    welcomeMessage: entry.welcomeMessage,
  };

  // Not yet used — check if the invite itself expired
  if (!entry.usedAt) {
    const state: InvitePageState = new Date(entry.expiresAt) < new Date() ? 'expired' : 'pending';
    return {
      state,
      token,
      ...tokenFields,
      displayName: entry.displayName,
      email: entry.email,
      expiresAt: entry.expiresAt,
      trafficLimitGB: entry.trafficLimitGB,
      connectionLimit: entry.connectionLimit,
      protocols: profileProtocols(entry.profile),
      ...resolvePolicies(entry.email, entry.group, { posture: entry.posture, securityPolicy: entry.securityPolicy }),
    };
  }

  // Used — look up the provisioned user's meta
  const email = entry.usedBy!;
  // Lazy import to avoid circular deps at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emailToUuid, protocolUri, wireguardConf } = require('./xray-config') as typeof import('./xray-config');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadMeta } = require('./user-meta') as typeof import('./user-meta');

  const uuidMap = emailToUuid();
  const uuid = uuidMap[email];
  const meta = uuid ? (loadMeta()[uuid] ?? null) : null;

  const keyExpired = meta?.expiresAt ? new Date(meta.expiresAt) < new Date() : false;
  const keyDisabled = meta?.disabled ?? false;

  let state: InvitePageState = 'active';
  if (keyDisabled) state = 'revoked';
  else if (keyExpired) state = 'expired';

  const protocols = meta?.protocols ?? profileProtocols(entry.profile);
  // Single-config share link for clients that import one protocol (not a sub).
  // Pick the first protocol that has a shareable URI (skip wireguard/local ones).
  const label = meta?.displayName ?? entry.displayName ?? email;
  let directLink: string | undefined;
  if (uuid) {
    for (const p of protocols) {
      const uri = protocolUri(p, uuid, label, email);
      if (uri) { directLink = uri; break; }
    }
  }

  return {
    state,
    token,
    ...tokenFields,
    displayName: meta?.displayName ?? entry.displayName ?? email,
    email,
    expiresAt: meta?.expiresAt ?? undefined,
    trafficLimitGB: meta?.trafficLimitGB ?? entry.trafficLimitGB ?? undefined,
    connectionLimit: meta?.connectionLimit ?? entry.connectionLimit ?? undefined,
    protocols,
    ...resolvePolicies(email, entry.group, { posture: entry.posture, securityPolicy: entry.securityPolicy }),
    keyDisabled,
    subUrl: uuid ? `${subBaseUrl}/api/sub/${uuid}` : undefined,
    directLink,
    // Only expose the WG download when an actual peer config exists for this user,
    // so the button never points at a 404.
    wgConfigUrl: uuid && protocols.includes('wireguard') && wireguardConf(email)
      ? `${subBaseUrl}/api/wg-config/${uuid}`
      : undefined,
  };
}

export function listInviteTokens(): InviteToken[] {
  const store = load();
  // prune tokens older than 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  store.tokens = store.tokens.filter(t => new Date(t.createdAt) > cutoff);
  save(store);
  return store.tokens;
}
