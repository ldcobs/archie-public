'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import type { StatsResponse, UserStat } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { KpiCard, fmtKpi, MultiLineChart } from '@/components/ui';

type FastStatus = { users: { email: string; online: boolean }[]; ts: number };
type RowStatus = 'online' | 'recent' | 'offline';
const fetcher = fetchJson;

const PM: Record<string, { label: string; color: string }> = {
  'vless-reality':    { label: 'VLESS Reality', color: '#00d4ff' },
  'vmess-ws-tls':     { label: 'VMess WS',      color: '#5b8def' },
  'vmess-grpc-tls':   { label: 'VMess gRPC',    color: '#7c6ff5' },
  'vless-ws-tls':     { label: 'VLESS WS',      color: '#3fb8d4' },
  'vless-grpc-tls':   { label: 'VLESS gRPC',    color: '#9d6bd6' },
  'trojan-tls':       { label: 'Trojan TLS',    color: '#bd93f9' },
  'trojan-ws-tls':    { label: 'Trojan WS',     color: '#bd93f9' },
  'shadowsocks':      { label: 'SS',            color: '#f1c40f' },
  'hysteria2':        { label: 'Hysteria2',     color: '#22e66b' },
  'wireguard':        { label: 'WireGuard',     color: '#00c4a0' },
  'vless-xhttp-tls':  { label: 'VLESS XHTTP',  color: '#00e5cc' },
  'vmess-xhttp-tls':  { label: 'VMess XHTTP',  color: '#00bfae' },
  'vless-httpupgrade':{ label: 'VLESS HU',      color: '#4db8ff' },
  'vmess-httpupgrade':{ label: 'VMess HU',      color: '#3a9fd6' },
  'vless-mkcp':       { label: 'VLESS mKCP',    color: '#e06c75' },
  'vmess-mkcp':       { label: 'VMess mKCP',    color: '#c95f67' },
};

function fmtAgo(iso: string | null, t: (key: string) => string): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return t('time.now');
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function fmtBytes(b: number | undefined | null): string {
  if (!b) return '—';
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)}T`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)}G`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)}M`;
  if (b >= 1e3)  return `${(b / 1e3).toFixed(1)}K`;
  return `${b}B`;
}

function protocolList(u: UserStat): string[] {
  if (u.meta?.protocols?.length) return u.meta.protocols;
  const b = `${u.vpnProtocol?.protocol ?? ''}-${u.vpnProtocol?.network ?? ''}-${u.vpnProtocol?.security ?? ''}`;
  return b !== '--' ? [b] : [];
}

function keyLabel(u: UserStat): string {
  const name = u.meta?.displayName ?? u.email;
  const group = u.meta?.group;
  return group && group !== 'Ungrouped' ? `${group} - ${name}` : name;
}

function limitTone(active: number, limit: number, pending: number, blocked: number) {
  if (limit > 0 && active > limit) return 'var(--red)';
  if (pending > 0 || blocked > 0) return 'var(--amber)';
  if (active > 0) return 'var(--green)';
  return 'var(--text-faint)';
}

function MiniBarRow({
  label,
  value,
  sub,
  color,
  pct,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  pct: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 64px', gap: 10, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sub && <div style={{ fontSize: 8, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <div style={{ height: 10, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
        <div style={{ width: `${Math.max(4, Math.min(100, pct))}%`, height: '100%', borderRadius: 0, background: color }} />
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ── Grouped bar chart (2 series, 24 hourly buckets) ──────────────────────────
function GroupedBarChart({
  seriesA, seriesB, colorA, colorB, h = 100,
}: {
  seriesA: { h: number; n: number }[];
  seriesB: { h: number; n: number }[];
  colorA: string; colorB: string;
  labelA?: string; labelB?: string;
  h?: number;
}) {
  const buckets = Array.from({ length: 24 }, (_, i) => i);
  const mapA = Object.fromEntries(seriesA.map(b => [b.h, b.n]));
  const mapB = Object.fromEntries(seriesB.map(b => [b.h, b.n]));
  const maxVal = Math.max(...buckets.flatMap(i => [mapA[i] ?? 0, mapB[i] ?? 0]), 1);

  const BAR = 5, GAP = 1, GROUP = 14; // px
  const totalW = buckets.length * GROUP;
  const scaleY = (n: number) => Math.max(1, Math.round((n / maxVal) * (h - 8)));

  return (
    <svg viewBox={`0 0 ${totalW} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }}>
      {buckets.map(i => {
        const x = i * GROUP;
        const nA = mapA[i] ?? 0, nB = mapB[i] ?? 0;
        const hA = scaleY(nA), hB = scaleY(nB);
        return (
          <g key={i}>
            <rect x={x + 1}       y={h - hA} width={BAR} height={hA} fill={colorA} opacity={0.85} rx={1} />
            <rect x={x + 1 + BAR + GAP} y={h - hB} width={BAR} height={hB} fill={colorB} opacity={0.75} rx={1} />
          </g>
        );
      })}
      {/* Hour labels — every 6h */}
      {[0, 6, 12, 18, 23].map(i => (
        <text key={i} x={i * GROUP + GROUP / 2} y={h - 1} textAnchor="middle" fill="var(--axis-text-2)" fontSize={4}>{i}h</text>
      ))}
    </svg>
  );
}

