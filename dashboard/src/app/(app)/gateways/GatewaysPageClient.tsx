'use client';
import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import type { AuthRole } from '@/lib/auth-users';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Gateway {
  tag: string;
  name: string;
  protocol: string;
  address: string;
  port: number;
  auth_user?: string;
  flag?: string;
  created_at?: string;
  xray_active?: boolean;
}

interface GatewaysData {
  gateways: Gateway[];
  user_assignments: Record<string, string>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const page: React.CSSProperties = { padding: '28px 32px', minHeight: '100vh', background: 'transparent', color: 'var(--text-bright)', fontFamily: 'inherit' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '18px 20px', marginBottom: 14 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', color: 'var(--text-bright)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const btn = (color: string, bg: string): React.CSSProperties => ({ background: bg, color, border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 });
const badge = (c: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 5, background: `${c}22`, color: c, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 });

const PROTOCOLS = [
  { value: 'socks5',       label: 'SOCKS5' },
  { value: 'shadowsocks',  label: 'Shadowsocks' },
];

const PROTO_COLOR: Record<string, string> = { socks5: '#00d4ff', shadowsocks: '#ffb347' };

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ msg, onAdd }: { msg: string; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🌐</div>
      <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 20, maxWidth: 440, margin: '0 auto 20px' }}>{msg}</div>
      <button style={btn('var(--text-bright)', 'var(--accent-dim)')} onClick={onAdd}>{t('gateways.add')}</button>
    </div>
  );
}

// ── Add gateway form ──────────────────────────────────────────────────────────

