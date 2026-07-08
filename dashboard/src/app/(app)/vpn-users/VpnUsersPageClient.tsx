'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { IconUsers, IconCircleCheck, IconClock, IconChartBar, IconAlertTriangle } from '@tabler/icons-react';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useGlobalSSE } from '@/lib/use-sse';
import { useI18n } from '@/lib/i18n';
import { protocolColor, protocolName } from '@/lib/protocol-catalog';
import type { StatsResponse, UserStat } from '@/lib/types';
import type { AuthUserRecord, AuthRole } from '@/lib/auth-users';
import VpnUsersPanel from './VpnUsersPanel';
import NewKeyPanel from '../keys/NewKeyPanel';
import NewAccountPanel from '../keys/NewAccountPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────

const GROUP_PALETTE = ['#4e9eff', '#22dd88', '#b57bff', '#ffb347', '#ff7070', '#57c7b8', '#e8a838'];
function groupColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

function fmtBytes(b: number): string {
  if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
  if (b >= 1e9)  return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6)  return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

function fmtLastSeen(iso: string | null, t: (k: string, v?: Record<string,string>) => string): string {
  if (!iso) return t('keys.lastSeenNever');
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2)  return t('time.now');
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function keyStatus(u: UserStat): 'Active' | 'Disabled' | 'Expired' {
  if (u.meta?.disabled) return 'Disabled';
  if (u.expired)        return 'Expired';
  return 'Active';
}

// Risk is "Balanced": High is reserved for CONCURRENCY signals (genuine sharing —
// the same key active from 2+ ISPs at the same time), not raw IP count. A large
// number of distinct IPs over a day is normal for one person roaming between home
// DHCP, mobile, and office, so it is only a soft Medium signal — never High.
const DAILY_IP_SOFT = 6; // distinct IPs/day above this is a soft Medium signal
function calcRisk(u: UserStat): 'High' | 'Medium' | 'Low' {
  if (u.deviceEstimate.ispConflict) return 'High'; // simultaneous 2+ ISPs = real sharing
  if ((u.devices?.pending_count ?? 0) > 0
    || u.deviceEstimate.sourceIps.length > DAILY_IP_SOFT
    || u.new_ips.length > 1) return 'Medium';
  return 'Low';
}

// Human-readable explanation of why a key carries its risk level. Shown as the
// tooltip on the risk badge so operators can tell real sharing from normal roaming.
function riskReason(u: UserStat): string {
  const de = u.deviceEstimate;
  if (de.ispConflict) {
    const isps = de.conflictIsps.length ? ` (${de.conflictIsps.join(', ')})` : '';
    return `High: active from ${de.conflictIsps.length || 2} ISPs simultaneously${isps} — likely shared. Fix: rotate the key or lower the device limit.`;
  }
  const parts: string[] = [];
  if ((u.devices?.pending_count ?? 0) > 0) parts.push(`${u.devices?.pending_count} device(s) pending approval`);
  if (de.sourceIps.length > DAILY_IP_SOFT) parts.push(`${de.sourceIps.length} IPs seen today (roaming, not necessarily shared)`);
  if (u.new_ips.length > 1) parts.push(`${u.new_ips.length} new IPs`);
  if (parts.length) return `Medium: ${parts.join('; ')}.`;
  return 'Low: no concurrency or sharing signals.';
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Active:   { bg: 'var(--green-dim)',     color: 'var(--green)' },
  Disabled: { bg: 'var(--surface-hover)', color: 'var(--text-dim)' },
  Expired:  { bg: 'var(--amber-dim)',     color: 'var(--amber)' },
};
const RISK_STYLE: Record<string, { bg: string; color: string }> = {
  High:   { bg: 'var(--red-dim)',   color: 'var(--red)' },
  Medium: { bg: 'var(--amber-dim)', color: 'var(--amber)' },
  Low:    { bg: 'var(--green-dim)', color: 'var(--green)' },
};

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: bg, color }}>
      {label}
    </span>
  );
}

type TabFilter = 'all' | 'active' | 'disabled' | 'expired';
const COL = 'minmax(160px,1.8fr) 76px minmax(120px,1.3fr) 92px 96px 116px 64px 34px';

type SortKey = 'name' | 'status' | 'protocols' | 'devices' | 'traffic' | 'lastSeen' | 'risk';
const STATUS_ORDER: Record<string, number> = { Active: 0, Disabled: 1, Expired: 2 };
const RISK_ORDER: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
const RISK_SEGS: Record<string, number> = { Low: 1, Medium: 3, High: 5 };

// ── Main component ────────────────────────────────────────────────────────────

