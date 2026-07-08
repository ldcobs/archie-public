'use client';
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';
import type { UserStat } from '@/lib/types';
import { Btn } from './ui';
import { apiUrl } from '@/lib/api-path';

function ModalWrap({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, width: 460, maxWidth: '95vw' }}>
        <h2 style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 16, letterSpacing: .5 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6,
        padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, outline: 'none',
        marginBottom: 12,
      }}
    />
  );
}

function Msg({ text, ok }: { text: string; ok: boolean }) {
  return (
    <div style={{
      fontSize: 11, padding: '7px 10px', borderRadius: 4, marginBottom: 10,
      background: ok ? 'rgba(57,211,83,.1)' : 'rgba(255,68,68,.1)',
      color: ok ? 'var(--green)' : 'var(--red)',
    }}>
      {text}
    </div>
  );
}

// ── Protocol profiles ──────────────────────────────────────────────────────────

export const PROTOCOL_PROFILES: Record<string, { label: string; badges: string[] }> = {
  'vless-reality':      { label: 'VLESS + XTLS-Reality',       badges: ['VLESS', 'Reality', 'XTLS Vision'] },
  'vless-ws-tls':       { label: 'VLESS + WebSocket + TLS',    badges: ['VLESS', 'TLS', 'WS'] },
  'vless-grpc-tls':     { label: 'VLESS + gRPC + TLS',         badges: ['VLESS', 'TLS', 'gRPC'] },
  'vmess-ws-tls':       { label: 'VMess + WebSocket + TLS',    badges: ['VMess', 'TLS', 'WS'] },
  'vmess-grpc-tls':     { label: 'VMess + gRPC + TLS',         badges: ['VMess', 'TLS', 'gRPC'] },
  'trojan-tls':         { label: 'Trojan + TLS',               badges: ['Trojan', 'TLS'] },
  'trojan-ws-tls':      { label: 'Trojan + WebSocket + TLS',   badges: ['Trojan', 'TLS', 'WS'] },
  'shadowsocks':        { label: 'Shadowsocks',                badges: ['Shadowsocks'] },
  'hysteria2':          { label: 'Hysteria2',                  badges: ['Hysteria2', 'QUIC'] },
  'wireguard':          { label: 'WireGuard',                  badges: ['WireGuard'] },
  'vless-xhttp-tls':    { label: 'VLESS + XHTTP + TLS',        badges: ['VLESS', 'XHTTP', 'TLS'] },
  'vmess-xhttp-tls':    { label: 'VMess + XHTTP + TLS',        badges: ['VMess', 'XHTTP', 'TLS'] },
  'vless-httpupgrade':  { label: 'VLESS + HTTPUpgrade + TLS',  badges: ['VLESS', 'HTTPUpgrade', 'TLS'] },
  'vmess-httpupgrade':  { label: 'VMess + HTTPUpgrade + TLS',  badges: ['VMess', 'HTTPUpgrade', 'TLS'] },
  'vless-mkcp':         { label: 'VLESS + mKCP',               badges: ['VLESS', 'mKCP'] },
  'vmess-mkcp':         { label: 'VMess + mKCP',               badges: ['VMess', 'mKCP'] },
  'http':               { label: 'HTTP Proxy',                 badges: ['HTTP'] },
  'socks':              { label: 'SOCKS Mixed',                badges: ['SOCKS5', 'UDP'] },
  'dokodemo':           { label: 'Dokodemo-door',              badges: ['Tunnel', 'Transparent'] },
};

export function protocolBadges(keys: string | string[] | null | undefined): string[] {
  if (!keys) return [];
  const list = Array.isArray(keys) ? keys : [keys];
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const badges = PROTOCOL_PROFILES[list[i]]?.badges ?? [list[i].toUpperCase()];
    for (const b of badges) {
      if (!seen.has(b)) { seen.add(b); result.push(b); }
    }
    if (i < list.length - 1) result.push('|');
  }
  return result;
}

