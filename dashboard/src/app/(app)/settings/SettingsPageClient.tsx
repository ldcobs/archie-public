'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import useSWR from 'swr';
import {
  IconShield, IconShieldLock, IconDeviceDesktop, IconWorld, IconDatabase, IconKey,
  IconUser, IconClock, IconLock, IconCheck, IconSun,
  IconChevronRight, IconChevronUp, IconChevronDown, IconTrash, IconAlertCircle, IconRefresh, IconUserPlus, IconCopy,
  IconSettings, IconServer, IconDevices,
  IconQrcode, IconExternalLink, IconGauge,
  IconCalendar, IconDatabaseImport, IconRosetteDiscountCheck,
  IconSend, IconUpload, IconX,
} from '@tabler/icons-react';
import { apiUrl } from '@/lib/api-path';
import { profileProtocols } from '@/lib/access-profiles';
import { clientSupportsAny } from '@/lib/client-matrix';
import type { InviteSummary } from '@/lib/invite-tokens';
import type { RedactedSmtpConfig } from '@/lib/smtp-config';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-client';
import { SettingsCard, Field, TextInput, TextArea, Select, Segmented, Toggle } from './tab-helpers';

type ProtectionMode = 'temp-ban' | 'permanent-deny';
type TabId = 'security' | 'invites' | 'preferences' | 'system';

interface SecurityThresholds {
  attemptThreshold: number;
  attemptWindowMinutes: number;
  tempBanDays: number;
  tempBanCountBeforeEscalation: number;
  repeatWindowDays: number;
  updated_at: string;
}

interface GroupSummary { name: string; count: number }

interface SessionPayload {
  authenticated: boolean;
  setupRequired: boolean;
  user: { username: string; displayName: string; role: string } | null;
}

interface MessageState {
  ok: boolean;
  title: string;
  text: string;
  type?: 'mode' | 'threshold' | 'backup';
}

// ─── Slider ──────────────────────────────────────────────────────────────────

function PolicySlider({
  label, description, recommended, value, min, max, unit, onChange,
}: {
  label: string; description: string; recommended: string;
  value: number; min: number; max: number; unit?: string;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-bright)', lineHeight: 1.35, marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>{description}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-bright)', lineHeight: 1 }}>{value}</div>
          {unit && <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 1 }}>{unit}</div>}
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ position: 'absolute', inset: '0 0 0 0', height: 4, top: '50%', transform: 'translateY(-50%)', background: 'var(--border)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 0, height: 4, top: '50%', transform: 'translateY(-50%)', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.1s' }} />
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
        />
        <div style={{
          position: 'absolute', left: `${pct}%`, width: 14, height: 14,
          background: 'var(--accent)', borderRadius: '50%', border: '2px solid var(--bg)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)', transform: 'translateX(-50%)',
          pointerEvents: 'none', transition: 'left 0.1s',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, color: 'var(--text-faint)' }}>
        <span style={{ flexShrink: 0 }}>{min}</span>
        <span style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Recommended: {recommended}</span>
        <span style={{ flexShrink: 0 }}>{max}</span>
      </div>
    </div>
  );
}

// ─── Effective Policy Flow + modal ────────────────────────────────────────────

function FlowRow({ icon, children, tinted }: { icon: React.ReactNode; children: React.ReactNode; tinted?: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10,
      background: tinted ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : 'color-mix(in srgb, var(--surface-hover) 70%, transparent)',
      border: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0, background: 'var(--surface)',
        border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)',
      }}>{icon}</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55, alignSelf: 'center' }}>{children}</div>
    </div>
  );
}