export default function VpnUsersPageClient() {
  const { lang, setLang, t } = useI18n();
  const [stats, setStats]         = useState<StatsResponse | null>(null);
  const [search, setSearch]       = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [tabFilter, setTabFilter] = useState<TabFilter>('all');
  const [sortKey, setSortKey]     = useState<SortKey>('status');
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected]   = useState<UserStat | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Disabled' | 'Expired'>('all');
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [pageTab, setPageTab] = useState<'keys' | 'operators' | 'groups'>('keys');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [accounts, setAccounts] = useState<Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>[]>([]);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'> | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const isOwner = role === 'owner';
  const { statsSeq } = useGlobalSSE();

  // All groups (including ones that only exist on invite tokens) — same source the
  // invite dropdown uses, so both pages show an identical group list.
  const [groupNames, setGroupNames] = useState<string[]>([]);

  const load = useCallback(() => {
    fetchJson<StatsResponse>(apiUrl('/api/stats')).then(d => { if (d) setStats(d); }).catch(() => {});
    fetchJson<{ name: string }[]>(apiUrl('/api/groups'))
      .then(d => { if (Array.isArray(d)) setGroupNames(d.map(g => g.name)); })
      .catch(() => {});
  }, []);

  const loadAccounts = useCallback(() => {
    fetchJson<Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>[]>(apiUrl('/api/auth/accounts'))
      .then(d => { if (Array.isArray(d)) setAccounts(d); })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (statsSeq > 0) load(); }, [statsSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchJson<{ user: { role: AuthRole } | null }>(apiUrl('/api/auth/session'))
      .then(s => { const r = s?.user?.role ?? null; setRole(r); if (r === 'owner') loadAccounts(); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected || !stats) return;
    // Re-resolve the selected user by EMAIL, not uuid. uuid can be empty or
    // duplicated (clients without an id/password resolve to ''), and matching on
    // it made find() return the wrong user on refresh — which caused delete/edit
    // to hit the wrong key. Email is the unique, stable identifier.
    const updated = stats.active.find(u => u.email === selected.email);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (updated) setSelected(updated);
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(
    () => [...new Set([...(stats?.active.map(u => u.meta?.group ?? 'Ungrouped') ?? []), ...groupNames])].sort(),
    [stats, groupNames],
  );

  // Group → member list, for the Groups management tab. Includes empty groups that
  // exist only on invite tokens so the operator sees every group they've created.
  const groupSummary = useMemo(() => {
    const m = new Map<string, UserStat[]>();
    for (const name of groupNames) m.set(name, []);
    for (const u of stats?.active ?? []) {
      const g = u.meta?.group ?? 'Ungrouped';
      (m.get(g) ?? m.set(g, []).get(g)!).push(u);
    }
    return [...m.entries()]
      .map(([name, members]) => ({ name, members }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stats, groupNames]);

  const totalKeys      = stats?.active.length ?? 0;
  const activeKeys     = useMemo(() => stats?.active.filter(u => keyStatus(u) === 'Active').length ?? 0, [stats]);
  const pendingDevices = useMemo(() => stats?.active.reduce((n, u) => n + (u.devices?.pending_count ?? 0), 0) ?? 0, [stats]);
  const totalTraffic   = useMemo(() => stats?.active.reduce((n, u) => n + (u.traffic?.total ?? 0), 0) ?? 0, [stats]);
  const atRiskKeys     = useMemo(() => stats?.active.filter(u => u.expired || (keyStatus(u) === 'Active' && calcRisk(u) === 'High')).length ?? 0, [stats]);

  // Release the "at-risk only" filter once nothing is at risk anymore (e.g. the
  // operator blocked the offending IP) — otherwise the list is stuck showing
  // "No keys match this filter".
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (atRiskOnly && atRiskKeys === 0) setAtRiskOnly(false); }, [atRiskOnly, atRiskKeys]);

  const filtered = useMemo(() => {
    if (!stats) return [];
    let list = [...stats.active];
    if (tabFilter !== 'all') list = list.filter(u => keyStatus(u).toLowerCase() === tabFilter);
    if (statusFilter !== 'all') list = list.filter(u => keyStatus(u) === statusFilter);
    if (atRiskOnly) list = list.filter(u => u.expired || (keyStatus(u) === 'Active' && calcRisk(u) === 'High'));
    if (groupFilter) list = list.filter(u => (u.meta?.group ?? 'Ungrouped') === groupFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        (u.meta?.displayName ?? u.email).toLowerCase().includes(q) ||
        (u.meta?.group ?? '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
      );
    }
    const val = (u: UserStat): string | number => {
      switch (sortKey) {
        case 'name':      return (u.meta?.displayName ?? u.email).toLowerCase();
        case 'status':    return STATUS_ORDER[keyStatus(u)] ?? 9;
        case 'protocols': return u.meta?.protocols?.length ?? 0;
        case 'devices':   return u.devices?.approved_count ?? 0;
        case 'traffic':   return u.traffic?.total ?? 0;
        case 'lastSeen':  return u.last_seen ? new Date(u.last_seen).getTime() : 0;
        case 'risk':      return RISK_ORDER[calcRisk(u)] ?? 0;
      }
    };
    list.sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [stats, tabFilter, statusFilter, groupFilter, search, sortKey, sortDir, atRiskOnly]);

  const toggleSort = useCallback((k: SortKey) => {
    setSortKey(prev => { if (prev === k) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; } setSortDir('asc'); return k; });
  }, []);

  const tabCounts: Record<TabFilter, number> = useMemo(() => {
    if (!stats) return { all: 0, active: 0, disabled: 0, expired: 0 };
    return {
      all:      stats.active.length,
      active:   stats.active.filter(u => keyStatus(u) === 'Active').length,
      disabled: stats.active.filter(u => keyStatus(u) === 'Disabled').length,
      expired:  stats.active.filter(u => keyStatus(u) === 'Expired').length,
    };
  }, [stats]);

  const statusLabel = (s: 'Active'|'Disabled'|'Expired') =>
    s === 'Active' ? t('ak.statusActive') : s === 'Disabled' ? t('ak.statusDisabled') : t('ak.statusExpired');
  const riskLabel = (r: 'High'|'Medium'|'Low') =>
    r === 'High' ? t('ak.riskHigh') : r === 'Medium' ? t('ak.riskMedium') : t('ak.riskLow');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Main pane ── */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)', margin: 0, letterSpacing: -0.4 }}>{t('ak.pageTitle')}</h1>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '3px 0 0' }}>{t('ak.pageSubtitle')}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {pageTab === 'keys' && (
                <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                  {(['table', 'card'] as const).map(v => (
                    <button key={v} onClick={() => setViewMode(v)} title={v === 'table' ? 'Table view' : 'Card view'} style={{ border: 'none', background: viewMode === v ? 'var(--accent-dim)' : 'transparent', color: viewMode === v ? 'var(--accent)' : 'var(--text-faint)', padding: '5px 9px', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>
                      {v === 'table' ? '☰' : '⊞'}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                {(['en', 'ru', 'es', 'pt'] as const).map(c => (
                  <button key={c} onClick={() => setLang(c)} style={{ border: 'none', background: lang === c ? 'var(--accent)' : 'transparent', color: lang === c ? 'var(--bg)' : 'var(--text-dim)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{c}</button>
                ))}
              </div>
              {pageTab === 'groups' ? null : pageTab === 'operators' && isOwner ? (
                <button
                  onClick={() => { setSelectedAccount(null); setSelected(null); setShowNewAccount(true); }}
                  style={{ background: 'var(--surface)', color: 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 15px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  New System User
                </button>
              ) : (
                <button
                  onClick={() => { setSelected(null); setShowNewKey(true); }}
                  style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 7, padding: '8px 15px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {t('ak.newKey')}
                </button>
              )}
            </div>
          </div>

          {/* Page-level tab bar — only if owner */}
          {isOwner && (
            <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
              {(['keys', 'groups', 'operators'] as const).map(pt => (
                <button key={pt} onClick={() => { setPageTab(pt); setSelected(null); setSelectedAccount(null); setSelectedGroup(null); setShowNewKey(false); setShowNewAccount(false); }} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 700, padding: '8px 16px',
                  color: pageTab === pt ? 'var(--accent)' : 'var(--text-faint)',
                  borderBottom: pageTab === pt ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1, textTransform: 'uppercase', letterSpacing: 1,
                }}>
                  {pt === 'keys' ? `Access Keys (${totalKeys})` : pt === 'groups' ? `Groups (${groupSummary.length})` : `Operators (${accounts.length})`}
                </button>
              ))}
            </div>
          )}

          {/* Stats bar */}
          {pageTab === 'keys' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 8, marginBottom: 16 }}>
            <StatCard Icon={IconUsers} iconBg="rgba(0,180,255,0.15)" iconColor="#00b4ff"
              label={t('ak.statTotalKeys')} value={totalKeys} sub={t('ak.statTotalKeysSub')} />
            <StatCard Icon={IconCircleCheck} iconBg="rgba(34,200,120,0.15)" iconColor="#22c878"
              label={t('ak.statActiveKeys')} value={activeKeys}
              sub={t('ak.statActiveKeysSub', { pct: String(totalKeys ? Math.round(activeKeys / totalKeys * 100) : 0) })}
              valueColor="#22c878" />
            <StatCard Icon={IconClock} iconBg="rgba(255,170,50,0.15)" iconColor="#ffaa32"
              label={t('ak.statPendingDev')} value={pendingDevices} sub={t('ak.statPendingDevSub')}
              valueColor={pendingDevices > 0 ? '#ffaa32' : undefined} href="/devices" />
            <StatCard Icon={IconChartBar} iconBg="rgba(150,100,255,0.15)" iconColor="#9664ff"
              label={t('ak.statTraffic')} value={fmtBytes(totalTraffic)} sub={t('ak.statTrafficSub')} />
            <StatCard Icon={IconAlertTriangle} iconBg="rgba(255,70,70,0.15)" iconColor="#ff4646"
              label={t('ak.statAtRisk')} value={atRiskKeys}
              sub={atRiskKeys > 0 ? (atRiskOnly ? t('ak.statAtRiskClear') : t('ak.statAtRiskShow')) : t('ak.statAtRiskSub')}
              valueColor={atRiskKeys > 0 ? '#ff4646' : undefined}
              active={atRiskOnly}
              onClick={atRiskKeys > 0 ? () => setAtRiskOnly(v => !v) : undefined} />
          </div>}

          {pageTab === 'keys' && <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            {(['all', 'active', 'disabled', 'expired'] as TabFilter[]).map(tab => {
              const labels: Record<TabFilter, string> = {
                all: t('ak.tabAll'), active: t('ak.tabActive'),
                disabled: t('ak.tabDisabled'), expired: t('ak.tabExpired'),
              };
              const isActive = tabFilter === tab;
              return (
                <button key={tab} onClick={() => setTabFilter(tab)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600, padding: '8px 16px',
                  color: isActive ? 'var(--accent)' : 'var(--text-faint)',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}>
                  {labels[tab]} ({tabCounts[tab]})
                </button>
              );
            })}
          </div>}
        </div>

        {pageTab === 'keys' && <>
        {/* Filter toolbar */}
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, background: 'var(--bg)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('ak.filterSearch')}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 32px 7px 11px', color: 'var(--text-bright)', fontSize: 11, outline: 'none' }}
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          </div>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', color: groupFilter ? 'var(--text-bright)' : 'var(--text-dim)', fontSize: 11, outline: 'none', cursor: 'pointer' }}>
            <option value="">{t('ak.filterAllGroups')}</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', color: statusFilter !== 'all' ? 'var(--text-bright)' : 'var(--text-dim)', fontSize: 11, outline: 'none', cursor: 'pointer' }}>
            <option value="all">{t('ak.filterAllStatus')}</option>
            <option value="Active">{t('ak.statusActive')}</option>
            <option value="Disabled">{t('ak.statusDisabled')}</option>
            <option value="Expired">{t('ak.statusExpired')}</option>
          </select>
          {atRiskOnly && (
            <button onClick={() => setAtRiskOnly(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 7, padding: '6px 10px', color: 'var(--red)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {t('ak.atRiskFilterActive')} ✕
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
            {filtered.length} keys · {t('ak.sortedBy', { key: sortKey, dir: sortDir === 'asc' ? '↑' : '↓' })}
          </span>
        </div>

        {/* Table or Card view */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!stats ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>{t('ak.loading')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>{t('ak.noMatch')}</div>
          ) : viewMode === 'card' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, padding: '12px 16px' }}>
              {filtered.map(u => (
                <KeyCard key={u.email} stat={u} selected={selected?.email === u.email}
                  onClick={() => setSelected(s => s?.email === u.email ? null : u)}
                  statusLabel={statusLabel} riskLabel={riskLabel}
                  fmtLastSeen={(iso) => fmtLastSeen(iso, t)} tPending={t('ak.pending')}
                  tUnlimited={t('ak.unlimited')}
                />
              ))}
            </div>
          ) : (
            <>
              {/* Table header row */}
              <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 4, padding: '5px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 2 }}>
                {([
                  { h: t('ak.colKey'),       sub: t('ak.colKeySubhead'),    k: 'name'     as SortKey },
                  { h: t('ak.colStatus'),    sub: '',                        k: 'status'   as SortKey },
                  { h: t('ak.colProtocols'), sub: t('ak.colProtocolsSub'),  k: 'protocols' as SortKey },
                  { h: t('ak.colDevices'),   sub: t('ak.colDevicesSub'),    k: 'devices'  as SortKey },
                  { h: t('ak.colTraffic'),   sub: t('ak.colTrafficSub'),    k: 'traffic'  as SortKey },
                  { h: t('ak.colLastSeen'),  sub: '',                        k: 'lastSeen' as SortKey },
                  { h: t('ak.colRisk'),      sub: '',                        k: 'risk'     as SortKey },
                  { h: '',                   sub: '',                        k: null },
                ] as { h: string; sub: string; k: SortKey | null }[]).map(({ h, sub, k }, i) => {
                  const active = k && sortKey === k;
                  return (
                    <div key={i} onClick={k ? () => toggleSort(k) : undefined} style={{ cursor: k ? 'pointer' : 'default', userSelect: 'none' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text-faint)', letterSpacing: 0.6, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {h}{active && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                      {sub && <div style={{ fontSize: 8, color: 'var(--text-faint)', marginTop: 1 }}>{sub}</div>}
                    </div>
                  );
                })}
              </div>
              {filtered.map(u => (
                <KeyRow key={u.email} stat={u} selected={selected?.email === u.email}
                  onClick={() => setSelected(s => s?.email === u.email ? null : u)}
                  statusLabel={statusLabel} riskLabel={riskLabel}
                  fmtLastSeen={(iso) => fmtLastSeen(iso, t)} tPending={t('ak.pending')}
                  tUnlimited={t('ak.unlimited')}
                />
              ))}
            </>
          )}
        </div>

        <div style={{ padding: '6px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {t('ak.showing', { n: String(Math.min(filtered.length, 50)), total: String(filtered.length) })}
          </span>
        </div>
        </>}

        {/* ── Operators tab ── */}
        {pageTab === 'operators' && isOwner && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(0,212,255,0.15)', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>Local System Access</div>
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                These accounts log into this dashboard. They are separate from VPN keys. Roles: viewer · operator · admin · owner.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {accounts.map(acc => (
                <AccountRow key={acc.id} account={acc}
                  active={selectedAccount?.id === acc.id}
                  onClick={() => { setShowNewAccount(false); setSelectedAccount(a => a?.id === acc.id ? null : acc); }}
                />
              ))}
              {accounts.length === 0 && (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No system users yet.</div>
              )}
            </div>
          </div>
        )}

        {/* ── Groups tab ── */}
        {pageTab === 'groups' && isOwner && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(0,212,255,0.15)', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>Key Groups</div>
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                Groups bundle access keys (e.g. a family or a customer). Create a group by assigning it when you make a key. Rename a group to update every key in it; delete a group to move its keys back to Ungrouped.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {groupSummary.map(g => (
                <GroupRow key={g.name} name={g.name} count={g.members.length}
                  active={selectedGroup === g.name}
                  onClick={() => setSelectedGroup(s => s === g.name ? null : g.name)}
                />
              ))}
              {groupSummary.length === 0 && (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No groups yet.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Right panel ── */}
      {showNewAccount ? (
        <div style={{ width: 400, minWidth: 380, borderLeft: '1px solid var(--border)', background: 'var(--surface-sidebar)', overflowY: 'auto', flexShrink: 0, animation: 'slideIn 0.15s ease' }}>
          <NewAccountPanel onClose={() => setShowNewAccount(false)} onCreated={() => { loadAccounts(); setShowNewAccount(false); }} />
        </div>
      ) : selectedAccount ? (
        <div style={{ width: 400, minWidth: 380, borderLeft: '1px solid var(--border)', background: 'var(--surface-sidebar)', overflowY: 'auto', flexShrink: 0, animation: 'slideIn 0.15s ease' }}>
          <AccountPanel account={selectedAccount} onClose={() => setSelectedAccount(null)} onRefresh={() => { loadAccounts(); setSelectedAccount(null); }} />
        </div>
      ) : showNewKey ? (
        <div style={{ width: 480, minWidth: 460, borderLeft: '1px solid var(--border)', background: 'var(--surface-sidebar)', overflowY: 'auto', flexShrink: 0, animation: 'slideIn 0.15s ease' }}>
          <NewKeyPanel groups={groups} onClose={() => setShowNewKey(false)} onCreated={() => { load(); setShowNewKey(false); }} />
        </div>
      ) : selectedGroup ? (
        <div style={{ width: 400, minWidth: 380, borderLeft: '1px solid var(--border)', background: 'var(--surface-sidebar)', overflowY: 'auto', flexShrink: 0, animation: 'slideIn 0.15s ease' }}>
          <GroupPanel name={selectedGroup}
            members={groupSummary.find(g => g.name === selectedGroup)?.members ?? []}
            onClose={() => setSelectedGroup(null)}
            onRefresh={() => { load(); setSelectedGroup(null); }} />
        </div>
      ) : selected && (
        <div style={{ width: 480, minWidth: 460, borderLeft: '1px solid var(--border)', background: 'var(--surface-sidebar)', overflowY: 'hidden', display: 'flex', flexShrink: 0, animation: 'slideIn 0.15s ease' }}>
          <VpnUsersPanel stat={selected} onClose={() => setSelected(null)} onRefresh={load} allStats={stats?.active ?? []} />
        </div>
      )}

      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ Icon, iconBg, iconColor, label, value, sub, valueColor, href, onClick, active }: {
  Icon: React.ComponentType<{ size?: number; stroke?: number; style?: React.CSSProperties }>;
  iconBg: string; iconColor: string;
  label: string; value: string | number; sub: string; valueColor?: string;
  href?: string; onClick?: () => void; active?: boolean;
}) {
  const inner = (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, height: '100%', boxSizing: 'border-box', border: `1px solid ${active ? `${iconColor}99` : 'transparent'}`, transition: 'border-color 0.12s' }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={21} stroke={1.8} style={{ color: iconColor }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: valueColor ?? 'var(--text-bright)', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
    </div>
  );
  if (onClick) {
    return (
      <div role="button" tabIndex={0} onClick={onClick}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        style={{ cursor: 'pointer', display: 'block' }}
        onMouseEnter={e => { const d = e.currentTarget.firstElementChild as HTMLElement; if (d) d.style.borderColor = `${iconColor}55`; }}
        onMouseLeave={e => { const d = e.currentTarget.firstElementChild as HTMLElement; if (d) d.style.borderColor = active ? `${iconColor}99` : 'transparent'; }}
      >{inner}</div>
    );
  }
  if (!href) return inner;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={e => { const d = e.currentTarget.firstElementChild as HTMLElement; if (d) d.style.borderColor = `${iconColor}55`; }}
      onMouseLeave={e => { const d = e.currentTarget.firstElementChild as HTMLElement; if (d) d.style.borderColor = 'transparent'; }}
    >{inner}</Link>
  );
}

// ── Key row ───────────────────────────────────────────────────────────────────

function KeyRow({ stat, selected, onClick, statusLabel, riskLabel, fmtLastSeen, tPending, tUnlimited }: {
  stat: UserStat; selected: boolean; onClick: () => void;
  statusLabel: (s: 'Active'|'Disabled'|'Expired') => string;
  riskLabel: (r: 'High'|'Medium'|'Low') => string;
  fmtLastSeen: (iso: string | null) => string;
  tPending: string; tUnlimited: string;
}) {
  const name         = stat.meta?.displayName ?? stat.email;
  const group        = stat.meta?.group ?? 'Ungrouped';
  const gc           = groupColor(group);
  const protocols    = stat.meta?.protocols ?? [];
  const status       = keyStatus(stat);
  const risk         = calcRisk(stat);
  const ss           = STATUS_STYLE[status];
  const rs           = RISK_STYLE[risk];
  const ip           = stat.ips[0];
  const trafficBytes = stat.traffic?.total ?? 0;
  const limitGB      = stat.meta?.trafficLimitGB ?? 0;
  const limitBytes   = limitGB * 1e9;
  const pct          = limitBytes > 0 ? Math.min(100, Math.round(trafficBytes / limitBytes * 100)) : (trafficBytes > 0 ? 100 : 0);
  const barColor     = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--accent)';
  const pendingCount  = stat.devices?.pending_count ?? 0;
  const approvedCount = stat.devices?.approved_count ?? 0;
  const deviceLimit   = stat.devices?.limit ?? 0;

  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: COL, alignItems: 'center',
      padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)',
      cursor: 'pointer',
      background: selected ? 'var(--surface-active)' : 'transparent',
      borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
      gap: 4, transition: 'background 0.1s',
    }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Access Key */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
          {stat.meta?.isOwner && <span style={{ fontSize: 9, color: '#ffb347', marginRight: 4 }}>♛</span>}
          {name}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{stat.email.split('@')[0]}</span>
          <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${gc}20`, color: gc, whiteSpace: 'nowrap', flexShrink: 0 }}>{group}</span>
        </div>
      </div>

      {/* Status */}
      <div><Chip label={statusLabel(status)} bg={ss.bg} color={ss.color} /></div>

      {/* Protocols */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }} title={protocols.length ? protocols.map(protocolName).join(', ') : 'Default · VLESS Reality'}>
        {protocols.length === 0 ? (
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>—</span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {protocols.slice(0, 5).map(p => (
                <span key={p} style={{ width: 7, height: 7, borderRadius: '50%', background: protocolColor(p), flexShrink: 0 }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {protocols.length} proto{protocols.length > 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Devices */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-bright)', fontWeight: 600 }}>{approvedCount}/{deviceLimit || '∞'}</div>
        {pendingCount > 0
          ? <div style={{ fontSize: 9, color: 'var(--amber)', marginTop: 1 }}>{pendingCount} {tPending}</div>
          : <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>0 {tPending}</div>}
      </div>

      {/* Traffic */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-bright)', fontWeight: 600 }}>{fmtBytes(trafficBytes)}</div>
        <div style={{ fontSize: 9, color: limitGB ? 'var(--text-faint)' : 'var(--text-dim)', fontWeight: limitGB ? 400 : 600 }}>
          {limitGB ? `${limitGB} GB limit` : tUnlimited}
        </div>
        {limitGB > 0 && (
          <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', marginTop: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: barColor }} />
          </div>
        )}
      </div>

      {/* Last Seen */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-bright)' }}>{fmtLastSeen(stat.last_seen)}</div>
        {ip
          ? <div style={{ fontSize: 9, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: stat.status === 'online' ? 'var(--green)' : 'var(--text-faint)', display: 'inline-block', flexShrink: 0 }} />
              {ip.ip}
            </div>
          : <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>—</div>}
      </div>

      {/* Risk */}
      <div title={status === 'Active' ? riskReason(stat) : undefined} style={{ cursor: status === 'Active' ? 'help' : undefined }}>
        {status === 'Active' ? (
          <>
            <Chip label={riskLabel(risk)} bg={rs.bg} color={rs.color} />
            <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ width: 9, height: 3, borderRadius: 1, background: i < RISK_SEGS[risk] ? rs.color : 'var(--border)' }} />
              ))}
            </div>
          </>
        ) : <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>—</span>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 13, color: 'var(--text-faint)', cursor: 'pointer' }}>👁</span>
        <span style={{ fontSize: 13, color: 'var(--text-faint)', cursor: 'pointer' }}>⋯</span>
      </div>
    </div>
  );
}

// ── Key card (grid view) ──────────────────────────────────────────────────────

function KeyCard({ stat, selected, onClick, statusLabel, riskLabel, fmtLastSeen, tPending, tUnlimited }: {
  stat: UserStat; selected: boolean; onClick: () => void;
  statusLabel: (s: 'Active'|'Disabled'|'Expired') => string;
  riskLabel: (r: 'High'|'Medium'|'Low') => string;
  fmtLastSeen: (iso: string | null) => string;
  tPending: string; tUnlimited: string;
}) {
  const name         = stat.meta?.displayName ?? stat.email;
  const group        = stat.meta?.group ?? 'Ungrouped';
  const gc           = groupColor(group);
  const protocols    = stat.meta?.protocols ?? [];
  const status       = keyStatus(stat);
  const risk         = calcRisk(stat);
  const ss           = STATUS_STYLE[status];
  const rs           = RISK_STYLE[risk];
  const trafficBytes = stat.traffic?.total ?? 0;
  const limitGB      = stat.meta?.trafficLimitGB ?? 0;
  const limitBytes   = limitGB * 1e9;
  const pct          = limitBytes > 0 ? Math.min(100, Math.round(trafficBytes / limitBytes * 100)) : (trafficBytes > 0 ? 100 : 0);
  const barColor     = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--accent)';
  const pendingCount = stat.devices?.pending_count ?? 0;
  const approvedCount = stat.devices?.approved_count ?? 0;
  const deviceLimit  = stat.devices?.limit ?? 0;

  return (
    <div onClick={onClick} style={{
      background: selected ? 'var(--surface)' : 'var(--surface)',
      border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
      boxShadow: selected ? '0 0 0 1px var(--accent)' : 'none',
      transition: 'border-color 0.12s, box-shadow 0.12s',
    }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--text-faint)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
    >
      {/* Name + group */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
          {stat.meta?.isOwner && <span style={{ fontSize: 9, color: '#ffb347', marginRight: 4 }}>♛</span>}
          {name}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{stat.email.split('@')[0]}</span>
          <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${gc}20`, color: gc, flexShrink: 0 }}>{group}</span>
        </div>
      </div>
      {/* Status + Risk */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <Chip label={statusLabel(status)} bg={ss.bg} color={ss.color} />
        {status === 'Active' && <span title={riskReason(stat)} style={{ cursor: 'help' }}><Chip label={riskLabel(risk)} bg={rs.bg} color={rs.color} /></span>}
      </div>
      {/* Protocols */}
      {protocols.length > 0 && (
        <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
          {protocols.slice(0, 6).map(p => (
            <span key={p} style={{ width: 8, height: 8, borderRadius: '50%', background: protocolColor(p), flexShrink: 0 }} title={protocolName(p)} />
          ))}
          {protocols.length > 6 && <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>+{protocols.length - 6}</span>}
        </div>
      )}
      {/* Traffic bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-bright)' }}>{fmtBytes(trafficBytes)}</span>
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{limitGB ? `${limitGB} GB` : tUnlimited}</span>
        </div>
        {limitGB > 0 && (
          <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: barColor }} />
          </div>
        )}
      </div>
      {/* Devices + Last seen */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)' }}>
        <span>{approvedCount}/{deviceLimit || '∞'} devices{pendingCount > 0 ? ` · ${pendingCount} ${tPending}` : ''}</span>
        <span>{fmtLastSeen(stat.last_seen)}</span>
      </div>
    </div>
  );
}

// ── Group row + panel ─────────────────────────────────────────────────────────

function GroupRow({ name, count, active, onClick }: { name: string; count: number; active: boolean; onClick: () => void }) {
  const gc = groupColor(name);
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
      borderRadius: 8, cursor: 'pointer',
      background: active ? 'var(--accent-dim)' : 'transparent',
      border: `1px solid ${active ? 'rgba(0,212,255,0.2)' : 'transparent'}`,
    }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 3, background: gc, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{count} key{count !== 1 ? 's' : ''}</span>
    </div>
  );
}