const TIERS: { id: string; label: string; desc: string; protocols: string[] }[] = [
  {
    id: 'standard',
    label: 'Standard',
    desc: 'Best performance. Works with Amnezia, Hiddify, v2rayNG, Shadowrocket.',
    protocols: ['vless-reality'],
  },
  {
    id: 'compatible',
    label: 'Compatible',
    desc: 'Adds VMess fallback for older clients and restricted networks.',
    protocols: ['vless-reality', 'vmess-ws-tls'],
  },
  {
    id: 'universal',
    label: 'Universal',
    desc: 'Max compatibility — works with any client on any network.',
    protocols: ['vless-reality', 'vmess-ws-tls', 'trojan-tls'],
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Manually select protocols.',
    protocols: [],
  },
];

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function ProtocolPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const activeTier = TIERS.find(t => t.id !== 'custom' && arraysEqual(t.protocols, value))?.id ?? 'custom';
  const [showCustom, setShowCustom] = useState(activeTier === 'custom');

  function selectTier(tier: typeof TIERS[0]) {
    if (tier.id === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onChange(tier.protocols);
    }
  }

  const badgePreview = protocolBadges(value).filter(b => b !== '|');

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>Protocol compatibility</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        {TIERS.map(tier => {
          const active = activeTier === tier.id;
          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => selectTier(tier)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                background: active ? 'rgba(88,166,255,.1)' : 'rgba(10,15,24,.6)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', marginBottom: 3 }}>
                {tier.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>{tier.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Badge preview */}
      {badgePreview.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: showCustom ? 10 : 0 }}>
          {protocolBadges(value).map((b, i) => (
            <span key={i} style={{
              fontSize: 10, padding: b === '|' ? '0 2px' : '2px 7px', borderRadius: 4,
              background: b === '|' ? 'transparent' : 'rgba(189,147,249,.12)',
              color: b === '|' ? 'var(--muted)' : '#bd93f9',
              border: b === '|' ? 'none' : '1px solid rgba(189,147,249,.25)',
              fontWeight: 600,
            }}>{b}</span>
          ))}
        </div>
      )}

      {/* Custom checkbox grid */}
      {showCustom && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 8 }}>
          {Object.entries(PROTOCOL_PROFILES).map(([k, v]) => {
            const checked = value.includes(k);
            return (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: checked ? 'var(--text)' : 'var(--muted)', background: checked ? 'rgba(88,166,255,.06)' : 'transparent', border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, padding: '5px 8px', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? value.filter(p => p !== k) : [...value, k])}
                  style={{ accentColor: 'var(--accent)', width: 12, height: 12 }}
                />
                {v.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── New user modal ─────────────────────────────────────────────────────────────

export function NewUserModal({ groups, onClose, onCreated }: {
  groups: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail]         = useState('');
  const [createdEmail, setCreated] = useState(''); // lowercase email returned by API
  const [display, setDisplay]     = useState('');
  const [group, setGroup]         = useState(groups[0] ?? '__new__');
  const [customGroup, setCustom]  = useState('');
  const [protocols, setProtocols] = useState<string[]>(['vless-reality']);
  const [msg, setMsg]             = useState<{ text: string; ok: boolean } | null>(null);
  const [uri, setUri]             = useState('');
  const [uuid, setUuid]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState('');

  const chosenGroup = group === '__new__' ? customGroup : group;

  async function create() {
    if (!email) return;
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName: display || email, group: chosenGroup, protocols }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ text: d.error, ok: false });
      } else {
        setUri(d.vless_uri);
        setUuid(d.uuid);
        setCreated(d.email);
        setMsg({ text: `✓ Key created for ${d.email} — active within 60s`, ok: true });
        onCreated();
      }
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    }
    setLoading(false);
  }

  const subUrl = typeof window !== 'undefined' && uuid
    ? `${window.location.origin}/v2/api/sub/${uuid}` : '';

  return (
    <ModalWrap title={uri ? '✓ KEY CREATED' : '＋ GENERATE VPN KEY'} onClose={onClose}>
      {msg && <Msg text={msg.text} ok={msg.ok} />}

      {/* Form — only shown before key is generated */}
      {!uri && (
        <>
          <Input value={email} onChange={setEmail} placeholder="Key name (e.g. john) — lowercase, no spaces" />
          <Input value={display} onChange={setDisplay} placeholder="Display name (e.g. John — optional)" />
          <select
            value={group}
            onChange={e => setGroup(e.target.value)}
            style={{ width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, marginBottom: 12 }}
          >
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__new__">+ New group…</option>
          </select>
          {group === '__new__' && (
            <Input value={customGroup} onChange={setCustom} placeholder="New group name" />
          )}
          <ProtocolPicker value={protocols} onChange={setProtocols} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn variant="default" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={create} disabled={loading || !email}>{loading ? '…' : 'Generate Key'}</Btn>
          </div>
        </>
      )}

      {/* Results — shown after key is generated */}
      {uri && (
        <>
          {/* QR Code */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>Scan with VPN app (v2rayNG, Hiddify, Amnezia)</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={apiUrl(`/api/qr/${encodeURIComponent(createdEmail)}`)}
              alt="QR code"
              style={{ width: 240, height: 240, borderRadius: 8, background: '#0a0a0f' }}
            />
          </div>

          {/* Subscription URL */}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Subscription URL (auto-updates every 6h)</div>
          <div style={{ background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 12, fontFamily: 'monospace' }}>
            {subUrl}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
            <Btn variant="primary" onClick={() => { copyText(subUrl); setCopied('sub'); setTimeout(() => setCopied(''), 2000); }}>
              {copied === 'sub' ? '✓ Copied!' : '📋 Copy Sub URL'}
            </Btn>
            <Btn variant="default" onClick={() => { copyText(uri); setCopied('uri'); setTimeout(() => setCopied(''), 2000); }}>
              {copied === 'uri' ? '✓ Copied!' : '📋 Copy VLESS URI'}
            </Btn>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Btn variant="default" onClick={onClose}>Done</Btn>
          </div>
        </>
      )}
    </ModalWrap>
  );
}

