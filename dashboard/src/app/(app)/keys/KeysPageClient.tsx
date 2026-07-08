'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import { useGlobalSSE } from '@/lib/use-sse';
import type { StatsResponse, UserStat } from '@/lib/types';
import type { AuthUserRecord, AuthRole } from '@/lib/auth-users';
import UserPanel from './UserPanel';
import NewKeyPanel from './NewKeyPanel';
import NewAccountPanel from './NewAccountPanel';

// ── Protocol chip colours ─────────────────────────────────────────────────────
const PROTO_COLOR: Record<string, string> = {
  'vless-reality': '#00d4ff', 'vless-reality-vision': '#00d4ff',
  'vless-ws-tls': '#4e9eff', 'vless-grpc-tls': '#4e9eff',
  'vless-xhttp-tls': '#4e9eff', 'vless-httpupgrade': '#4e9eff',
  'vmess-ws-tls': '#4e9eff', 'vmess-grpc-tls': '#4e9eff',
  'trojan-tls': '#b57bff', 'trojan-ws': '#b57bff',
  'shadowsocks': '#ffb347',
  'hysteria2': '#3ddc84',
  'wireguard': '#57c7b8',
};
function protoColor(key: string) {
  return PROTO_COLOR[key] ?? 'rgba(180,195,215,0.4)';
}
function protoLabel(key: string) {
  const map: Record<string, string> = {
    'vless-reality': 'Reality', 'vless-reality-vision': 'Reality+',
    'vless-ws-tls': 'VLESS WS', 'vless-grpc-tls': 'VLESS gRPC',
    'vless-xhttp-tls': 'XHTTP', 'vless-httpupgrade': 'HTTPUpgrade',
    'vmess-ws-tls': 'VMess WS', 'vmess-grpc-tls': 'VMess gRPC',
    'trojan-tls': 'Trojan', 'trojan-ws': 'Trojan WS',
    'shadowsocks': 'SS', 'hysteria2': 'HY2', 'wireguard': 'WG',
  };
  return map[key] ?? key;
}

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

function statusDot(s: UserStat) {
  if (s.status === 'online') return '#22dd88';
  if (s.status === 'recent') return '#ffb347';
  return 'rgba(180,195,215,0.2)';
}

type SortKey = 'name' | 'traffic' | 'last_seen' | 'status';