function GroupPanel({ name, members, onClose, onRefresh }: { name: string; members: UserStat[]; onClose: () => void; onRefresh: () => void }) {
  const isUngrouped = name === 'Ungrouped';
  const [newName, setNewName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const gc = groupColor(name);

  async function save() {
    const next = newName.trim();
    if (!next || next === name) return;
    setSaving(true); setError('');
    const r = await fetch(apiUrl('/api/groups'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldName: name, newName: next }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Failed'); setSaving(false); }
    else onRefresh();
  }

  async function del() {
    if (!confirm(`Delete group "${name}"? Its ${members.length} key(s) will move to Ungrouped.`)) return;
    setDeleting(true); setError('');
    const r = await fetch(apiUrl(`/api/groups?name=${encodeURIComponent(name)}`), { method: 'DELETE' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Failed'); setDeleting(false); }
    else onRefresh();
  }

  const fieldStyle: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', color: 'var(--text-bright)', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 5, textTransform: 'uppercase', display: 'block' };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--accent)', textTransform: 'uppercase' }}>Group</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
      </div>
      <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--accent-dim)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: gc, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{members.length} key{members.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--red-dim)', color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      {isUngrouped ? (
        <div style={{ marginBottom: 16, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Ungrouped is the catch-all and can&apos;t be renamed or deleted. Assign these keys to a named group from each key&apos;s panel.
        </div>
      ) : (
        <>
          <label style={labelStyle}>Rename group</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} style={fieldStyle} />
          <button onClick={save} disabled={saving || !newName.trim() || newName.trim() === name} style={{ width: '100%', marginBottom: 8, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: (saving || !newName.trim() || newName.trim() === name) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Rename (updates all keys)'}
          </button>
          <button onClick={del} disabled={deleting} style={{ width: '100%', marginBottom: 16, background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,98,90,0.25)', borderRadius: 7, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {deleting ? 'Deleting…' : 'Delete group → keys to Ungrouped'}
          </button>
        </>
      )}

      <label style={labelStyle}>Keys in this group</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {members.map(u => (
          <div key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, background: 'var(--surface-hover)' }}>
            {u.meta?.isOwner && <span style={{ fontSize: 9, color: '#ffb347' }}>♛</span>}
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.meta?.displayName ?? u.email}</span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{u.email.split('@')[0]}</span>
          </div>
        ))}
        {members.length === 0 && <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 11 }}>No keys.</div>}
      </div>
    </div>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

