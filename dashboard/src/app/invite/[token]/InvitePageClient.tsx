'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  IconShield, IconShieldOff, IconShieldCheck, IconAlertTriangle, IconCheck, IconCopy,
  IconExternalLink, IconRefresh, IconChevronDown, IconChevronUp, IconLock,
  IconBrandAppleFilled, IconBrandWindowsFilled, IconTerminal2,
  IconUser, IconKey, IconCalendar, IconGauge, IconUsers, IconBolt, IconWifi,
  IconLoader2, IconDevices, IconDownload,
} from '@tabler/icons-react';

// Filled Android Bugdroid — same geometry as Tabler paths, converted to filled shapes
const IconAndroidFilled = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    {/* Antennae */}
    <rect x="7.3" y="2.5" width="1.6" height="4" rx="0.8" transform="rotate(-20 7.3 2.5)"/>
    <rect x="15.1" y="2.5" width="1.6" height="4" rx="0.8" transform="rotate(20 15.1 2.5)"/>
    {/* Head + body filled — based on Tabler path */}
    <path d="M7 9h10v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a5 5 0 0 1 10 0z"/>
    {/* Left arm */}
    <rect x="3" y="9.5" width="3" height="7" rx="1.5"/>
    {/* Right arm */}
    <rect x="18" y="9.5" width="3" height="7" rx="1.5"/>
    {/* Left leg */}
    <rect x="7.5" y="17.5" width="3" height="4.5" rx="1.5"/>
    {/* Right leg */}
    <rect x="13.5" y="17.5" width="3" height="4.5" rx="1.5"/>
  </svg>
);

// Tux the Linux penguin — classic outline
const IconLinuxTux = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    {/* Head */}
    <circle cx="12" cy="6" r="3.2"/>
    {/* Eyes */}
    <circle cx="10.7" cy="5.5" r="0.5" fill="currentColor" stroke="none"/>
    <circle cx="13.3" cy="5.5" r="0.5" fill="currentColor" stroke="none"/>
    {/* Beak */}
    <path d="M11 7.3 L12 9 L13 7.3"/>
    {/* Body */}
    <path d="M8 11.5 C7 11 6 12 6 14.5 C6 17.5 7 20 9 20.5 L15 20.5 C17 20 18 17.5 18 14.5 C18 12 17 11 16 11.5 C15 12 14.5 10 12 10 C9.5 10 9 12 8 11.5 Z"/>
    {/* Belly */}
    <ellipse cx="12" cy="16" rx="3" ry="3.5"/>
    {/* Left foot */}
    <path d="M9.5 20.5 L8 22.5 L11.5 22.5"/>
    {/* Right foot */}
    <path d="M14.5 20.5 L16 22.5 L12.5 22.5"/>
  </svg>
);
import { apiUrl, BASE_PATH } from '@/lib/api-path';
import type { InvitePageData, InvitePageState } from '@/lib/invite-tokens';
import { ACCESS_PROFILES, detectProfile } from '@/lib/access-profiles';
import { clientSupportsAny, inviteClientDefs } from '@/lib/client-matrix';

// ── Types ──────────────────────────────────────────────────────────────────────

type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'linux';
interface RoleEntry {
  key: string; role: string; color: string; dimColor: string;
  Icon: React.ComponentType<{ size?: number; color?: string; stroke?: number }>;
}

// ── Static data ────────────────────────────────────────────────────────────────

const PLATFORM_TABS: { id: Platform; label: string; Icon: React.ComponentType<{ size?: number; stroke?: number }> }[] = [
  { id: 'ios',     label: 'iPhone / iPad', Icon: IconBrandAppleFilled   },
  { id: 'android', label: 'Android',       Icon: IconAndroidFilled      },
  { id: 'windows', label: 'Windows',       Icon: IconBrandWindowsFilled },
  { id: 'mac',     label: 'macOS',         Icon: IconBrandAppleFilled   },
  { id: 'linux',   label: 'Linux',         Icon: IconLinuxTux           },
];