// ── Delete user modal ──────────────────────────────────────────────────────────

export function DeleteUserModal({ email, onClose, onDeleted }: { email: string; onClose: () => void; onDeleted: () => void }) {
  async function confirm_() {
    await fetch(apiUrl(`/api/users/${encodeURIComponent(email)}`), { method: 'DELETE' });
    onDeleted();
    onClose();
  }
  return (
    <ModalWrap title="🗑 REMOVE USER" onClose={onClose}>
      <p style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>Remove user &quot;{email}&quot; and revoke their VPN access?</p>
      <p style={{ fontSize: 11, color: 'var(--muted)' }}>Their VPN key will stop working within 60 seconds.</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn variant="default" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" onClick={confirm_}>Remove</Btn>
      </div>
    </ModalWrap>
  );
}

// ── Meta edit modal ────────────────────────────────────────────────────────────

const SELECT_STYLE: React.CSSProperties = { width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12 };

function SelectField({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={SELECT_STYLE}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function MetaEditModal({ u, groups, onClose, onSaved }: {
  u: UserStat;
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplay]  = useState(u.meta?.displayName ?? u.email);
  const [group, setGroup]          = useState(u.meta?.group ?? groups[0] ?? '');
  const [customGroup, setCustom]   = useState('');
  const [isps, setIsps]            = useState((u.meta?.expectedIsps ?? []).join(', '));
  const [notes, setNotes]          = useState(u.meta?.notes ?? '');
  const [expiresAt, setExpires]    = useState(u.meta?.expiresAt ? u.meta.expiresAt.slice(0, 10) : '');
  const [trafficLimit, setLimit]   = useState(String(u.meta?.trafficLimitGB ?? ''));
  const [connLimit, setConnLimit]  = useState(String(u.meta?.connectionLimit ?? ''));
  const [protocols, setProtocols]  = useState<string[]>(u.meta?.protocols?.length ? u.meta.protocols : ['vless-reality']);
  // Sharing-policy per-key overrides
  const [unknownDevice, setUnknownDevice] = useState<string>(u.meta?.unknownDevice ?? 'require_approval');
  const [newCountry, setNewCountry]       = useState<string>(u.meta?.newCountry    ?? 'require_approval');
  const [newIsp, setNewIsp]               = useState<string>(u.meta?.newIsp        ?? 'warn');
  const [overflowAction, setOverflow]     = useState<string>(u.meta?.overflowAction ?? 'auto_reject');
  const [saving, setSaving]        = useState(false);
  const [msg, setMsg]              = useState<{ text: string; ok: boolean } | null>(null);

  const chosenGroup = group === '__new__' ? customGroup : group;

  async function save() {
    if (!u.uuid) return;
    setSaving(true);
    try {
      const r = await fetch(apiUrl(`/api/meta/${u.uuid}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          group: chosenGroup,
          expectedIsps: isps.split(',').map(s => s.trim()).filter(Boolean),
          notes,
          expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59Z').toISOString() : null,
          trafficLimitGB: trafficLimit ? parseFloat(trafficLimit) : 0,
          connectionLimit: connLimit ? parseInt(connLimit, 10) : 0,
          protocols,
          unknownDevice,
          newCountry,
          newIsp,
          overflowAction,
        }),
      });
      if (r.ok) {
        setMsg({ text: '✓ Saved', ok: true });
        onSaved();
        setTimeout(onClose, 800);
      } else {
        const d = await r.json();
        setMsg({ text: d.error ?? 'Error', ok: false });
      }
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    }
    setSaving(false);
  }

  return (
    <ModalWrap title={`✎ EDIT — ${u.email}`} onClose={onClose}>
      {msg && <Msg text={msg.text} ok={msg.ok} />}
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
        UUID: <span style={{ fontFamily: 'monospace', color: 'var(--border)' }}>{u.uuid}</span>
      </div>
      <Input value={displayName} onChange={setDisplay} placeholder="Display name" />
      <select
        value={group}
        onChange={e => setGroup(e.target.value)}
        style={{ width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, marginBottom: 12 }}
      >
        {groups.map(g => <option key={g} value={g}>{g}</option>)}
        <option value="__new__">+ New group…</option>
      </select>
      {group === '__new__' && (
        <Input value={customGroup} onChange={setCustom} placeholder="New group name" />
      )}
      <Input value={isps} onChange={setIsps} placeholder="Expected ISPs (comma-separated, e.g. Beeline, MTS)" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Expiry date</div>
          <input
            type="date" value={expiresAt} onChange={e => setExpires(e.target.value)}
            style={{ width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Traffic limit GB</div>
          <input
            type="number" min="0" step="1" value={trafficLimit} onChange={e => setLimit(e.target.value)}
            placeholder="0"
            style={{ width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Max devices</div>
          <input
            type="number" min="0" step="1" value={connLimit} onChange={e => setConnLimit(e.target.value)}
            placeholder="6"
            style={{ width: '100%', background: '#0a0f18', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12 }}
          />
        </div>
      </div>
      <ProtocolPicker value={protocols} onChange={setProtocols} />

      {/* Sharing policy — per-key overrides */}
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, margin: '4px 0 8px' }}>Sharing policy</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SelectField label="Unknown device" value={unknownDevice} onChange={setUnknownDevice}
          opts={[['require_approval', 'Require approval'], ['allow', 'Allow'], ['reject', 'Reject']]} />
        <SelectField label="New country" value={newCountry} onChange={setNewCountry}
          opts={[['require_approval', 'Require approval'], ['allow', 'Allow'], ['reject', 'Reject']]} />
        <SelectField label="New ISP" value={newIsp} onChange={setNewIsp}
          opts={[['warn', 'Warn'], ['allow', 'Allow'], ['reject', 'Reject']]} />
        <SelectField label="Device overflow" value={overflowAction} onChange={setOverflow}
          opts={[['auto_reject', 'Auto-reject'], ['allow', 'Allow']]} />
      </div>

      <Input value={notes} onChange={setNotes} placeholder="Notes (optional)" />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn variant="default" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving ? '…' : 'Save'}</Btn>
      </div>
    </ModalWrap>
  );
}