export default function KeysPageClient() {
  const { t, lang, setLang } = useI18n();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [accounts, setAccounts] = useState<Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>[]>([]);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('status');
  const [tab, setTab] = useState<'vpn' | 'accounts'>('vpn');
  const [panel, setPanel] = useState<{ type: 'user'; stat: UserStat } | { type: 'newkey' } | { type: 'newaccount' } | { type: 'account'; account: Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'> } | null>(null);

  const isOwner = role === 'owner';
  const { statsSeq } = useGlobalSSE();

  const load = useCallback((currentRole?: AuthRole | null) => {
    fetchJson<StatsResponse>(apiUrl('/api/stats')).then(d => { if (d) setStats(d); }).catch(() => {});
    if (currentRole === 'owner') {
      fetchJson<Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>[]>(apiUrl('/api/auth/accounts'))
        .then(d => { if (Array.isArray(d)) setAccounts(d); })
        .catch(() => {});
    }
  }, []);

  // Resolve role once on mount
  useEffect(() => {
    fetchJson<{ user: { role: AuthRole } | null }>(apiUrl('/api/auth/session'))
      .then(s => { const r = s?.user?.role ?? null; setRole(r); load(r); })
      .catch(() => { load(null); });
  }, [load]);

  // Refresh on SSE tick instead of setInterval
  useEffect(() => {
    if (statsSeq === 0) return;
    load(role);
  }, [statsSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => stats ? [...new Set(stats.active.map(u => u.meta?.group ?? 'Ungrouped'))].sort() : [], [stats]);

  const filtered = useMemo(() => {
    if (!stats) return [];
    let list = [...stats.active];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u => u.email.includes(q) || (u.meta?.displayName ?? '').toLowerCase().includes(q) || (u.meta?.group ?? '').toLowerCase().includes(q));
    }
    if (groupFilter) list = list.filter(u => (u.meta?.group ?? 'Ungrouped') === groupFilter);
    list.sort((a, b) => {
      if (sort === 'name') return (a.meta?.displayName ?? a.email).localeCompare(b.meta?.displayName ?? b.email);
      if (sort === 'traffic') return (b.traffic?.total ?? 0) - (a.traffic?.total ?? 0);
      if (sort === 'last_seen') return (b.last_seen ?? '').localeCompare(a.last_seen ?? '');
      // status: online first, then recent, then offline
      const order = { online: 0, recent: 1, offline: 2 };
      return order[a.status] - order[b.status];
    });
    return list;
  }, [stats, search, groupFilter, sort]);

  const onlineCount = stats?.active.filter(u => u.status === 'online').length ?? 0;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Main list */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <div style={{ padding: '22px 26px 12px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: '#00d4ff', textTransform: 'uppercase' }}>{t('keys.title')}</div>
              <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.45)', marginTop: 4 }}>
                {stats?.active.length ?? 0} VPN keys · {onlineCount} online{isOwner ? ` · ${accounts.length} local system users` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', border: '1px solid rgba(84,112,151,0.28)', borderRadius: 7, overflow: 'hidden' }}>
                {(['en', 'ru', 'es', 'pt'] as const).map((choice) => (
                  <button
                    key={choice}
                    onClick={() => setLang(choice)}
                    style={{
                      border: 'none',
                      background: lang === choice ? '#09d6ff' : 'transparent',
                      padding: '7px 10px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      fontWeight: 800,
                      color: lang === choice ? '#000' : 'rgba(168,184,209,0.72)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              <button onClick={() => setPanel({ type: 'newkey' })} style={btnStyle('#00d4ff', '#041019')}>{t('keys.newKey')}</button>
              {isOwner && <button onClick={() => setPanel({ type: 'newaccount' })} style={btnStyle('rgba(180,195,215,0.12)', 'rgba(180,195,215,0.8)', true)}>{t('keys.newSystemUser')}</button>}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid rgba(74,108,149,0.2)', paddingBottom: 0 }}>
            {(['vpn', ...(isOwner ? ['accounts'] : [])] as ('vpn' | 'accounts')[]).map(tab2 => (
              <button key={tab2} onClick={() => setTab(tab2)} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 700, padding: '6px 14px',
                color: tab === tab2 ? '#00d4ff' : 'rgba(180,195,215,0.4)',
                borderBottom: tab === tab2 ? '2px solid #00d4ff' : '2px solid transparent',
                marginBottom: -1, textTransform: 'uppercase', letterSpacing: 1.2,
              }}>
                {tab2 === 'vpn' ? t('keys.tabVpn', { n: String(stats?.active.length ?? 0) }) : t('keys.tabAccounts', { n: String(accounts.length) })}
              </button>
            ))}
          </div>

          {/* VPN Keys tab */}
          {tab === 'vpn' && (
            <>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('keys.searchPlaceholder')}
                  style={{ flex: 1, minWidth: 160, background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '7px 11px', color: '#eef3f8', fontSize: 12, outline: 'none' }}
                />
                <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                  style={{ background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '7px 10px', color: groupFilter ? '#eef3f8' : 'rgba(180,195,215,0.4)', fontSize: 12, outline: 'none' }}>
                  <option value="">{t('keys.allGroups')}</option>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                  style={{ background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '7px 10px', color: '#eef3f8', fontSize: 12, outline: 'none' }}>
                  <option value="status">{t('keys.sortStatus')}</option>
                  <option value="name">{t('keys.sortName')}</option>
                  <option value="traffic">{t('keys.sortTraffic')}</option>
                  <option value="last_seen">{t('keys.sortLastSeen')}</option>
                </select>
              </div>

              {/* Key rows — grouped by meta.group */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: '32px 0', textAlign: 'center', color: 'rgba(180,195,215,0.3)', fontSize: 12 }}>
                    {stats ? t('keys.noMatch') : t('keys.loading')}
                  </div>
                ) : groupFilter ? (
                  filtered.map(u => (
                    <KeyRow key={u.uuid} stat={u} active={panel?.type === 'user' && panel.stat.uuid === u.uuid} onClick={() => setPanel({ type: 'user', stat: u })} t={t} />
                  ))
                ) : (
                  Object.entries(
                    filtered.reduce<Record<string, typeof filtered>>((acc, u) => {
                      const g = u.meta?.group ?? 'Ungrouped';
                      (acc[g] ??= []).push(u);
                      return acc;
                    }, {})
                  ).map(([grp, users]) => (
                    <div key={grp}>
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, color: 'rgba(180,195,215,0.28)', textTransform: 'uppercase', padding: '10px 10px 3px', borderTop: '1px solid rgba(74,108,149,0.1)', marginTop: 4 }}>
                        {grp} <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {users.length}</span>
                      </div>
                      {users.map(u => (
                        <KeyRow key={u.uuid} stat={u} active={panel?.type === 'user' && panel.stat.uuid === u.uuid} onClick={() => setPanel({ type: 'user', stat: u })} t={t} />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Dashboard Accounts tab — owner only */}
          {tab === 'accounts' && isOwner && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.12)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#00d4ff', marginBottom: 6 }}>{t('keys.localAccessTitle')}</div>
                <div style={{ fontSize: 11, lineHeight: 1.55, color: 'rgba(180,195,215,0.55)' }}>
                  {t('keys.localAccessDesc')}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {accounts.map(acc => (
                <AccountRow key={acc.id} account={acc} active={panel?.type === 'account' && panel.account.id === acc.id} onClick={() => setPanel({ type: 'account', account: acc })} />
              ))}
              {accounts.length === 0 && (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'rgba(180,195,215,0.3)', fontSize: 12 }}>{t('keys.noAccounts')}</div>
              )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      {panel && (
        <div style={{
          width: 380, minWidth: 340, borderLeft: '1px solid rgba(74,108,149,0.2)',
          background: '#070d18', overflowY: 'auto', flexShrink: 0,
          animation: 'slideIn 0.15s ease',
        }}>
          {panel.type === 'user' && <UserPanel stat={panel.stat} onClose={() => setPanel(null)} onRefresh={load} />}
          {panel.type === 'newkey' && <NewKeyPanel groups={groups} onClose={() => setPanel(null)} onCreated={() => { load(); setPanel(null); }} />}
          {panel.type === 'newaccount' && <NewAccountPanel onClose={() => setPanel(null)} onCreated={() => { load(); setPanel(null); }} />}
          {panel.type === 'account' && <AccountPanel account={panel.account} onClose={() => setPanel(null)} onRefresh={() => { load(); setPanel(null); }} />}
        </div>
      )}

      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(16px) } to { opacity:1; transform:translateX(0) } }`}</style>
    </div>
  );
}

// ── Key row ───────────────────────────────────────────────────────────────────
function KeyRow({ stat, active, onClick, t }: { stat: UserStat; active: boolean; onClick: () => void; t: (k: string, v?: Record<string, string>) => string }) {
  const name = stat.meta?.displayName ?? stat.email;
  const group = stat.meta?.group ?? 'Ungrouped';
  const protocols = stat.meta?.protocols ?? [];
  const traffic = stat.traffic;
  const ip = stat.ips[0];

  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 8, cursor: 'pointer',
      background: active ? 'rgba(0,212,255,0.07)' : stat.expired ? 'rgba(255,77,90,0.06)' : 'transparent',
      border: `1px solid ${active ? 'rgba(0,212,255,0.18)' : stat.expired ? 'rgba(255,77,90,0.25)' : 'transparent'}`,
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = stat.expired ? 'rgba(255,77,90,0.10)' : 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = stat.expired ? 'rgba(255,77,90,0.06)' : 'transparent'; }}
    >
      {/* Status dot */}
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot(stat), flexShrink: 0, boxShadow: stat.status === 'online' ? '0 0 5px #22dd88' : 'none' }} />

      {/* Name + group */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#dce8f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {stat.meta?.isOwner && <span style={{ fontSize: 8, color: '#ffb347' }}>♛</span>}
          {stat.expired && <span style={{ fontSize: 9, fontWeight: 700, color: '#ff6b75', background: 'rgba(255,77,90,0.1)', padding: '1px 5px', borderRadius: 3 }}>{t('keys.expired')}</span>}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.4)', marginTop: 1 }}>{group} · {stat.email}</div>
      </div>

      {/* Protocol chips */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflow: 'hidden', maxWidth: 120 }}>
        {protocols.slice(0, 3).map(p => (
          <span key={p} style={{ fontSize: 9, fontWeight: 700, color: protoColor(p), background: `${protoColor(p)}18`, border: `1px solid ${protoColor(p)}33`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{protoLabel(p)}</span>
        ))}
        {protocols.length > 3 && <span style={{ fontSize: 9, color: 'rgba(180,195,215,0.35)' }}>+{protocols.length - 3}</span>}
      </div>

      {/* Traffic + last seen stacked */}
      <div style={{ minWidth: 64, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.55)', whiteSpace: 'nowrap' }}>
          {traffic ? fmtBytes(traffic.total) : '—'}
        </div>
        <div style={{ fontSize: 9.5, color: 'rgba(180,195,215,0.28)', whiteSpace: 'nowrap', marginTop: 1 }}>
          {stat.last_seen ? fmtLastSeen(stat.last_seen, t) : t('time.never')}
        </div>
      </div>

      {/* Last IP flag */}
      <div style={{ fontSize: 11, minWidth: 24, textAlign: 'center' }}>
        {ip ? <span title={`${ip.city}, ${ip.cc} — ${ip.isp}`}>{ip.flag}</span> : <span style={{ color: 'rgba(180,195,215,0.2)' }}>·</span>}
      </div>
    </div>
  );
}

function fmtLastSeen(iso: string, t: (k: string, v?: Record<string, string>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2)   return t('keys.justNow');
  if (m < 60)  return t('keys.nAgo', { n: String(m), unit: t('time.m') });
  const h = Math.floor(m / 60);
  if (h < 24)  return t('keys.nAgo', { n: String(h), unit: t('time.h') });
  const d = Math.floor(h / 24);
  if (d < 7)   return t('keys.nAgo', { n: String(d), unit: t('time.d') });
  return new Date(iso).toLocaleDateString();
}

// ── Account row ───────────────────────────────────────────────────────────────
const ROLE_COLOR: Record<AuthRole, string> = { viewer: '#b0ccee', operator: '#4e9eff', admin: '#b57bff', owner: '#ffb347' };

function AccountRow({ account, active, onClick }: { account: Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>; active: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 8, cursor: 'pointer',
      background: active ? 'rgba(0,212,255,0.07)' : 'transparent',
      border: `1px solid ${active ? 'rgba(0,212,255,0.18)' : 'transparent'}`,
    }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#00d4ff' }}>
        {account.displayName[0]?.toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8f5' }}>{account.displayName}</div>
        <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.4)' }}>@{account.username}</div>
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: ROLE_COLOR[account.role as AuthRole], background: `${ROLE_COLOR[account.role as AuthRole]}18`, border: `1px solid ${ROLE_COLOR[account.role as AuthRole]}33`, borderRadius: 3, padding: '2px 6px', textTransform: 'uppercase' }}>
        {account.role}
      </span>
      {account.disabled && <span style={{ fontSize: 9, fontWeight: 700, color: '#ff6b75', background: 'rgba(255,77,90,0.1)', padding: '2px 5px', borderRadius: 3 }}>DISABLED</span>}
    </div>
  );
}

// ── Account detail panel (inline, simple) ─────────────────────────────────────
function AccountPanel({ account, onClose, onRefresh }: { account: Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>; onClose: () => void; onRefresh: () => void }) {
  const [role, setRole] = useState<AuthRole>(account.role as AuthRole);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setSaving(true); setError('');
    const body: Record<string, unknown> = { role, displayName };
    if (newPassword) body.password = newPassword;
    const r = await fetch(apiUrl(`/api/auth/accounts/${account.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Failed'); }
    else onRefresh();
    setSaving(false);
  }

  async function del() {
    if (!confirm(`Delete account @${account.username}?`)) return;
    setDeleting(true);
    const r = await fetch(apiUrl(`/api/auth/accounts/${account.id}`), { method: 'DELETE' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Failed'); setDeleting(false); }
    else onRefresh();
  }

  return (
    <div style={{ padding: 20 }}>
      <PanelHeader title="Local System User" onClose={onClose} />
      <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.1)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8f5' }}>{account.displayName}</div>
        <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.5)', marginTop: 2 }}>@{account.username}</div>
        <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.35)', marginTop: 4 }}>Created {new Date(account.createdAt).toLocaleDateString()}</div>
      </div>
      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,77,90,0.1)', color: '#ff7d86', fontSize: 12 }}>{error}</div>}
      <FieldLabel>Display name</FieldLabel>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fieldStyle} />
      <FieldLabel>Dashboard role</FieldLabel>
      <select value={role} onChange={e => setRole(e.target.value as AuthRole)} style={{ ...fieldStyle, marginBottom: 14 }}>
        <option value="viewer">viewer — read-only</option>
        <option value="operator">operator — security + device actions</option>
        <option value="admin">admin — key/user mutation, backups</option>
        <option value="owner">owner — full access + account management</option>
      </select>
      <FieldLabel>New password (leave blank to keep)</FieldLabel>
      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••••" style={fieldStyle} />
      <button onClick={save} disabled={saving} style={{ ...btnStyle('#00d4ff', '#041019'), width: '100%', marginBottom: 8 }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      <button onClick={del} disabled={deleting} style={{ ...btnStyle('rgba(255,77,90,0.1)', '#ff6b75', true), width: '100%' }}>
        {deleting ? 'Deleting…' : 'Delete account'}
      </button>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(74,108,149,0.2)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#00d4ff', textTransform: 'uppercase' }}>{title}</div>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(180,195,215,0.4)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
    </div>
  );
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(180,195,215,0.45)', marginBottom: 5, textTransform: 'uppercase' }}>{children}</div>;
}
const fieldStyle: React.CSSProperties = { width: '100%', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '8px 10px', color: '#eef3f8', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };

function btnStyle(bg: string, color: string, outline = false): React.CSSProperties {
  return { background: bg, color, border: outline ? `1px solid ${color}33` : 'none', borderRadius: 7, padding: '8px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
}