function PolicyModal({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--green-dim)', border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', flexShrink: 0 }}>
            <IconShield size={26} stroke={1.7} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)', marginBottom: 4 }}>How Security Policy Works</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>Archie uses fail2ban under the hood. Thresholds you set here translate directly into fail2ban jail rules applied on the next cycle (≤ 60 s).</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 22, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {([
            { Icon: IconUser, color: 'var(--accent)', title: '1 · Detection — Failed Login Threshold', body: 'fail2ban monitors auth logs for SSH authentication failures. When an IP exceeds the Failed Login Threshold within the Detection Window, fail2ban fires a ban action.' },
            { Icon: IconClock, color: 'var(--green)', title: '2 · Temporary Ban', body: 'The offending IP is blocked at the firewall for the Temporary Ban Duration you set. Existing active sessions are unaffected — the ban applies to new connection attempts only.' },
            { Icon: IconShield, color: 'var(--amber)', title: '3 · Repeat-Offender Escalation', body: 'Archie tracks how many times each IP has been temporarily banned within the Repeat-Offender Window. When that count reaches the Escalation Trigger, the IP is promoted to the permanent block list.' },
            { Icon: IconLock, color: 'var(--red)', title: '4 · Permanent Deny', body: 'IPs on the permanent block list are blocked indefinitely and survive reboots. Switching the Protection Mode to Permanent Deny makes all first-time bans immediately permanent.' },
          ]).map(({ Icon, color, title, body }) => (
            <div key={title} style={{ display: 'flex', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
                <Icon size={22} stroke={1.6} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EffectivePolicyFlow({ form, mode, onLearnMore }: { form: SecurityThresholds; mode: ProtectionMode; onLearnMore: () => void }) {
  const b = (v: React.ReactNode) => <strong style={{ color: 'var(--text-bright)' }}>{v}</strong>;
  const dim = (v: string) => <span style={{ color: 'var(--text-faint)' }}>{v}</span>;
  const arrow = (ch: string) => <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 18, lineHeight: 1, marginBlock: 2 }}>{ch}</div>;
  const permanent = mode === 'permanent-deny';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: 'var(--accent)', textTransform: 'uppercase' }}>Effective Policy</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: permanent ? 'var(--red)' : 'var(--green)' }}>{permanent ? 'Permanent Deny' : 'Temporary Ban'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 14 }}>
        {permanent
          ? 'First offense is blocked permanently — no temporary phase, no second chance.'
          : 'Offenders are blocked temporarily first, and only escalated to a permanent block if they keep coming back.'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FlowRow icon={<IconUser size={24} stroke={1.6} />}>If an IP fails SSH login {b(form.attemptThreshold + ' times')} within {b(form.attemptWindowMinutes + ' minutes')}</FlowRow>
        {permanent ? (
          <>
            {arrow('↓')}
            <FlowRow icon={<IconLock size={24} stroke={1.6} />} tinted>Add it to the {b('permanent block list')} immediately {dim('(survives reboots)')}</FlowRow>
          </>
        ) : (
          <>
            {arrow('↓')}
            <FlowRow icon={<IconClock size={24} stroke={1.6} />}>Block for {b(form.tempBanDays + ' days')} {dim('(temporary ban)')}</FlowRow>
            {arrow('↓')}
            <FlowRow icon={<IconShield size={24} stroke={1.6} />}>If the same IP is banned {b(form.tempBanCountBeforeEscalation + ' times')} within {b(form.repeatWindowDays + ' days')}</FlowRow>
            {arrow('═')}
            <FlowRow icon={<IconLock size={24} stroke={1.6} />}>Escalate to {b('permanent deny')} {dim('(added to permanent block list)')}</FlowRow>
          </>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <button onClick={onLearnMore} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, color: 'var(--accent)', fontFamily: 'inherit', fontWeight: 600 }}>Learn more about policy behavior →</button>
      </div>
    </div>
  );
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function Banner({ msg }: { msg: MessageState }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 18px', marginBottom: 20, borderRadius: 10,
      background: msg.ok ? 'color-mix(in srgb, var(--green) 8%, var(--surface))' : 'color-mix(in srgb, var(--red) 8%, var(--surface))',
      border: `1px solid ${msg.ok ? 'color-mix(in srgb, var(--green) 30%, transparent)' : 'color-mix(in srgb, var(--red) 30%, transparent)'}`,
      borderLeft: `4px solid ${msg.ok ? 'var(--green)' : 'var(--red)'}`,
    }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: msg.ok ? 'color-mix(in srgb, var(--green) 18%, transparent)' : 'color-mix(in srgb, var(--red) 18%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
        {msg.ok ? <IconShield size={22} stroke={1.8} /> : <IconAlertCircle size={22} stroke={1.8} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: msg.ok ? 'var(--green)' : 'var(--red)', marginBottom: 2 }}>{msg.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{msg.text}</div>
      </div>
      {msg.ok && (
        <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: 'color-mix(in srgb, var(--green) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)' }}>
          <IconCheck size={16} stroke={2.2} />
        </div>
      )}
    </div>
  );
}

// ─── Invite option catalogs ───────────────────────────────────────────────────

const PROFILE_OPTS = [
  { value: 'standard',    label: 'Standard Access' },
  { value: 'compatible',  label: 'Compatible' },
  { value: 'universal',   label: 'Universal' },
  { value: 'performance', label: 'Performance' },
  { value: 'cdn-safe',    label: 'CDN Safe' },
  { value: 'legacy',      label: 'Legacy' },
];
const profileLabel = (v: string) => PROFILE_OPTS.find(o => o.value === v)?.label ?? v;