const CLIENT_DEFS = inviteClientDefs();

const PROTOCOL_ROLES: (Omit<RoleEntry, 'key'> & { keys: string[] })[] = [
  { keys: ['vless-reality'],                                            role: 'Recommended', color: '#00d4ff', dimColor: 'rgba(0,212,255,0.12)',  Icon: IconShieldCheck },
  { keys: ['vmess-ws-tls','vless-ws-tls','trojan-ws-tls','trojan-tls'], role: 'Backup',       color: '#8b5cf6', dimColor: 'rgba(139,92,246,0.12)', Icon: IconWifi        },
  { keys: ['hysteria2'],                                                role: 'Fast',         color: '#22e66b', dimColor: 'rgba(34,230,107,0.12)', Icon: IconBolt        },
  { keys: ['wireguard'],                                                role: 'Native VPN',   color: '#ff625a', dimColor: 'rgba(255,98,90,0.12)',  Icon: IconShield      },
];

// Protocol presets — shared single source of truth (same as NewKeyPanel + Settings)
const PRESETS = ACCESS_PROFILES;

// Posture colors — strict=red (locked down), balanced=accent (default),
// open=green (permissive / no limits). Visible on the dark end-user page.
const POSTURE_COLOR: Record<string, string> = {
  strict: 'var(--red)', balanced: 'var(--accent)', open: 'var(--green)',
};

const PROTO_NAMES: Record<string, string> = {
  'vless-reality': 'VLESS Reality', 'vmess-ws-tls': 'VMess WS', 'vless-ws-tls': 'VLESS WS',
  'trojan-ws-tls': 'Trojan WS', 'trojan-tls': 'Trojan TLS', 'hysteria2': 'Hysteria2',
  'wireguard': 'WireGuard', 'shadowsocks': 'Shadowsocks', 'vmess-grpc-tls': 'VMess gRPC',
  'vless-grpc-tls': 'VLESS gRPC', 'vless-xhttp-tls': 'VLESS XHTTP', 'vmess-xhttp-tls': 'VMess XHTTP',
  'vless-httpupgrade': 'VLESS HTTPUpgrade', 'vmess-httpupgrade': 'VMess HTTPUpgrade',
};