const ROLE_COLOR: Record<AuthRole, string> = { viewer: '#b0ccee', operator: '#4e9eff', admin: '#b57bff', owner: '#ffb347' };

function AccountRow({ account, active, onClick }: { account: Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>; active: boolean; onClick: () => void }) {
  const rc = ROLE_COLOR[account.role as AuthRole] ?? '#b0ccee';
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
      borderRadius: 8, cursor: 'pointer',
      background: active ? 'var(--accent-dim)' : 'transparent',
      border: `1px solid ${active ? 'rgba(0,212,255,0.2)' : 'transparent'}`,
    }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid rgba(0,212,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
        {account.displayName[0]?.toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)' }}>{account.displayName}</div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>@{account.username}</div>
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: rc, background: `${rc}18`, border: `1px solid ${rc}33`, borderRadius: 3, padding: '2px 6px', textTransform: 'uppercase' }}>
        {account.role}
      </span>
      {account.disabled && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--red)', background: 'var(--red-dim)', padding: '2px 5px', borderRadius: 3 }}>DISABLED</span>}
    </div>
  );
}

// ── Account detail panel ──────────────────────────────────────────────────────

function AccountPanel({ account, onClose, onRefresh }: { account: Omit<AuthUserRecord, 'passwordHash' | 'passwordSalt'>; onClose: () => void; onRefresh: () => void }) {
  const [role, setRole] = useState<AuthRole>(account.role as AuthRole);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

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

  const fieldStyle: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', color: 'var(--text-bright)', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 5, textTransform: 'uppercase', display: 'block' };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--accent)', textTransform: 'uppercase' }}>System User</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
      </div>
      <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--accent-dim)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{account.displayName}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>@{account.username}</div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>Created {new Date(account.createdAt).toLocaleDateString()}</div>
      </div>
      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--red-dim)', color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      <label style={labelStyle}>Display name</label>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fieldStyle} />
      <label style={labelStyle}>Dashboard role</label>
      <select value={role} onChange={e => setRole(e.target.value as AuthRole)} style={{ ...fieldStyle, marginBottom: 14 }}>
        <option value="viewer">viewer — read-only</option>
        <option value="operator">operator — security + device actions</option>
        <option value="admin">admin — key/user mutation, backups</option>
        <option value="owner">owner — full access + account management</option>
      </select>
      <label style={labelStyle}>New password (leave blank to keep)</label>
      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••••" style={fieldStyle} />
      <button onClick={save} disabled={saving} style={{ width: '100%', marginBottom: 8, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      <button onClick={del} disabled={deleting} style={{ width: '100%', background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,98,90,0.25)', borderRadius: 7, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {deleting ? 'Deleting…' : 'Delete account'}
      </button>
    </div>
  );
}