const EXPIRY_OPTS = [
  { value: '1',  label: '1 day' },
  { value: '7',  label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];
const TRAFFIC_OPTS = [
  { value: '0',   label: 'No limit' },
  { value: '10',  label: '10 GB' },
  { value: '50',  label: '50 GB' },
  { value: '100', label: '100 GB' },
  { value: '250', label: '250 GB' },
  { value: '500', label: '500 GB' },
];
const DEVICE_OPTS = [
  { value: 'single',   label: 'Single device' },
  { value: 'multiple', label: 'Multiple devices' },
  { value: 'approval', label: 'Approval required' },
];
const deviceLabel = (v: string) => DEVICE_OPTS.find(o => o.value === v)?.label ?? v;

const POSTURE_OPTS = [
  { value: 'strict',   label: 'Strict' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'open',     label: 'Open' },
];
const postureLabel = (v: string) => POSTURE_OPTS.find(o => o.value === v)?.label ?? v;

const POLICY_OPTS = [
  { value: 'temp-ban',       label: 'Temporary ban' },
  { value: 'permanent-deny', label: 'Permanent deny' },
];
const policyLabel = (v: string) => POLICY_OPTS.find(o => o.value === v)?.label ?? v;

const CLIENT_OPTS = [
  { value: '',            label: 'Let the customer choose' },
  { value: 'hiddify',     label: 'Hiddify' },
  { value: 'amnezia',     label: 'Amnezia VPN' },
  { value: 'v2rayng',     label: 'v2rayNG' },
  { value: 'v2rayn',      label: 'v2rayN' },
  { value: 'singbox',     label: 'SingBox' },
  { value: 'clashverge',  label: 'Clash Verge' },
  { value: 'streisand',   label: 'Streisand' },
  { value: 'shadowrocket', label: 'Shadowrocket' },
  { value: 'nekoray',     label: 'NekoRay / NekoBox' },
  { value: 'wireguard',   label: 'WireGuard' },
];

const TAB_OPTS = [
  { value: 'ios',     label: 'iPhone / iPad' },
  { value: 'android', label: 'Android' },
  { value: 'windows', label: 'Windows' },
  { value: 'mac',     label: 'macOS' },
  { value: 'linux',   label: 'Linux' },
];
const EXPIRED_OPTS = [
  { value: 'show',     label: 'Show expired' },
  { value: 'redirect', label: 'Redirect to support' },
  { value: 'hide',     label: 'Hide page' },
];
const REVOKED_OPTS = [
  { value: 'revoked',  label: 'Access revoked' },
  { value: 'redirect', label: 'Redirect to support' },
  { value: 'hide',     label: 'Hide page' },
];

const INVITE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  accepted: { label: 'Accepted', color: 'var(--green)', bg: 'var(--green-dim)' },
  pending:  { label: 'Pending',  color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  expired:  { label: 'Expired',  color: 'var(--amber)', bg: 'var(--amber-dim)' },
  revoked:  { label: 'Revoked',  color: 'var(--red)', bg: 'var(--red-dim)' },
};

function inviteLinkFor(token: string) {
  const base = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
    ?? (typeof window !== 'undefined' ? window.location.origin + '/v3' : '/v3');
  return `${base}/invite/${token}`;
}

function SentInvitesCard({ invites, refresh }: { invites: InviteSummary[]; refresh: () => void }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const accepted = invites.filter(i => i.status === 'accepted').length;
  const pending  = invites.filter(i => i.status === 'pending').length;

  const toggle = (token: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(token)) n.delete(token); else n.add(token);
    return n;
  });

  async function deleteSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await Promise.all([...selected].map(t =>
        fetch(apiUrl(`/api/invite/${t}`), { method: 'DELETE' }).catch(() => {})));
      setSelected(new Set());
      refresh();
    } finally { setBusy(false); }
  }

  function copyLink(token: string) {
    copyText(inviteLinkFor(token)).then(() => {
      setCopied(token); setTimeout(() => setCopied(''), 1500);
    });
  }

  const th: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 10px 8px', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-bright)', padding: '9px 10px', borderTop: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' };

  return (
    <SettingsCard
      title="Sent invites"
      subtitle={`${invites.length} total · ${accepted} accepted · ${pending} pending`}
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selected.size > 0 && (
            <button onClick={deleteSelected} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
              <IconTrash size={13} /> Delete {selected.size}
            </button>
          )}
          <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 3 }}>
            {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </button>
        </div>
      }
    >
      {open && (
        invites.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-faint)', padding: '8px 2px' }}>No invites yet. Generate one above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 540 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 28 }} />
                  <th style={th}>Name</th>
                  <th style={th}>Access</th>
                  <th style={th}>Sent</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={{ ...th, textAlign: 'right' }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => {
                  const sm = INVITE_STATUS_META[inv.status] ?? INVITE_STATUS_META.pending;
                  return (
                    <tr key={inv.token}>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input type="checkbox" checked={selected.has(inv.token)} onChange={() => toggle(inv.token)} style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={td}>
                        {inv.usedBy ?? inv.displayName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        {inv.resend && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', borderRadius: 4, padding: '1px 4px' }}>RESEND</span>}
                      </td>
                      <td style={{ ...td, color: 'var(--text-dim)' }}>{profileLabel(inv.profile ?? 'standard')}</td>
                      <td style={{ ...td, color: 'var(--text-dim)' }}>
                        {inv.sentVia === 'email' ? (
                          inv.emailSent
                            ? <span style={{ color: 'var(--green)' }} title="Delivered">Email ✓</span>
                            : inv.emailError
                              ? <span style={{ color: 'var(--red)' }} title={inv.emailError}>Email ✗</span>
                              : 'Email'
                        ) : 'Link'}
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: sm.color, background: sm.bg, borderRadius: 20, padding: '2px 9px' }}>{sm.label}</span>
                      </td>
                      <td style={{ ...td, color: 'var(--text-dim)' }}>{new Date(inv.createdAt).toLocaleDateString()}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button onClick={() => copyLink(inv.token)} title="Copy invite link" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied === inv.token ? 'var(--green)' : 'var(--text-dim)', display: 'inline-flex', padding: 3 }}>
                          {copied === inv.token ? <IconCheck size={15} /> : <IconCopy size={15} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </SettingsCard>
  );
}

function SmtpSettingsCard() {
  const { data, mutate } = useSWR<{ smtp: RedactedSmtpConfig }>(apiUrl('/api/settings/smtp'), fetchJson, { dedupingInterval: 5_000 });
  const smtp = data?.smtp;

  // Draft overlay: each field shows the operator's edit if present, otherwise the
  // last fetched value. Avoids seeding-via-effect (cascading renders). Password is
  // never returned, so it's a plain draft that starts empty.
  const [hostD, setHostD] = useState<string>();
  const [portD, setPortD] = useState<string>();
  const [secureD, setSecureD] = useState<boolean>();
  const [userD, setUserD] = useState<string>();
  const [fromD, setFromD] = useState<string>();
  const [pass, setPass] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const host = hostD ?? smtp?.host ?? '';
  const port = portD ?? (smtp ? String(smtp.port) : '587');
  const secure = secureD ?? smtp?.secure ?? false;
  const user = userD ?? smtp?.user ?? '';
  const from = fromD ?? smtp?.from ?? '';

  async function save() {
    setBusy('save'); setNote(null);
    try {
      await fetchJson(apiUrl('/api/settings/smtp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: Number(port), secure, user, pass, from }),
      });
      // Clear drafts so fields re-derive from the refreshed config.
      setHostD(undefined); setPortD(undefined); setSecureD(undefined);
      setUserD(undefined); setFromD(undefined); setPass('');
      await mutate();
      setNote({ ok: true, text: 'SMTP settings saved.' });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Save failed.' });
    } finally { setBusy(null); }
  }

  async function test() {
    if (!testTo) { setNote({ ok: false, text: 'Enter a recipient address to test.' }); return; }
    setBusy('test'); setNote(null);
    try {
      const res = await fetch(apiUrl('/api/settings/smtp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', to: testTo }),
      });
      const r = await res.json();
      setNote(r.ok ? { ok: true, text: `Test email sent to ${testTo}.` } : { ok: false, text: r.error ?? 'Test failed.' });
    } catch {
      setNote({ ok: false, text: 'Network error.' });
    } finally { setBusy(null); }
  }

  const statusText = smtp?.configured
    ? `Active — sending as ${smtp.from}${smtp.source === 'env' ? ' (from environment)' : ''}`
    : 'Not configured — invite emails are disabled until host + From are set.';

  return (
    <SettingsCard
      title="Email delivery (SMTP)"
      subtitle={statusText}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Field label="SMTP host" hint="e.g. smtp.sendgrid.net">
          <TextInput value={host} onChange={e => setHostD(e.target.value)} placeholder="smtp.example.com" />
        </Field>
        <Field label="Port">
          <TextInput value={port} onChange={e => setPortD(e.target.value)} inputMode="numeric" placeholder="587" />
        </Field>
        <Field label="Encryption" hint="On = implicit TLS (465); Off = STARTTLS (587)">
          <Toggle on={secure} onChange={setSecureD} onLabel="TLS (465)" offLabel="STARTTLS (587)" />
        </Field>
        <Field label="From address" hint="Shown as the sender">
          <TextInput value={from} onChange={e => setFromD(e.target.value)} placeholder="VPN <invites@example.com>" />
        </Field>
        <Field label="Username">
          <TextInput value={user} onChange={e => setUserD(e.target.value)} placeholder="apikey / user" autoComplete="off" />
        </Field>
        <Field label="Password" hint={smtp?.hasPass ? 'A password is set — leave blank to keep it' : 'Required if your server needs auth'}>
          <TextInput type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={smtp?.hasPass ? '••••••••' : ''} autoComplete="new-password" />
        </Field>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <button onClick={save} disabled={busy === 'save'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, background: '#3361c9', color: '#fff', opacity: busy === 'save' ? 0.7 : 1 }}>
          {busy === 'save' ? 'Saving…' : 'Save SMTP settings'}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 240px', minWidth: 200 }}>
          <TextInput value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com" style={{ flex: 1 }} />
          <button onClick={test} disabled={busy === 'test' || !smtp?.configured} title={smtp?.configured ? '' : 'Save a valid config first'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', cursor: busy || !smtp?.configured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', whiteSpace: 'nowrap', opacity: !smtp?.configured ? 0.5 : 1 }}>
            {busy === 'test' ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      {note && (
        <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: note.ok ? 'var(--green)' : 'var(--red)' }}>{note.text}</div>
      )}
    </SettingsCard>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPageClient() {
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { data: session } = useSWR<SessionPayload>(apiUrl('/api/auth/session'), fetchJson, { dedupingInterval: 2_000 });
  const { data: modeData, mutate: mutateMode } = useSWR<{ mode: ProtectionMode }>(apiUrl('/api/security-mode'), fetchJson, { dedupingInterval: 2_000 });
  const { data: thresholds, mutate: mutateThresholds } = useSWR<SecurityThresholds>(apiUrl('/api/security-thresholds'), fetchJson, { dedupingInterval: 2_000 });
  const { data: groups } = useSWR<GroupSummary[]>(apiUrl('/api/groups'), fetchJson, { dedupingInterval: 5_000 });
  const { data: invitesData, mutate: mutateInvites } = useSWR<{ invites: InviteSummary[] }>(apiUrl('/api/invite'), fetchJson, { dedupingInterval: 3_000 });

  const [activeTab, setActiveTab] = useState<TabId>('security');
  const [modeSaving, setModeSaving] = useState(false);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [form, setForm] = useState<SecurityThresholds | null>(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Collapse multi-column layouts on narrow viewports
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 960);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Invite builder state ───────────────────────────────────────────────────
  const DEFAULT_WELCOME = 'Welcome! Your secure VPN access is ready — follow the steps to connect.';
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteGroup, setInviteGroup] = useState('Ungrouped');
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [inviteProfile, setInviteProfile] = useState('standard');
  const [inviteExpiry, setInviteExpiry] = useState('7');
  const [inviteTraffic, setInviteTraffic] = useState('10');
  const [inviteDevice, setInviteDevice] = useState('single');
  const [invitePosture, setInvitePosture] = useState('balanced');
  const [invitePolicy, setInvitePolicy] = useState('temp-ban');
  const [inviteBrand, setInviteBrand] = useState('');
  const [inviteLogo, setInviteLogo] = useState('');
  const [inviteSupport, setInviteSupport] = useState('');
  const [inviteWelcome, setInviteWelcome] = useState(DEFAULT_WELCOME);
  const [inviteClient, setInviteClient] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState('');
  // Onboarding experience
  const [obQr, setObQr] = useState(true);
  const [obManual, setObManual] = useState(true);
  const [obDefaultTab, setObDefaultTab] = useState('ios');
  const [obExpired, setObExpired] = useState('show');
  const [obRevoked, setObRevoked] = useState('revoked');

  async function generateInvite(channel: 'link' | 'email' = 'link') {
    // Coerce to a clean string: this is also wired directly as a button onClick,
    // so `channel` can arrive as a click event — never put that in the body
    // (JSON.stringify on a synthetic event throws and the request never sends).
    const sentVia: 'link' | 'email' = channel === 'email' ? 'email' : 'link';
    setInviteLoading(true); setInviteError(''); setInviteLink(''); setInviteToken('');
    try {
      const res = await fetch(apiUrl('/api/invite'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: inviteGroup || 'Ungrouped',
          displayName: inviteName || undefined,
          email: inviteEmail || undefined,
          client: effectiveClient || undefined,
          profile: inviteProfile,
          posture: invitePosture,
          securityPolicy: invitePolicy,
          expiresInDays: Number(inviteExpiry),
          trafficLimitGB: Number(inviteTraffic) || undefined,
          devicePolicy: inviteDevice,
          brand: inviteBrand || undefined,
          logo: inviteLogo || undefined,
          supportContact: inviteSupport || undefined,
          welcomeMessage: inviteWelcome || undefined,
          sentVia,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error ?? 'Error'); return; }
      const base = (process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? window.location.origin + '/v3');
      setInviteToken(data.token.token);
      setInviteLink(`${base}/invite/${data.token.token}`);
      mutateInvites();
      // Surface the email delivery outcome when the operator sent by email.
      if (sentVia === 'email' && data.email) {
        if (data.email.sent) {
          setMessage({ ok: true, title: 'Invite emailed', text: `Sent the invite link to ${inviteEmail}.` });
        } else {
          setInviteError(data.email.error ?? 'Email could not be sent.');
        }
      }
    } catch {
      setInviteError('Network error');
    } finally {
      setInviteLoading(false);
    }
  }

  function copyInviteLink() {
    copyText(inviteLink).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setInviteLogo(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  }

  function sendInviteEmail() {
    if (!inviteEmail) { setInviteError('Add an email address above to send the invite.'); return; }
    // Creates the invite and delivers it by email server-side (SMTP). The POST
    // returns the delivery outcome, surfaced in generateInvite().
    void generateInvite('email');
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (thresholds) setForm(thresholds); }, [thresholds]);

  // Only offer clients that can import the selected access profile. If the pinned
  // client is incompatible with the current profile, treat it as "let customer choose"
  // (derived, so no state-reset effect needed).
  const inviteProtocols = profileProtocols(inviteProfile);
  const compatibleClientOpts = CLIENT_OPTS.filter(o => o.value === '' || clientSupportsAny(o.value, inviteProtocols));
  const effectiveClient = inviteClient && clientSupportsAny(inviteClient, inviteProtocols) ? inviteClient : '';

  const mode = modeData?.mode ?? 'temp-ban';

  async function saveMode(nextMode: ProtectionMode) {
    setModeSaving(true); setMessage(null);
    try {
      await fetchJson(apiUrl('/api/security-mode'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: nextMode }) });
      await mutateMode();
      const label = nextMode === 'permanent-deny' ? 'Permanent Deny' : 'Temporary Ban';
      setMessage({ ok: true, type: 'mode', title: 'Policy updated', text: `${label} is now the active enforcement mode. Fail2ban will apply the policy on the next cycle.` });
    } catch (err) {
      setMessage({ ok: false, title: 'Error', text: String(err) });
    } finally {
      setModeSaving(false);
    }
  }

  async function saveThresholds() {
    if (!form) return;
    setThresholdSaving(true); setMessage(null);
    try {
      await fetchJson(apiUrl('/api/security-thresholds'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      await mutateThresholds();
      setMessage({ ok: true, type: 'threshold', title: 'Thresholds saved', text: 'Security thresholds updated successfully.' });
    } catch (err) {
      setMessage({ ok: false, title: 'Error', text: String(err) });
    } finally {
      setThresholdSaving(false);
    }
  }

  async function importBackup(file: File) {
    setMessage(null);
    try {
      const text = await file.text();
      const result = await fetchJson<{ ok: boolean; restored: string[] }>(apiUrl('/api/backup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      setMessage({ ok: true, type: 'backup', title: 'Backup restored', text: `Restored: ${result.restored.join(', ') || 'no files changed'}.` });
    } catch (err) {
      setMessage({ ok: false, title: 'Error', text: String(err) });
    }
  }

  // ── shared button helpers ──────────────────────────────────────────────────
  const BTN_BLUE = '#3361c9';
  const primaryBtn = (label: string, onClick: () => void, loading = false, icon?: React.ReactNode) => (
    <button disabled={loading} onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px', border: 'none', cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap', background: BTN_BLUE, color: '#fff', opacity: loading ? 0.7 : 1 }}>{icon}{label}</button>
  );
  const ghostStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)' };
  const ghostBtn = (label: string, onClick: () => void, icon?: React.ReactNode) => (
    <button onClick={onClick} style={ghostStyle}>{icon}{label}</button>
  );
  const openImport = () => fileInputRef.current?.click();

  const TABS: { id: TabId; label: string; Icon: React.ComponentType<{ size?: number; stroke?: number }> }[] = [
    { id: 'security',    label: 'Security Policy',      Icon: IconShieldLock },
    { id: 'invites',     label: 'Invites & Onboarding', Icon: IconUserPlus   },
    { id: 'preferences', label: 'Preferences',          Icon: IconSettings   },
    { id: 'system',      label: 'System',               Icon: IconServer     },
  ];

  // ── Derived: group dropdown options ────────────────────────────────────────
  const groupOptions = (() => {
    const names = (groups ?? []).map(g => g.name);
    if (!names.includes('Ungrouped')) names.unshift('Ungrouped');
    if (inviteGroup && !newGroupMode && !names.includes(inviteGroup)) names.push(inviteGroup);
    return names.map(n => ({ value: n, label: n }));
  })();
  const iconBtnStyle: React.CSSProperties = { flexShrink: 0, width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' };

  // ── Invitee preview (right column of Invites tab) ──────────────────────────
  const brandName = inviteBrand || 'Your VPN';
  const previewBlock = (
    <SettingsCard
      title="Preview"
      subtitle="This is how invitees will see the onboarding page."
      action={inviteLink
        ? <a href={inviteLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{ghostBtn('View full page', () => {}, <IconExternalLink size={14} />)}</a>
        : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Generate to preview</span>}
    >
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 10, border: '1px solid var(--border)', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {inviteToken
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={apiUrl(`/api/invite/qr/${inviteToken}`)} alt="Invite QR" width={96} height={96} style={{ display: 'block' }} />
            : <IconQrcode size={40} style={{ color: 'rgba(255,255,255,0.12)' }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {inviteLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={inviteLogo} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }} />
            )}
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>{brandName}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.45 }}>{inviteWelcome || `Welcome to ${brandName}.`}</div>
          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Valid for', value: `${inviteExpiry} days` },
              { label: 'Devices',   value: deviceLabel(inviteDevice) },
              { label: 'Access',    value: profileLabel(inviteProfile) },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-bright)', marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11.5 }}>
            <span style={{ color: inviteLink ? 'var(--accent)' : 'var(--text-faint)', wordBreak: 'break-all' }}>{inviteLink || 'archie.ee/invite/…'}</span>
          </div>
        </div>
      </div>
    </SettingsCard>
  );

  // ── Tab: Invites & Onboarding ──────────────────────────────────────────────
  const invitesTab = (
    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1.5fr 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        <SettingsCard title="Create invite" subtitle="Generate a secure invite link for new users.">
          <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr 1fr', gap: 14 }}>
            <Field label="Display name" hint="Shown to the invitee">
              <TextInput value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Maria" />
            </Field>
            <Field label="Email address" hint="Where to send the invite (optional)">
              <TextInput type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="maria@acme.com" />
            </Field>
            <Field label="Group" hint="Users inherit group access">
              {newGroupMode ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <TextInput autoFocus value={inviteGroup} onChange={e => setInviteGroup(e.target.value)} placeholder="New group name" style={{ flex: 1 }} />
                  <button title="Pick existing group" onClick={() => { setNewGroupMode(false); setInviteGroup('Ungrouped'); }} style={iconBtnStyle}><IconX size={15} /></button>
                </div>
              ) : (
                <Select
                  value={inviteGroup}
                  onChange={v => { if (v === '__new__') { setNewGroupMode(true); setInviteGroup(''); } else setInviteGroup(v); }}
                  options={[...groupOptions, { value: '__new__', label: '+ Create new group…' }]}
                />
              )}
            </Field>

            <Field label="Access profile" hint="Protocol & network bundle">
              <Select value={inviteProfile} onChange={setInviteProfile} options={PROFILE_OPTS} />
            </Field>
            <Field label="Expires in" hint="Invite expiration">
              <Select value={inviteExpiry} onChange={setInviteExpiry} options={EXPIRY_OPTS} />
            </Field>
            <Field label="Traffic limit (optional)" hint="Per device">
              <Select value={inviteTraffic} onChange={setInviteTraffic} options={TRAFFIC_OPTS} />
            </Field>

            <Field label="Device policy" hint="How this invite can be used">
              <Segmented value={inviteDevice} onChange={setInviteDevice} options={DEVICE_OPTS} />
            </Field>
            <Field label="VPN client" hint="Pin an app, or let the customer pick">
              <Select value={effectiveClient} onChange={setInviteClient} options={compatibleClientOpts} />
              <a href={apiUrl('/clients')} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                <IconExternalLink size={12} /> Which apps work where?
              </a>
            </Field>
            <Field label="Security posture" hint="Device sharing enforcement for this user">
              <Select value={invitePosture} onChange={setInvitePosture} options={POSTURE_OPTS} />
            </Field>
            <Field label="Security policy" hint="Threat response (server-wide)">
              <Select value={invitePolicy} onChange={setInvitePolicy} options={POLICY_OPTS} />
            </Field>
            <Field label="Customer / brand" hint="Name and logo shown on invite page">
              <TextInput value={inviteBrand} onChange={e => setInviteBrand(e.target.value)} placeholder="Acme Corp" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {inviteLogo ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inviteLogo} alt="Brand logo" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', border: '1px solid var(--border)' }} />
                    <button onClick={() => setInviteLogo('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11.5, fontFamily: 'inherit', padding: 0 }}>Remove logo</button>
                  </>
                ) : (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)' }}>
                    <IconUpload size={13} /> Upload logo
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogoChange} />
                  </label>
                )}
              </div>
            </Field>
            <Field label="Support contact" hint="Shown on invite page">
              <TextInput value={inviteSupport} onChange={e => setInviteSupport(e.target.value)} placeholder="support@acme.com" />
            </Field>

            <Field label="Welcome message" hint={`${inviteWelcome.length} / 120 · shown to the invitee`} span>
              <TextArea value={inviteWelcome} maxLength={120} rows={2} onChange={e => setInviteWelcome(e.target.value)} placeholder={DEFAULT_WELCOME} />
            </Field>
          </div>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>Generated invite link</div>
              {inviteLink
                ? <div style={{ fontSize: 11.5, color: 'var(--green)' }}><span style={{ marginRight: 4 }}>●</span>Ready · expires in {inviteExpiry} days</div>
                : <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Your invite link is ready to share.</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0, padding: '9px 11px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: inviteLink ? 'var(--accent)' : 'var(--text-faint)', wordBreak: 'break-all' }}>
                {inviteLink || 'Generate a link to see it here'}
              </div>
              <button onClick={copyInviteLink} disabled={!inviteLink} style={{ flexShrink: 0, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: inviteCopied ? 'var(--green-dim)' : 'transparent', color: inviteCopied ? 'var(--green)' : 'var(--text-dim)', cursor: inviteLink ? 'pointer' : 'default', opacity: inviteLink ? 1 : 0.5 }}>
                {inviteCopied ? <IconCheck size={15} /> : <IconCopy size={15} />}
              </button>
            </div>
            {inviteError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}><IconAlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{inviteError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {primaryBtn(inviteLoading ? 'Generating…' : 'Generate invite link', () => generateInvite('link'), inviteLoading, <IconUserPlus size={15} />)}
              {ghostBtn('Copy link', copyInviteLink, <IconCopy size={15} />)}
              {inviteLink && ghostBtn('Send via email', sendInviteEmail, <IconSend size={15} />)}
              {inviteLink
                ? <a href={inviteLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{ghostBtn('Preview onboarding page', () => {}, <IconExternalLink size={15} />)}</a>
                : ghostBtn('Preview onboarding page', () => {}, <IconExternalLink size={15} />)}
            </div>
          </div>
        </SettingsCard>

        <SentInvitesCard invites={invitesData?.invites ?? []} refresh={mutateInvites} />

        <SmtpSettingsCard />

        <SettingsCard title="Onboarding experience" subtitle="Control how invitees experience the onboarding page.">
          <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr 1fr' : 'repeat(2, auto) 1fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 8 }}>QR code</div>
              <Toggle on={obQr} onChange={setObQr} onLabel="Enabled" offLabel="Disabled" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 8 }}>Show manual setup</div>
              <Toggle on={obManual} onChange={setObManual} onLabel="Shown" offLabel="Hidden" />
            </div>
            <Field label="Default device tab" hint="Initial tab on load">
              <Select value={obDefaultTab} onChange={setObDefaultTab} options={TAB_OPTS} />
            </Field>
            <Field label="Expired invite handling" hint="What invitees see">
              <Select value={obExpired} onChange={setObExpired} options={EXPIRED_OPTS} />
            </Field>
            <Field label="Revoked invite handling" hint="What invitees see">
              <Select value={obRevoked} onChange={setObRevoked} options={REVOKED_OPTS} />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Invite policy summary" subtitle="This is the policy that will be applied to users created with this invite.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {[
              { Icon: IconUser,     label: 'User in group', value: inviteGroup || 'Ungrouped' },
              { Icon: IconRosetteDiscountCheck, label: 'Access profile', value: profileLabel(inviteProfile) },
              { Icon: IconShieldLock, label: 'Security posture', value: postureLabel(invitePosture) },
              { Icon: IconLock,     label: 'Security policy', value: policyLabel(invitePolicy) },
              { Icon: IconDevices,  label: 'Device policy', value: deviceLabel(inviteDevice) },
              { Icon: IconCalendar, label: 'Expires in',    value: `${inviteExpiry} days` },
              { Icon: IconGauge,    label: 'Traffic limit', value: inviteTraffic === '0' ? 'No limit' : `${inviteTraffic} GB / device` },
            ].map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 10, background: 'color-mix(in srgb, var(--surface-hover) 70%, transparent)', border: '1px solid var(--border-subtle)', minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <s.Icon size={17} stroke={1.7} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconAlertCircle size={13} style={{ color: 'var(--text-faint)' }} />
            Users will be created with these settings and can be further restricted by Security Policy.
          </div>
        </SettingsCard>
      </div>

      <div>{previewBlock}</div>
    </div>
  );

  // ── Tab: Security Policy ───────────────────────────────────────────────────
  const securityTab = (
    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1.4fr 1fr', gap: 18, alignItems: 'start' }}>
      <SettingsCard
        title="Security policy"
        subtitle="SSH brute-force protection via fail2ban."
        action={<span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: mode === 'permanent-deny' ? 'var(--red-dim)' : 'var(--green-dim)', border: `1px solid ${mode === 'permanent-deny' ? 'color-mix(in srgb, var(--red) 30%, transparent)' : 'color-mix(in srgb, var(--green) 30%, transparent)'}`, color: mode === 'permanent-deny' ? 'var(--red)' : 'var(--green)' }}>{mode === 'permanent-deny' ? 'Permanent Deny' : 'Temporary Ban'}</span>}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>Protection mode</div>
        <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
          {([['temp-ban', 'Temporary Ban', <IconShield key="s" size={17} stroke={1.8} />], ['permanent-deny', 'Permanent Deny', <IconLock key="l" size={17} stroke={1.8} />]] as const).map(([target, label, icon]) => {
            const active = mode === target;
            const danger = target === 'permanent-deny';
            return (
              <button key={target} disabled={modeSaving} onClick={() => saveMode(target)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 18px', border: 'none', cursor: modeSaving ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: active ? (danger ? '#cf4636' : '#1f9d57') : 'transparent', color: active ? '#fff' : 'var(--text-dim)' }}>{icon}{label}</button>
            );
          })}
        </div>

        {form && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr 1fr', gap: 18, marginBottom: 20 }}>
              <PolicySlider label="Failed login threshold" description="Attempts before action" recommended="5" value={form.attemptThreshold} min={1} max={20} unit="attempts" onChange={v => setForm({ ...form, attemptThreshold: v })} />
              <PolicySlider label="Detection window" description="Time window to count" recommended="10 min" value={form.attemptWindowMinutes} min={1} max={60} unit="min" onChange={v => setForm({ ...form, attemptWindowMinutes: v })} />
              <div style={{ opacity: mode === 'permanent-deny' ? 0.4 : 1, pointerEvents: mode === 'permanent-deny' ? 'none' : 'auto' }}>
                <PolicySlider label="Temporary ban duration" description="How long to block" recommended="7 days" value={form.tempBanDays} min={1} max={30} unit="days" onChange={v => setForm({ ...form, tempBanDays: v })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: 14, marginBottom: mode === 'permanent-deny' ? 8 : 20, opacity: mode === 'permanent-deny' ? 0.4 : 1, pointerEvents: mode === 'permanent-deny' ? 'none' : 'auto' }}>
              <Field label="Escalation rule" hint="Promote to permanent block">
                <Select value={String(form.tempBanCountBeforeEscalation)} onChange={v => setForm({ ...form, tempBanCountBeforeEscalation: Number(v) })} options={[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `Escalate after ${n} ban${n === 1 ? '' : 's'}` }))} />
              </Field>
              <Field label="Repeat-offender window" hint="Window for counting bans">
                <Select value={String(form.repeatWindowDays)} onChange={v => setForm({ ...form, repeatWindowDays: Number(v) })} options={[7, 14, 30, 60, 90].map(n => ({ value: String(n), label: `${n} days` }))} />
              </Field>
            </div>
            {mode === 'permanent-deny' && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconAlertCircle size={13} />Ban duration and escalation don&apos;t apply in Permanent Deny mode — first offense is permanent.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: 16, gap: 8 }}>
              <button onClick={() => { if (thresholds) setForm(thresholds); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, fontWeight: 600 }}>
                <IconRefresh size={14} stroke={1.9} />Reset to defaults
              </button>
              {primaryBtn(thresholdSaving ? 'Saving…' : 'Save security policy', saveThresholds, thresholdSaving, <IconLock size={14} stroke={1.9} />)}
            </div>
          </>
        )}
      </SettingsCard>

      <SettingsCard pad={false}>
        <div style={{ padding: 18 }}>
          {form && <EffectivePolicyFlow form={form} mode={mode} onLearnMore={() => setShowPolicyModal(true)} />}
        </div>
      </SettingsCard>
    </div>
  );

  // ── Tab: Preferences ───────────────────────────────────────────────────────
  const preferencesTab = (
    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: 18, alignItems: 'start' }}>
      <SettingsCard title="Appearance" subtitle="Console theme for this browser.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <IconDeviceDesktop size={28} stroke={1.5} style={{ color: 'var(--accent)' }} />
          <div style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber)' }}>
            <IconSun size={17} stroke={1.7} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['dark', 'light'] as const).map(code => (
            <button key={code} onClick={() => setTheme(code)} style={{ padding: '8px 22px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, border: '1px solid var(--border)', background: theme === code ? 'var(--accent)' : 'transparent', color: theme === code ? '#fff' : 'var(--text-dim)' }}>{code === 'dark' ? 'Dark' : 'Light'}</button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Language" subtitle="Console display language.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <IconWorld size={28} stroke={1.5} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([{ code: 'en', label: 'English' }, { code: 'ru', label: 'Русский' }, { code: 'es', label: 'Español' }, { code: 'pt', label: 'Português' }] as const).map(({ code, label }) => (
            <button key={code} onClick={() => setLang(code)} style={{ padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, border: '1px solid var(--border)', background: lang === code ? 'var(--accent)' : 'transparent', color: lang === code ? '#fff' : 'var(--text-dim)' }}>{label}</button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );

  // ── Tab: System ────────────────────────────────────────────────────────────
  const sysCardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', padding: 18, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' };
  const sysDescStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55, flex: 1, marginBottom: 16 };
  const fullGhost: React.CSSProperties = { ...ghostStyle, width: '100%' };
  const systemTab = (
    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr 1fr', gap: 18, alignItems: 'stretch' }}>
      <div style={sysCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <IconDatabase size={24} stroke={1.6} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>Backups</div>
          <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>ADMIN</span>
        </div>
        <div style={sysDescStyle}>Export a snapshot of keys, policy, and settings — or import one to restore state.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={apiUrl('/api/backup')} style={{ textDecoration: 'none', flex: 1 }}><span style={fullGhost}>Export</span></a>
          <button onClick={openImport} style={{ ...ghostStyle, flex: 1 }}>Import</button>
        </div>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={async e => { const file = e.target.files?.[0]; if (file) await importBackup(file); e.currentTarget.value = ''; }} />
      </div>

      <div style={sysCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <IconKey size={24} stroke={1.6} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>Access &amp; keys</div>
        </div>
        <div style={sysDescStyle}>Signed in as <strong style={{ color: 'var(--text-bright)' }}>{session?.user?.displayName || session?.user?.username || '—'}</strong> ({session?.user?.role ?? 'unknown'}). Manage operator access and keys.</div>
        <a href={apiUrl('/keys')} style={{ textDecoration: 'none' }}><span style={fullGhost}>Manage access<IconChevronRight size={14} /></span></a>
      </div>

      <div style={sysCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <IconDatabaseImport size={24} stroke={1.6} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>Restore</div>
        </div>
        <div style={sysDescStyle}>Restore from a backup file. Importing overwrites current state — existing keys and policy are replaced.</div>
        <button onClick={openImport} style={fullGhost}><IconRefresh size={14} />Restore system</button>
      </div>
    </div>
  );

  // ── Page ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: isNarrow ? '16px 14px 28px' : '20px 24px 32px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-bright)', margin: 0, marginBottom: 5 }}>{t('settings.pageTitle')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>Configure security, access, and system preferences.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {session?.user?.role && (
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', background: 'var(--surface)', textTransform: 'capitalize' }}>{session.user.role}</span>
          )}
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', borderRadius: 6, background: mode === 'permanent-deny' ? 'var(--red-dim)' : 'var(--green-dim)', border: `1px solid ${mode === 'permanent-deny' ? 'color-mix(in srgb, var(--red) 35%, transparent)' : 'color-mix(in srgb, var(--green) 35%, transparent)'}`, color: mode === 'permanent-deny' ? 'var(--red)' : 'var(--green)' }}>{mode === 'permanent-deny' ? 'Permanent Deny' : 'Temp Ban'}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 22, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '11px 16px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
              background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              color: active ? 'var(--text-bright)' : 'var(--text-dim)', marginBottom: -1,
            }}>
              <Icon size={17} stroke={1.7} />{label}
            </button>
          );
        })}
      </div>

      {message && <Banner msg={message} />}

      {activeTab === 'security' && securityTab}
      {activeTab === 'invites' && invitesTab}
      {activeTab === 'preferences' && preferencesTab}
      {activeTab === 'system' && systemTab}

      {showPolicyModal && <PolicyModal onClose={() => setShowPolicyModal(false)} />}
    </div>
  );
}