// ── SVG donut ─────────────────────────────────────────────────────────────────
function Donut({ users }: { users: UserStat[] }) {
  const counts = new Map<string, number>();
  for (const u of users) for (const p of protocolList(u)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const total = [...counts.values()].reduce((s, n) => s + n, 0) || 1;
  const slices = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const R = 36, cx = 44, cy = 44, stroke = 14;
  const circ = 2 * Math.PI * R;
  type Arc = { key: string; color: string; dash: number; offset: number; pct: number; n: number };
  const arcs = slices.reduce<Arc[]>((acc, [key, n]) => {
    const prev = acc[acc.length - 1];
    const offset = prev ? prev.offset + prev.dash + 1 : 0;
    const pct = n / total;
    const dash = pct * circ;
    return [...acc, { key, color: PM[key]?.color ?? '#8fa8c2', dash, offset, pct, n }];
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={88} height={88} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--border-subtle)" strokeWidth={stroke} />
        {arcs.map(a => (
          <circle key={a.key} cx={cx} cy={cy} r={R} fill="none"
            stroke={a.color} strokeWidth={stroke}
            strokeDasharray={`${a.dash - 1} ${circ - a.dash + 1}`}
            strokeDashoffset={-a.offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-bright)" fontSize={16} fontWeight={800}>{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-faint)" fontSize={8}>users</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {arcs.map(a => (
          <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{PM[a.key]?.label ?? a.key}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', marginLeft: 'auto', paddingLeft: 4 }}>{a.n}</span>
          </div>
        ))}
        {slices.length === 0 && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>No data</span>}
      </div>
    </div>
  );
}


export default function ConnectionsPageClient() {
  const { lang, setLang, t } = useI18n();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RowStatus>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [tableOpen, setTableOpen] = useState(true);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const { data, isLoading, error } = useSWR<StatsResponse>(
    apiUrl('/api/stats?threatWindow=7d'), fetcher,
    { refreshInterval: 5_000, dedupingInterval: 1_000 },
  );
  const { data: fast } = useSWR<FastStatus>(
    apiUrl('/api/status'),
    (url: string) => fetch(`${url}?_t=${Date.now()}`).then(r => r.json()),
    { refreshInterval: 3_000, dedupingInterval: 1_000 },
  );

  const allUsers = useMemo(() => (data?.active ?? []).map(u => {
    const f = fast?.users?.find(x => x.email === u.email);
    if (!f) return u;
    if (f.online) return { ...u, online: true, status: 'online' as const };
    if (u.status === 'online') return { ...u, online: false, status: 'recent' as const };
    return u;
  }), [data?.active, fast?.users]);

  const rows = useMemo(() => allUsers.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    const g = u.meta?.group ?? 'Ungrouped';
    if (groupFilter !== 'all' && g !== groupFilter) return false;
    if (!deferredSearch) return true;
    return [u.email, u.meta?.displayName ?? '', g, ...(u.ips_24h ?? []).map(ip => ip.ip)]
      .join(' ').toLowerCase().includes(deferredSearch);
  }), [allUsers, deferredSearch, groupFilter, statusFilter]);

  // Derived stats
  const liveNow      = allUsers.filter(u => u.status === 'online').length;
  const recentCount  = allUsers.filter(u => u.status === 'recent').length;
  const conns24h     = allUsers.reduce((s, u) => s + u.conns_24h, 0);
  const uniqueIps    = new Set(allUsers.flatMap(u => (u.ips_24h ?? []).map(ip => ip.ip))).size;
  const totalUp      = allUsers.reduce((s, u) => s + (u.traffic?.up ?? 0), 0);
  const totalDown    = allUsers.reduce((s, u) => s + (u.traffic?.down ?? 0), 0);
  const reviewCount  = allUsers.filter(u => (u.devices?.pending_count ?? 0) > 0 || u.deviceEstimate?.ispConflict).length;
  const peakHour     = Math.max(...(data?.conns_hourly ?? []).map(b => b.n), 0);
  const groups       = data?.groups ?? [];

  // Deltas — unique IPs: compare last 12h vs first 12h of the hourly buckets
  const ipBuckets    = [...(data?.unique_ips_hourly ?? [])].sort((a, b) => a.h - b.h);
  const ipFirst12    = ipBuckets.slice(0, 12).reduce((s, b) => s + b.n, 0);
  const ipLast12     = ipBuckets.slice(12).reduce((s, b) => s + b.n, 0);
  const ipDelta      = ipLast12 - ipFirst12;
  const connTrend    = data?.conns_trend_pct ?? null;
  const trafficLeaders = [...allUsers]
    .sort((a, b) => (b.traffic?.total ?? 0) - (a.traffic?.total ?? 0))
    .slice(0, 5);
  const connectionLeaders = [...allUsers]
    .sort((a, b) => b.conns_24h - a.conns_24h)
    .slice(0, 5);

  if (isLoading) return <div style={{ padding: 32, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>;
  if (error || !data) return <div style={{ padding: 32, color: 'var(--red)', fontSize: 12 }}>Failed to load</div>;

  return (
    <div style={{ padding: '22px 26px' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>● {t('sidebar.navConnections')}</span>
          <div style={{ marginTop: 4, fontFamily: 'ui-monospace,monospace', fontSize: 11, color: 'var(--text-faint)' }}>
            {t('conn.pageSubtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--text-faint)', border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '3px 8px' }}>5s / 3s</span>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            {(['en', 'ru', 'es', 'pt'] as const).map(c => (
              <button key={c} onClick={() => setLang(c)} style={{ border: 'none', background: lang === c ? 'var(--accent)' : 'transparent', color: lang === c ? 'var(--bg)' : 'var(--text-dim)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{c}</button>
            ))}
          </div>
        </div>
      </header>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
        <KpiCard
          label="Online now"
          sub="Active users"
          value={fmtKpi(liveNow)}
          variant="green"
          delta={recentCount > 0 ? `${recentCount} recent` : undefined}
          deltaDir="neutral"
        />
        <KpiCard
          label="Connections 24h"
          sub={`peak ${fmtKpi(peakHour)}/h`}
          value={fmtKpi(conns24h)}
          variant="accent"
          delta={connTrend !== null ? `${connTrend > 0 ? '+' : ''}${connTrend.toFixed(1)}%` : undefined}
          deltaDir={connTrend === null ? 'neutral' : connTrend > 0 ? 'up' : 'down'}
        />
        <KpiCard
          label="Unique IPs"
          sub="24h window"
          value={fmtKpi(uniqueIps)}
          variant="accent"
          delta={ipFirst12 > 0 ? `${ipDelta > 0 ? '+' : ''}${ipDelta}` : undefined}
          deltaDir={ipDelta > 0 ? 'up' : ipDelta < 0 ? 'down' : 'neutral'}
        />
        <KpiCard
          label="Upload"
          sub="Cumulative"
          value={fmtBytes(totalUp)}
          variant="purple"
          delta=""
          deltaDir="up"
        />
        <KpiCard
          label="Download"
          sub="Cumulative"
          value={fmtBytes(totalDown)}
          variant="muted"
          delta=""
          deltaDir="down"
        />
        <Link href="/devices" style={{ textDecoration: 'none' }}>
          <KpiCard
            label="Review queue"
            sub="Pending / ISP conflict"
            value={fmtKpi(reviewCount)}
            variant="amber"
            delta={reviewCount > 0 ? 'needs review' : 'clear'}
            deltaDir={reviewCount > 0 ? 'up' : 'neutral'}
          />
        </Link>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 200px', gap: 10, marginBottom: 12 }}>
        {/* VPN activity — grouped bar chart (connections + unique IPs, 24h) */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{t('conn.vpnActivity')}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ color: '#00d4ff', label: t('conn.connections') }, { color: '#bd93f9', label: t('conn.uniqueIps') }].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  <span style={{ fontSize: 8, color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <GroupedBarChart
            seriesA={data.conns_hourly ?? []}
            seriesB={data.unique_ips_hourly ?? []}
            colorA="#00d4ff" colorB="#bd93f9"
            labelA={t('conn.connections')} labelB={t('conn.uniqueIps')}
            h={100}
          />
        </div>

        {/* SSH attacks chart */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{t('conn.sshAttacks')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 16, height: 2, borderRadius: 2, background: '#ff6b75' }} />
              <span style={{ fontSize: 8, color: 'var(--text-faint)', fontWeight: 600 }}>{t('conn.attempts')}</span>
            </div>
          </div>
          <MultiLineChart legend={false} h={100} series={[
            { id: 'ssh', label: t('conn.sshAttacks'), color: '#ff6b75', data: data.ssh_hourly ?? [] },
          ]} />
        </div>

        {/* Protocols donut */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>Protocols</div>
          <Donut users={allUsers} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>Top traffic consumers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {trafficLeaders.map((u) => (
              <MiniBarRow
                key={u.uuid}
                label={keyLabel(u)}
                sub={`${u.traffic ? `↑${fmtBytes(u.traffic.up)} ↓${fmtBytes(u.traffic.down)}` : 'No traffic'} · ${fmtAgo(u.last_seen, t)}`}
                value={fmtBytes(u.traffic?.total)}
                color="#bd93f9"
                pct={((u.traffic?.total ?? 0) / Math.max(...trafficLeaders.map((x) => x.traffic?.total ?? 0), 1)) * 100}
              />
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>Connection load by key</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {connectionLeaders.map((u) => {
              const pending = u.devices?.pending_count ?? 0;
              const blocked = u.devices?.rejected_count ?? 0;
              const approved = u.devices?.approved_count ?? 0;
              const tone = blocked > 0 ? 'var(--red)' : pending > 0 ? 'var(--amber)' : 'var(--green)';
              return (
                <MiniBarRow
                  key={u.uuid}
                  label={keyLabel(u)}
                  sub={`${approved} approved${pending > 0 ? ` · ${pending} pending` : ''}${blocked > 0 ? ` · ${blocked} blocked` : ''}`}
                  value={fmtKpi(u.conns_24h)}
                  color={tone}
                  pct={(u.conns_24h / Math.max(...connectionLeaders.map((x) => x.conns_24h), 1)) * 100}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)' }}>Connection inventory</div>
          </div>
          <button
            onClick={() => setTableOpen((v) => !v)}
            style={{ border: '1px solid var(--border)', background: 'var(--surface-hover)', borderRadius: 6, padding: '5px 9px', color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer' }}
          >
            {tableOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {tableOpen && (
          <>
        {/* Filters */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search key, name, IP…"
            style={{ flex: '1 1 160px', minWidth: 120, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-bright)', fontSize: 11, outline: 'none' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | RowStatus)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', color: 'var(--text-bright)', fontSize: 11 }}>
            <option value="all">All status</option>
            <option value="online">Online</option>
            <option value="recent">Recent</option>
            <option value="offline">Offline</option>
          </select>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', color: 'var(--text-bright)', fontSize: 11 }}>
            <option value="all">All groups</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>{rows.length} keys</span>
        </div>

        {/* Col headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) minmax(150px,1fr) minmax(180px,1.1fr) minmax(220px,1.35fr) 90px 94px 150px', gap: 10, padding: '6px 12px', fontSize: 8, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--text-faint)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>Key / identity</div><div>Protocols</div><div>Activity / limits</div><div>Live IPs / networks</div><div>Seen</div><div>Traffic</div><div>Devices / review</div>
        </div>

        {rows.length === 0
          ? <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-faint)' }}>No connections match filters.</div>
          : rows.map(u => {
            const protos = protocolList(u);
            const pending = u.devices?.pending_count ?? 0;
            const blocked = u.devices?.rejected_count ?? 0;
            const approved = u.devices?.approved_count ?? 0;
            const live = u.ips.length;
            const limit = u.meta?.connectionLimit ?? 0;
            const issue = u.deviceEstimate?.ispConflict || pending > 0 || (limit > 0 && live > limit);
            const sc = u.status === 'online' ? 'var(--green)' : u.status === 'recent' ? 'var(--amber)' : 'var(--text-faint)';
            const deviceTone = limitTone(live, limit, pending, blocked);
            const topDomain = u.top_domains?.[0]?.site ?? u.top_domains?.[0]?.hostname ?? u.top_domains?.[0]?.host ?? null;
            return (
              <div key={u.email} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) minmax(150px,1fr) minmax(180px,1.1fr) minmax(220px,1.35fr) 90px 94px 150px', gap: 10, padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc, boxShadow: u.status === 'online' ? `0 0 5px ${sc}` : 'none', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{keyLabel(u)}</span>
                    {u.meta?.isOwner && <span style={{ fontSize: 7, color: 'var(--accent)', border: '1px solid var(--accent-dim)', padding: '1px 3px', borderRadius: 999, flexShrink: 0 }}>OWNER</span>}
                    {u.meta?.disabled && <span style={{ fontSize: 7, color: 'var(--red)', border: '1px solid var(--red-dim)', padding: '1px 3px', borderRadius: 999, flexShrink: 0 }}>DISABLED</span>}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.uuid.slice(0, 8)} · {u.email}{u.meta?.detectedClient ? ` · ${u.meta.detectedClient}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {protos.length > 0 ? protos.map(k => {
                    const m = PM[k] ?? { label: k, color: '#8fa8c2' };
                    return <span key={k} style={{ fontSize: 8, fontWeight: 700, padding: '2px 4px', borderRadius: 3, background: `${m.color}18`, color: m.color }}>{m.label}</span>;
                  }) : <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>—</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-bright)', fontWeight: 700 }}>
                    {fmtKpi(u.conns_24h)} conns · {u.sessions.length} sessions
                  </div>
                  <div style={{ fontSize: 9, color: deviceTone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {live}{limit > 0 ? `/${limit}` : ''} live IPs{u.deviceEstimate?.ispConflict ? ' · ISP conflict' : ''}{u.expired ? ` · ${u.expiredReason}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(u.ips ?? []).length > 0 ? u.ips.slice(0, 2).map((ip, idx) => (
                    <div key={`${ip.ip}-${idx}`} title={`${ip.ip} · ${ip.label} · ${ip.isp || ''}`} style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 8, padding: '3px 6px', whiteSpace: 'nowrap', minWidth: 0 }}>
                      <div>{ip.flag} {ip.ip}</div>
                      <div style={{ fontSize: 8, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ip.isp || ip.label || 'Unknown'}</div>
                    </div>
                  )) : <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>—</span>}
                  {(u.ips ?? []).length > 2 && <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>+{u.ips.length - 2}</span>}
                  {topDomain && <span style={{ fontSize: 8, color: 'var(--text-faint)', width: '100%' }}>top: {topDomain}</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{fmtAgo(u.last_seen, t)}</div>
                <div style={{ fontSize: 10, color: '#bd93f9' }}>
                  {fmtBytes(u.traffic?.total)}
                  <div style={{ fontSize: 8, color: 'var(--text-faint)' }}>↑{fmtBytes(u.traffic?.up)} ↓{fmtBytes(u.traffic?.down)}</div>
                </div>
                <div style={{ fontSize: 9, color: issue ? 'var(--amber)' : deviceTone }}>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--green)' }}>{approved}✓</span>
                    {pending > 0 && <span style={{ color: 'var(--amber)' }}> {pending}?</span>}
                    {blocked > 0 && <span style={{ color: 'var(--red)' }}> {blocked}✗</span>}
                  </div>
                  <div style={{ color: 'var(--text-faint)' }}>
                    {limit > 0 ? `limit ${limit}` : 'no limit'}
                  </div>
                </div>
              </div>
            );
          })}

        <div style={{ padding: '6px 12px', fontSize: 9, color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
          TCP sockets + Xray log · 5s / 3s refresh
        </div>
          </>
        )}
      </div>
    </div>
  );
}