interface AddFormProps {
  onClose: () => void;
  onSaved: () => void;
}
function AddGatewayForm({ onClose, onSaved }: AddFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', tag: '', protocol: 'socks5', address: '', port: '1080', auth_user: '', auth_pass: '', flag: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function autoTag(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  function field(k: keyof typeof form, val: string) {
    const update: Partial<typeof form> = { [k]: val };
    if (k === 'name' && !form.tag) update.tag = autoTag(val);
    setForm(f => ({ ...f, ...update }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const res = await fetchJson<{ ok: boolean; error?: string }>(apiUrl('/api/gateways'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: form.tag,
        name: form.name,
        protocol: form.protocol,
        address: form.address,
        port: parseInt(form.port, 10),
        auth_user: form.auth_user || undefined,
        auth_pass: form.auth_pass || undefined,
        flag: form.flag || undefined,
      }),
    });
    setBusy(false);
    if (res?.ok) { onSaved(); onClose(); }
    else setErr(res?.error ?? 'Unknown error');
  }

  const fieldRow = (lbl: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 12 }}>
      <div style={label}>{lbl}</div>
      <input style={inp} type={type} value={form[key]} onChange={e => field(key, e.target.value)} placeholder={placeholder} autoComplete="off" />
    </div>
  );

  return (
    <div style={{ ...card, border: '1px solid rgba(0,212,255,0.25)' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: 'var(--accent)' }}>{t('gateways.add')}</div>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>{fieldRow(t('gateways.name'), 'name', 'text', 'US Exit Node')}</div>
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={label}>{t('gateways.tag')} <span style={{ color: 'var(--text-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— {t('gateways.tagHint')}</span></div>
              <input style={inp} type="text" value={form.tag} onChange={e => field('tag', e.target.value)} placeholder="gw-us" autoComplete="off" required />
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={label}>{t('gateways.protocol')}</div>
              <select style={{ ...inp, appearance: 'none' }} value={form.protocol} onChange={e => field('protocol', e.target.value)}>
                {PROTOCOLS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>{fieldRow(t('gateways.address'), 'address', 'text', '1.2.3.4')}</div>
            <div style={{ width: 80 }}>{fieldRow(t('gateways.port'), 'port', 'number', '1080')}</div>
          </div>
          <div>{fieldRow(t('gateways.authUser'), 'auth_user', 'text')}</div>
          <div>{fieldRow(t('gateways.authPass'), 'auth_pass', 'password')}</div>
          <div>{fieldRow('Flag emoji (optional)', 'flag', 'text', '🇺🇸')}</div>
        </div>
        <div style={{ padding: '8px 10px', background: 'var(--amber-dim)', borderRadius: 6, fontSize: 11, color: 'var(--amber)', marginBottom: 14 }}>
          ⚠ {t('gateways.restartNote')}
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" disabled={busy || !form.tag || !form.address} style={btn('var(--bg)', 'var(--accent)')}>
            {busy ? '…' : t('gateways.add')}
          </button>
          <button type="button" onClick={onClose} style={btn('var(--text-dim)', 'var(--border-subtle)')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ── Gateway card ──────────────────────────────────────────────────────────────

function GatewayCard({ gw, assignedCount, onDelete }: { gw: Gateway; assignedCount: number; onDelete: () => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm) { setConfirm(true); return; }
    setDeleting(true);
    await fetchJson(apiUrl(`/api/gateways/${gw.tag}`), { method: 'DELETE' });
    setDeleting(false);
    onDelete();
  }

  const color = PROTO_COLOR[gw.protocol] ?? 'var(--text-dim)';

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {gw.flag && <span style={{ fontSize: 20 }}>{gw.flag}</span>}
            <span style={{ fontWeight: 700, fontSize: 14 }}>{gw.name}</span>
            <span style={badge(color)}>{gw.protocol.toUpperCase()}</span>
            <span style={badge(gw.xray_active ? 'var(--green)' : 'var(--text-dim)')}>{gw.xray_active ? 'ACTIVE' : 'INACTIVE'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>🏷 <code style={{ color: 'var(--text-dim)' }}>{gw.tag}</code></span>
            <span>🌐 {gw.address}:{gw.port}</span>
            {gw.auth_user && <span>👤 {gw.auth_user}</span>}
            <span>👥 {assignedCount} {t('gateways.assigned')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {confirm && <span style={{ fontSize: 11, color: 'var(--red)' }}>{t('gateways.confirmDelete')}</span>}
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={btn(confirm ? 'var(--bg)' : 'var(--red)', confirm ? 'var(--red)' : 'var(--red-dim)')}
            onBlur={() => setTimeout(() => setConfirm(false), 200)}
          >
            {deleting ? '…' : t('gateways.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Owner chain panel ─────────────────────────────────────────────────────────

function OwnerChainPanel({ gateways, assignments, onChanged }: {
  gateways: Gateway[];
  assignments: Record<string, string>;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [ownerEmail, setOwnerEmail] = useState('');
  const [selectedGw, setSelectedGw] = useState('');
  const [currentGw, setCurrentGw] = useState('');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetchJson<{ user: { email?: string; role?: AuthRole } | null }>(apiUrl('/api/auth/session'))
      .then(d => {
        const email = d?.user?.email ?? '';
        setOwnerEmail(email);
        const cur = assignments[email] ?? '';
        setCurrentGw(cur);
        setSelectedGw(cur);
      })
      .catch(() => {});
  }, [assignments]);

  async function apply() {
    if (!ownerEmail) return;
    setApplying(true); setResult(null);
    let res: { ok: boolean; error?: string };
    if (selectedGw) {
      const r = await fetch(apiUrl(`/api/gateways/${selectedGw}/assign`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail }),
      });
      res = await r.json().catch(() => ({ ok: false }));
    } else {
      const r = await fetch(apiUrl(`/api/gateways/${currentGw || '_'}/unassign`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail }),
      });
      res = await r.json().catch(() => ({ ok: false }));
    }
    setApplying(false);
    if (res.ok) { setCurrentGw(selectedGw); setResult({ ok: true, msg: 'Applied — Xray restarted' }); onChanged(); }
    else setResult({ ok: false, msg: res.error ?? 'Failed' });
  }

  if (!ownerEmail || gateways.length === 0) return null;

  const activeGw = gateways.find(g => g.tag === currentGw);

  return (
    <div style={{ ...card, border: '1px solid rgba(0,212,255,0.15)', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>⛓</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-bright)' }}>{t('gateways.ownerChain')}</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('gateways.ownerChainSub')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 80 }}>
          {t('gateways.currentRoute')}:&nbsp;
          <span style={{ color: activeGw ? (PROTO_COLOR[activeGw.protocol] ?? 'var(--text-dim)') : 'var(--text-faint)', fontWeight: 600 }}>
            {activeGw ? `${activeGw.flag ?? ''} ${activeGw.name}` : t('gateways.direct')}
          </span>
        </div>
        <select
          value={selectedGw}
          onChange={e => { setSelectedGw(e.target.value); setResult(null); }}
          style={{ ...inp, width: 'auto', flex: 1, minWidth: 180 }}
        >
          <option value="">{t('gateways.direct')}</option>
          {gateways.map(g => <option key={g.tag} value={g.tag}>{g.flag} {g.name}</option>)}
        </select>
        <button
          onClick={apply}
          disabled={applying || selectedGw === currentGw}
          style={btn('var(--bg)', selectedGw === currentGw ? 'var(--border-subtle)' : 'var(--accent)')}
        >
          {applying ? t('gateways.applying') : t('gateways.applyRoute')}
        </button>
      </div>
      {selectedGw !== currentGw && !applying && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>⚠ {t('gateways.restartNote')}</div>
      )}
      {result && (
        <div style={{ fontSize: 11, color: result.ok ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>
          {result.ok ? '✅' : '❌'} {result.msg}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GatewaysPageClient() {
  const { t } = useI18n();
  const [data, setData] = useState<GatewaysData | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    fetchJson<GatewaysData & { ok: boolean }>(apiUrl('/api/gateways')).then(d => {
      if (d) setData({ gateways: d.gateways ?? [], user_assignments: d.user_assignments ?? {} });
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const gateways = data?.gateways ?? [];
  const assignments = data?.user_assignments ?? {};

  function countAssigned(tag: string) {
    return Object.values(assignments).filter(t => t === tag).length;
  }

  return (
    <div style={page}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>{t('gateways.title')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('gateways.subtitle')}</p>
        </div>
        {gateways.length > 0 && !showAdd && (
          <button style={btn('var(--bg)', 'var(--accent)')} onClick={() => setShowAdd(true)}>{t('gateways.add')}</button>
        )}
      </div>

      {/* Owner chain */}
      {data && <OwnerChainPanel gateways={gateways} assignments={assignments} onChanged={load} />}

      {/* Add form */}
      {showAdd && <AddGatewayForm onClose={() => setShowAdd(false)} onSaved={load} />}

      {/* List */}
      {data === null ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
      ) : gateways.length === 0 && !showAdd ? (
        <EmptyState msg={t('gateways.empty')} onAdd={() => setShowAdd(true)} />
      ) : (
        gateways.map(gw => (
          <GatewayCard
            key={gw.tag}
            gw={gw}
            assignedCount={countAssigned(gw.tag)}
            onDelete={load}
          />
        ))
      )}

      {/* Assignment summary */}
      {Object.keys(assignments).length > 0 && (
        <div style={{ ...card, marginTop: 8 }}>
          <div style={{ ...label, marginBottom: 10 }}>User routing assignments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(assignments).map(([user, gwTag]) => {
              const gw = gateways.find(g => g.tag === gwTag);
              const color = gw ? (PROTO_COLOR[gw.protocol] ?? 'var(--text-dim)') : 'var(--text-dim)';
              return (
                <div key={user} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--border-subtle)', borderRadius: 6, padding: '4px 10px' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-bright)' }}>{user}</span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>→</span>
                  <span style={{ fontSize: 12, color }}>{gw?.flag} {gw?.name ?? gwTag}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