function getProtocolRoles(protocols: string[]): RoleEntry[] {
  const result: RoleEntry[] = [];
  for (const { keys, role, color, dimColor, Icon } of PROTOCOL_ROLES) {
    const match = protocols.find(p => keys.includes(p));
    if (match) result.push({ key: match, role, color, dimColor, Icon });
  }
  const covered = new Set(result.map(r => r.key));
  for (const p of protocols) {
    if (!covered.has(p)) result.push({ key: p, role: PROTO_NAMES[p] ?? p, color: 'rgba(180,195,215,0.5)', dimColor: 'rgba(180,195,215,0.08)', Icon: IconShield });
  }
  return result;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: InvitePageState }) {
  const cfg = {
    active:  { color: '#22e66b', bg: 'rgba(34,230,107,0.12)',  label: 'Active'       },
    pending: { color: '#00d4ff', bg: 'rgba(0,212,255,0.10)',   label: 'Pending setup' },
    expired: { color: '#f0a500', bg: 'rgba(240,165,0,0.12)',   label: 'Expired'      },
    revoked: { color: '#ff625a', bg: 'rgba(255,98,90,0.12)',   label: 'Revoked'      },
  }[state];
  return (
    <span style={{ padding: '3px 11px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: cfg.bg, color: cfg.color, letterSpacing: 0.2 }}>
      {cfg.label}
    </span>
  );
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // navigator.clipboard is unavailable in insecure (plain HTTP) contexts —
  // fall back to the legacy execCommand copy path used by Mode A installs.
  return new Promise((resolve, reject) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (err) {
      document.body.removeChild(el);
      reject(err);
    }
  });
}

function CopyBtn({ text, label = 'Copy subscription link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})}
      style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: copied ? 'var(--green)' : 'var(--text-dim)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 8, fontFamily: 'inherit', transition: 'color 0.15s' }}
    >
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

function QrBlock({ token, active, clientName, mode }: { token: string; active: boolean; clientName: string; mode?: 'direct' | 'wireguard' }) {
  const src = active ? apiUrl(`/api/invite/qr/${token}${mode ? `?mode=${mode}` : ''}`) : null;
  return (
    <div style={{ padding: '20px 20px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, fontWeight: 500 }}>
        Scan with {clientName} to import your access
      </div>
      <div style={{ position: 'relative', display: 'inline-block', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', background: '#0a0a0f' }}>
        {src
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="Subscription QR code" width={220} height={220} style={{ display: 'block' }} />
          : <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconKey size={48} style={{ color: 'rgba(255,255,255,0.08)' }} />
            </div>
        }
        {!active && (
          <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(6px)', background: 'rgba(8,14,25,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconShieldOff size={36} color="rgba(255,255,255,0.3)" />
          </div>
        )}
      </div>
    </div>
  );
}

function SetupPanel({ platform, data, client }: { platform: Platform; data: InvitePageData; client: string }) {
  const [manualOpen, setManualOpen] = useState(false);
  const clientDef = CLIENT_DEFS[client] ?? CLIENT_DEFS.hiddify;
  const isDirect = clientDef.linkMode === 'direct' && !!data.directLink;
  const isWg = clientDef.linkMode === 'wireguard' && !!data.wgConfigUrl;
  const platformData = clientDef.platforms[platform];
  // If this client doesn't support the selected platform, fall back gracefully
  const { app, appUrl, steps } = platformData ?? (Object.values(clientDef.platforms).find(Boolean) as NonNullable<typeof platformData>);
  const roles = getProtocolRoles(data.protocols ?? ['vless-reality']);
  const platformLabel = PLATFORM_TABS.find(t => t.id === platform)?.label ?? platform;
  // Prefer the operator-selected profile id; fall back to detecting it from the protocol set.
  const activeProfile = data.profile ?? detectProfile(data.protocols ?? []);

  return (
    <div>
      {/* Setup steps */}
      <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 4 }}>
          Setup instructions for {platformLabel}
        </div>
        {!platformData && (
          <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 12 }}>
            {clientDef.name} is not available for {platformLabel}. Showing alternative steps.
          </div>
        )}
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 16 }}>Using {clientDef.name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < steps.length - 1 ? 16 : 0, marginBottom: i < steps.length - 1 ? 16 : 0, borderBottom: i < steps.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontFamily: SANS }}>
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-bright)', lineHeight: 1.35 }}>{step.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 3 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <a href={appUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 14, fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          <IconExternalLink size={13} /> Download {app}
        </a>
      </div>

      {/* Protocol preset chips — same names as the admin setup panel */}
      <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          Protocol Preset
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {PRESETS.map(p => {
            const active = activeProfile === p.id;
            return (
              <div key={p.id} style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'default', userSelect: 'none',
                border: active ? '1px solid rgba(0,212,255,0.45)' : '1px solid rgba(74,108,149,0.2)',
                background: active ? 'rgba(0,212,255,0.10)' : 'rgba(255,255,255,0.02)',
                opacity: active ? 1 : 0.5,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#00d4ff' : 'var(--text-dim)', fontFamily: SANS, marginBottom: 4 }}>
                  {p.label}
                </div>
                <div style={{ fontSize: 10, color: active ? 'rgba(0,212,255,0.7)' : 'var(--text-faint)', fontFamily: SANS, lineHeight: 1.5 }}>
                  {p.protocols.map(k => PROTO_NAMES[k] ?? k).join('\n').split('\n').map((name, i) => (
                    <div key={i}>{name}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {!PRESETS.find(p => activeProfile === p.id) && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
            Custom: {(data.protocols ?? []).map(k => PROTO_NAMES[k] ?? k).join(' · ')}
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-faint)' }}>
          Assigned by your administrator. Contact them to request changes.
        </div>
      </div>

      {/* Manual setup accordion — what's shown depends on the client's import model */}
      {(isDirect || isWg || data.subUrl) && (
        <div style={{ padding: '0 22px' }}>
          <button
            onClick={() => setManualOpen(o => !o)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontFamily: 'inherit', borderTop: 'none' }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-bright)' }}>
              Manual setup <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>(advanced users)</span>
            </span>
            {manualOpen ? <IconChevronUp size={16} color="var(--text-dim)" /> : <IconChevronDown size={16} color="var(--text-dim)" />}
          </button>
          {manualOpen && (
            <div style={{ paddingBottom: 22 }}>
              {isWg ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>WireGuard config</div>
                  <a href={data.wgConfigUrl} download style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                    <IconDownload size={14} /> Download .conf
                  </a>
                </>
              ) : isDirect ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Connection link</div>
                  <div style={{ padding: '9px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-bright)', wordBreak: 'break-all', marginBottom: 8 }}>
                    {data.directLink}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                    Copy this and paste it into {clientDef.name} → “Insert key” / “Add from clipboard”.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Subscription URL</div>
                  <div style={{ padding: '9px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-bright)', wordBreak: 'break-all', marginBottom: 12 }}>
                    {data.subUrl}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[{ label: 'Clash / Mihomo', fmt: 'clash', ext: '.yaml' }, { label: 'SingBox', fmt: 'singbox', ext: '.json' }].map(({ label, fmt, ext }) => (
                      <a key={fmt} href={`${data.subUrl}?format=${fmt}`} download
                        style={{ padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                        ↓ {label} {ext}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingSetup({ token, welcome }: { token: string; welcome?: string }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch(apiUrl('/api/invite/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: name.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      window.location.reload();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '48px 32px', textAlign: 'center' }}>
      <div style={{ width: 60, height: 60, borderRadius: 18, background: 'rgba(0,212,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <IconShield size={30} color="var(--accent)" />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-bright)', marginBottom: 8 }}>Activate your invite</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-dim)', marginBottom: 32, lineHeight: 1.6 }}>
        {welcome ? <>{welcome}<br /></> : <>Choose a username to set up your personal VPN key.<br /></>}
        This takes just a few seconds.
      </div>
      <form onSubmit={handleSubmit} style={{ maxWidth: 340, margin: '0 auto', textAlign: 'left' }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Username
        </label>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. sofia" required pattern="[a-z0-9_-]+"
          title="Letters, numbers, hyphens and underscores only"
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 9, padding: '11px 14px', color: 'var(--text-bright)', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 18 }}>Letters, numbers, hyphens, underscores — no spaces.</div>
        {error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 14, padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 8 }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 800, fontSize: 14, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}>
          {loading ? <><IconLoader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Setting up…</> : 'Get my VPN key →'}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </button>
      </form>
    </div>
  );
}

function LockedState({ state, data }: { state: 'expired' | 'revoked'; data: InvitePageData }) {
  const isExpired = state === 'expired';
  const color    = isExpired ? 'var(--amber)' : 'var(--red)';
  const dimColor = isExpired ? 'var(--amber-dim)' : 'var(--red-dim)';
  const Icon     = isExpired ? IconAlertTriangle : IconShieldOff;
  const title    = isExpired ? 'Invite expired' : 'Access revoked';
  const msg      = isExpired
    ? `This invite expired on ${data.expiresAt ? fmtDate(data.expiresAt) : 'an earlier date'}. Contact your administrator for a new invite.`
    : 'Your access key has been revoked by your administrator. New connections are blocked.';

  return (
    <div style={{ maxWidth: 440, width: '100%', boxSizing: 'border-box', margin: '60px auto', padding: '0 20px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: dimColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <Icon size={26} color={color} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 12 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 28 }}>{msg}</div>
          {/* Blurred QR placeholder */}
          <div style={{ position: 'relative', display: 'inline-block', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 24 }}>
            <div style={{ width: 160, height: 160, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconKey size={40} color="rgba(255,255,255,0.06)" />
            </div>
            <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(8px)', background: 'rgba(8,14,25,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: 1, padding: '5px 12px', borderRadius: 6, background: dimColor }}>
                {isExpired ? 'EXPIRED' : 'REVOKED'}
              </span>
            </div>
          </div>
          <a
            href={data.supportContact
              ? (/^https?:\/\//.test(data.supportContact) ? data.supportContact : `mailto:${data.supportContact}`)
              : 'mailto:support'}
            style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}

// Sans-serif font stack for this end-user page — overrides JetBrains Mono from the admin shell
const SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// ── Main page ──────────────────────────────────────────────────────────────────

export function InvitePageClient({ token }: { token: string }) {
  const [data,         setData]         = useState<InvitePageData | null>(null);
  const [loadError,    setLoadError]    = useState('');
  const [platform,     setPlatform]     = useState<Platform>('ios');
  const [summaryOpen,  setSummaryOpen]  = useState(true);
  const [clientChoice, setClientChoice] = useState<string | null>(null);
  const [pickerOpen,   setPickerOpen]   = useState(false);
  const [isMobile,     setIsMobile]     = useState(false);
  // Reflects the actual connection — IP-only (Mode A) installs have no TLS,
  // so this must not claim "Secure invite" over plain HTTP.
  const [isSecure,     setIsSecure]     = useState(false);
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);
  const [ageLabel,     setAgeLabel]     = useState('just now');

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/invite/page/${token}`));
      if (!res.ok) { setLoadError('This invite link is invalid.'); return; }
      setData(await res.json());
      setLastUpdated(new Date());
      setAgeLabel('just now');
    } catch {
      setLoadError('Network error — please check your connection.');
    }
  }, [token]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Default the platform tab to the visitor's actual OS (detected client-side to
  // avoid an SSR/hydration mismatch).
  useEffect(() => {
    const ua = navigator.userAgent;
    const p: Platform = /android/i.test(ua) ? 'android'
      : /iphone|ipad|ipod/i.test(ua) ? 'ios'
      : /windows/i.test(ua) ? 'windows'
      : /macintosh|mac os x/i.test(ua) ? 'mac'
      : /linux/i.test(ua) ? 'linux'
      : 'ios';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(p);
  }, []);

  // Age label — updated via interval, Date.now() never called during render
  useEffect(() => {
    if (!lastUpdated) return;
    const tick = () => {
      const mins = Math.round((Date.now() - lastUpdated.getTime()) / 60000);
      setAgeLabel(mins < 1 ? 'just now' : `${mins} minute${mins === 1 ? '' : 's'} ago`);
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  // Responsive
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setIsSecure(window.location.protocol === 'https:'); }, []);

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loadError) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: SANS }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--red-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <IconShieldOff size={26} color="var(--red)" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 8 }}>Invalid invite</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>{loadError}</div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <IconLoader2 size={28} color="var(--text-faint)" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const locked      = data.state === 'expired' || data.state === 'revoked';
  const brandName   = data.brand ?? process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Archie';
  // The operator can pin a client; if they leave it open the invitee picks one
  // here. Either way the invitee can switch clients on this page.
  // Clients worth offering on this OS: derived from the single client matrix —
  // they have real setup steps on the selected platform AND import at least one
  // assigned protocol. We never hide a working app by country; the matrix only
  // annotates availability. Recommended apps surface first (a sensible mixed list).
  const availableClients = Object.keys(CLIENT_DEFS)
    .filter(k => CLIENT_DEFS[k].platforms[platform] != null && clientSupportsAny(k, data.protocols ?? []))
    .sort((a, b) => Number(CLIENT_DEFS[b].recommended ?? false) - Number(CLIENT_DEFS[a].recommended ?? false));
  const requestedClient = clientChoice ?? data.client ?? 'hiddify';
  // If the requested client doesn't run on this platform, fall back to the first that does.
  const activeClient = availableClients.includes(requestedClient)
    ? requestedClient
    : (availableClients[0] ?? requestedClient);
  const activeDef    = CLIENT_DEFS[activeClient] ?? CLIENT_DEFS.hiddify;
  const clientName   = activeDef.name;
  // Link mode per client: subscription (most), direct vless:// (Amnezia), or a
  // downloadable WireGuard .conf (WireGuard app).
  const wgMode       = activeDef.linkMode === 'wireguard' && !!data.wgConfigUrl;
  const directMode   = activeDef.linkMode === 'direct' && !!data.directLink;
  const shareLink    = directMode ? data.directLink : data.subUrl;
  const linkLabel    = directMode ? 'Copy VPN link' : 'Copy subscription link';
  const supportHref = data.supportContact
    ? (/^https?:\/\//.test(data.supportContact) ? data.supportContact : `mailto:${data.supportContact}`)
    : 'mailto:support';

  // ── Header ─────────────────────────────────────────────────────────────────

  const header = (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: isMobile ? '0 16px' : '0 28px', height: 58, borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.logo || `${BASE_PATH}/assets/ArchieIcon-transparent.png`} alt={brandName} width={34} height={34} style={{ display: 'block', borderRadius: data.logo ? 7 : 0, objectFit: 'cover', flexShrink: 0 }} />
        {data.brand && (
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-bright)', fontFamily: SANS, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.brand}</span>
        )}
        {data.group && (
          <>
            <span style={{ fontSize: 14, color: 'var(--border)', margin: '0 2px', flexShrink: 0 }}>·</span>
            <span style={{ fontSize: 13.5, color: 'var(--text-dim)', fontWeight: 500, fontFamily: SANS, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.group}</span>
          </>
        )}
      </div>
      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <a href={supportHref} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 500 }}>
          Support <IconExternalLink size={13} />
        </a>
        {!locked && isSecure && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 13px', borderRadius: 8, border: '1px solid rgba(34,230,107,0.35)', background: 'rgba(34,230,107,0.08)', color: '#22e66b', fontSize: 12, fontWeight: 700 }}>
            <IconLock size={13} /> Secure invite
          </div>
        )}
      </div>
    </header>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footer = (
    <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
      <IconLock size={13} style={{ flexShrink: 0 }} /> <span>Invite is encrypted and tied to your access policy</span>
    </div>
  );

  // ── Locked / Pending states ─────────────────────────────────────────────────

  if (locked) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', fontFamily: SANS, overflowX: 'hidden' }}>
      {header}
      <div style={{ flex: 1, minWidth: 0 }}><LockedState state={data.state as 'expired' | 'revoked'} data={data} /></div>
      {footer}
    </div>
  );

  if (data.state === 'pending') return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', fontFamily: SANS, overflowX: 'hidden' }}>
      {header}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, maxWidth: 460, width: '100%', overflow: 'hidden' }}>
          <PendingSetup token={token} welcome={data.welcomeMessage} />
        </div>
      </div>
      {footer}
    </div>
  );

  // ── Active state ────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-bright)', display: 'flex', flexDirection: 'column', fontFamily: SANS, overflowX: 'hidden' }}>
      {header}

      <div style={{ flex: 1, minWidth: 0, maxWidth: 1120, margin: '0 auto', padding: isMobile ? '24px 16px 48px' : '36px 28px 60px', width: '100%', boxSizing: 'border-box' }}>

        {/* Page title row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 26, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 800, color: 'var(--text-bright)', letterSpacing: -0.5, marginBottom: 6, fontFamily: SANS }}>
              Set up your VPN access
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
              {data.welcomeMessage || 'Follow the steps for your device to install and connect securely.'}<br />
              This invite is encrypted and tied to your access policy.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>
            {lastUpdated && <span>Last updated {ageLabel}</span>}
            <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-faint)', display: 'flex', lineHeight: 1 }}>
              <IconRefresh size={14} />
            </button>
          </div>
        </div>

        {/* Two-column grid */}
        <div style={isMobile ? {} : { display: 'grid', gridTemplateColumns: '380px 1fr', gap: 22, alignItems: 'start' }}>

          {/* ── Left: summary + QR + CTAs ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: isMobile ? 18 : 0 }}>

            {/* Access summary header — collapsible on mobile */}
            <div
              onClick={() => isMobile && setSummaryOpen(o => !o)}
              style={{ padding: '14px 20px', borderBottom: summaryOpen ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: isMobile ? 'pointer' : 'default' }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>Access summary</span>
              {isMobile && (summaryOpen ? <IconChevronUp size={16} color="var(--text-faint)" /> : <IconChevronDown size={16} color="var(--text-faint)" />)}
            </div>

            {summaryOpen && (
              <div>
                {[
                  data.group
                    ? { Icon: IconUsers,     label: 'Assigned group',  value: data.group }
                    : null,
                  { Icon: IconUser,     label: 'User name',      value: data.displayName ?? data.email },
                  { Icon: IconKey,      label: 'Key status',     value: <StatusBadge state={data.state} /> },
                  data.expiresAt
                    ? { Icon: IconCalendar,  label: 'Expiration',      value: fmtDate(data.expiresAt) }
                    : null,
                  data.trafficLimitGB
                    ? { Icon: IconGauge,     label: 'Traffic limit',   value: `${data.trafficLimitGB} GB / month` }
                    : null,
                  data.connectionLimit
                    ? { Icon: IconDevices,   label: 'Device limit',    value: `${data.connectionLimit} device${data.connectionLimit === 1 ? '' : 's'}` }
                    : null,
                  data.posture
                    ? { Icon: IconShield, label: 'Device posture',
                        value: (
                          <span style={{ fontSize: 13, fontWeight: 700, color: POSTURE_COLOR[data.posture.preset] ?? 'var(--text-bright)', textAlign: 'right' }} title={data.posture.blurb}>
                            {data.posture.label}
                            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: 'var(--text-faint)' }}>{data.posture.blurb}</span>
                          </span>
                        ) }
                    : null,
                  data.securityPolicy
                    ? { Icon: IconLock, label: 'Security policy',
                        value: (
                          <span style={{ fontSize: 13, fontWeight: 700, color: data.securityPolicy.mode === 'permanent-deny' ? 'var(--red)' : 'var(--green)' }}>
                            {data.securityPolicy.label}
                          </span>
                        ) }
                    : null,
                ].map((row, i, arr) => {
                  if (!row) return null;
                  const isLast = arr.slice(i + 1).every(r => !r);
                  return (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 20px', borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text-dim)' }}>
                        <row.Icon size={15} stroke={1.7} />
                        {row.label}
                      </div>
                      {typeof row.value === 'string'
                        ? <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-bright)' }}>{row.value}</span>
                        : row.value}
                    </div>
                  );
                })}
              </div>
            )}

            {/* QR */}
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <QrBlock token={token} active clientName={clientName} mode={wgMode ? 'wireguard' : directMode ? 'direct' : undefined} />
            </div>

            {/* CTAs */}
            <div style={{ padding: '4px 18px 18px' }}>
              {/* WireGuard client → the .conf download is the primary action */}
              {wgMode && data.wgConfigUrl && (
                <a
                  href={data.wgConfigUrl}
                  download
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}
                >
                  <IconDownload size={16} /> Download WireGuard config (.conf)
                </a>
              )}
              {/* Subscription clients have a working install deep link. Direct clients
                  (Amnezia) have no URL scheme, so we don't show a dead "Open in" button —
                  the copy/QR + a paste hint is the real path. */}
              {!wgMode && !directMode && shareLink && activeDef.deepLink && (
                <a
                  href={activeDef.deepLink.replace('$URL', encodeURIComponent(shareLink))}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}
                >
                  <IconExternalLink size={16} /> Open in {activeDef.name}
                </a>
              )}
              {!wgMode && shareLink && <CopyBtn text={shareLink} label={linkLabel} />}
              {!wgMode && directMode && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6, marginTop: 8, textAlign: 'center' }}>
                  Open {clientName} → <strong style={{ color: 'var(--text-dim)' }}>Insert key</strong>, paste the link (or scan the QR above).
                </div>
              )}
              {/* WireGuard config is available to anyone whose profile includes it,
                  even when a non-WG client is selected. */}
              {!wgMode && data.wgConfigUrl && (
                <a
                  href={data.wgConfigUrl}
                  download
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '10px 0', marginTop: 8, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontWeight: 600, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}
                >
                  <IconDownload size={15} /> Download WireGuard config (.conf)
                </a>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 14, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 9 }}>
                <span style={{ fontSize: 13, color: 'var(--text-faint)', flexShrink: 0, marginTop: 1 }}>ⓘ</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                  Installing on multiple devices? This invite can be used on additional devices if your access policy allows it.
                </span>
              </div>
            </div>
          </div>

          {/* ── Right: platform tabs + setup steps ────────────────────────── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            {/* Platform tabs — bordered pill style */}
            <div style={{ display: 'flex', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)', overflowX: 'auto', scrollbarWidth: 'none' }}>
              {PLATFORM_TABS.map(({ id, label, Icon }) => {
                const active = platform === id;
                return (
                  <button
                    key={id}
                    onClick={() => setPlatform(id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                      fontFamily: SANS, fontSize: 13, fontWeight: 500,
                      border: active ? '1px solid rgba(59,130,246,0.6)' : '1px solid var(--border)',
                      background: active ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                      color: active ? '#60a5fa' : 'rgba(255,255,255,0.55)',
                      whiteSpace: 'nowrap', transition: 'all 0.12s', flexShrink: 0,
                    }}
                  >
                    <span style={{ color: active ? '#60a5fa' : 'rgba(255,255,255,0.7)', display: 'flex' }}><Icon size={16} stroke={1.6} /></span>
                    {!isMobile && label}
                    {isMobile && label.split(' /')[0]}
                  </button>
                );
              })}
            </div>

            {/* VPN client picker — collapsed to the selected app; expand to change.
                Operator may pin one; the invitee can still switch if they want. */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600 }}>VPN app</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{clientName}</span>
                {availableClients.length > 1 && (
                  <button
                    onClick={() => setPickerOpen(o => !o)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: SANS, fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)' }}
                  >
                    {pickerOpen ? 'Done' : `Change app (${availableClients.length})`}
                    {pickerOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                  </button>
                )}
              </div>
              {pickerOpen && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>
                    {availableClients.length} app{availableClients.length === 1 ? '' : 's'} for {PLATFORM_TABS.find(t => t.id === platform)?.label ?? platform}:
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {availableClients.map(key => {
                      const active = activeClient === key;
                      return (
                        <button
                          key={key}
                          onClick={() => { setClientChoice(key); setPickerOpen(false); }}
                          style={{
                            padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: SANS, fontSize: 12, fontWeight: 600,
                            border: active ? '1px solid rgba(59,130,246,0.6)' : '1px solid var(--border)',
                            background: active ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                            color: active ? '#60a5fa' : 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap',
                          }}
                        >
                          {CLIENT_DEFS[key].name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <SetupPanel platform={platform} data={data} client={activeClient} />
          </div>

        </div>
      </div>

      {footer}
    </div>
  );
}
