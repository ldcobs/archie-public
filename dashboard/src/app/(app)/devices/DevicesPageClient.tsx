'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import type { UserStat, StatsResponse, DeviceIpInfo, ConnFlow } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import {
  evaluatePosture, resolvePreset, PRESET_META, PRESET_ORDER,
  type PosturePreset, type PostureState, type ActiveNet, type PostureResult, type PostureStore, type Violation,
} from '@/lib/posture';

const fetcher = fetchJson;

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)}G`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)}M`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)}K`;
  return `${b}B`;
}
function fmtDur(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}
function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 0) return 'now';
  if (min < 2) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Provenance ("why is this IP here") ──────────────────────────────────────────
function sourceTag(source?: string): { label: string; color: string; bg: string; title: string } {
  switch (source) {
    case 'manual_approval':  return { label: 'vouched',     color: 'var(--accent)', bg: 'var(--accent-dim)', title: 'You manually approved this IP' };
    case 'known_ip_seed':    return { label: 'known',       color: 'var(--green)',  bg: 'var(--green-dim)',  title: 'Imported from this key’s known IP history when tracking started' };
    case 'auto_trusted_isp': return { label: 'trusted ISP', color: 'var(--accent)', bg: 'var(--accent-dim)', title: 'Auto-approved: same ISP as an already-approved IP' };
    case 'auto_registered':  return { label: 'auto',        color: 'var(--amber)',  bg: 'var(--amber-dim)',  title: 'Auto-registered on first sight, not yet verified' };
    default:                 return { label: source || '—', color: 'var(--text-faint)', bg: 'var(--surface-hover)', title: source || '' };
  }
}

// ── Network model — IPs grouped by ISP/network, enriched with activity ──────────
type IpStatus = 'approved' | 'pending' | 'blocked';
interface NetIp { ip: DeviceIpInfo; status: IpStatus; activeNow: boolean; }
interface Network {
  isp: string;
  flag: string;
  country: string;
  city: string;
  cidrs: string[];
  ips: NetIp[];
  activeNow: boolean;
  conflict: boolean;
  conns: number;
  lastActive: string | null;
  mobileLabel: 'mobile' | 'fixed' | 'mixed' | '';
  expected: 'yes' | 'no' | 'unknown';
  region: string;
  lat?: number;
  lon?: number;
  datacenter: boolean;
}

function ispLabel(ip: DeviceIpInfo): string {
  return (ip.isp && ip.isp.trim()) || ip.country || 'Unknown network';
}
function netHint(ip: string): string {
  const p = ip.split('.');
  return p.length >= 2 ? `${p[0]}.${p[1]}.x` : ip;
}
function ispExpected(isp: string, expected?: string[]): 'yes' | 'no' | 'unknown' {
  if (!expected || expected.length === 0) return 'unknown';
  const l = isp.toLowerCase();
  return expected.some((e) => { const x = e.toLowerCase(); return l.includes(x) || x.includes(l); }) ? 'yes' : 'no';
}

function buildNetworks(u: UserStat): Network[] {
  const activeIps = new Set(u.ips.map((x) => x.ip));
  const items: NetIp[] = [
    ...(u.devices.approved_info ?? []).map((ip) => ({ ip, status: 'approved' as const, activeNow: activeIps.has(ip.ip) })),
    ...(u.devices.pending_info  ?? []).map((ip) => ({ ip, status: 'pending'  as const, activeNow: activeIps.has(ip.ip) })),
    ...(u.devices.rejected_info ?? []).map((ip) => ({ ip, status: 'blocked'  as const, activeNow: false })),
  ];
  const seen = new Set(items.map((i) => i.ip.ip));
  for (const ip of u.ips) if (!seen.has(ip.ip)) { items.push({ ip, status: 'approved', activeNow: true }); seen.add(ip.ip); }

  const byIsp = new Map<string, NetIp[]>();
  for (const it of items) {
    const k = ispLabel(it.ip);
    if (!byIsp.has(k)) byIsp.set(k, []);
    byIsp.get(k)!.push(it);
  }

  const conflictSet = new Set(u.deviceEstimate?.conflictIsps ?? []);
  const nets: Network[] = [...byIsp.entries()].map(([isp, ips]) => {
    const rep = ips.find((i) => i.ip.flag)?.ip ?? ips[0].ip;
    const activeNow = ips.some((i) => i.activeNow);
    const conns = ips.reduce((s, i) => s + (i.ip.conns ?? 0), 0);
    const lastActive = ips.reduce<string | null>((acc, i) => {
      const t = i.ip.lastSeen;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    const mob = ips.filter((i) => i.ip.mobile).length;
    const mobileLabel: Network['mobileLabel'] = mob === 0 ? 'fixed' : mob === ips.length ? 'mobile' : 'mixed';
    return {
      isp,
      flag: rep.flag ?? '',
      country: rep.country ?? '',
      city: rep.city ?? '',
      cidrs: [...new Set(ips.map((i) => netHint(i.ip.ip)))].slice(0, 3),
      ips,
      activeNow,
      conflict: !!u.deviceEstimate?.ispConflict && activeNow && conflictSet.has(isp),
      conns,
      lastActive,
      mobileLabel,
      expected: ispExpected(isp, u.meta?.expectedIsps),
      region: rep.region ?? '',
      lat: typeof rep.lat === 'number' ? rep.lat : undefined,
      lon: typeof rep.lon === 'number' ? rep.lon : undefined,
      datacenter: ips.some((i) => i.ip.proxy || i.ip.hosting),
    };
  });
  nets.sort((a, b) =>
    (Number(b.conflict) - Number(a.conflict)) ||
    (Number(b.activeNow) - Number(a.activeNow)) ||
    (b.conns - a.conns) ||
    (b.ips.length - a.ips.length));
  return nets;
}

function liveNetCount(nets: Network[]): number {
  return nets.filter((n) => n.ips.some((i) => i.status !== 'blocked')).length;
}

async function actOnIps(email: string, ips: string[], action: 'approve' | 'reject') {
  await Promise.all(ips.map((ip) =>
    fetch(apiUrl(`/api/devices/${encodeURIComponent(email)}/${encodeURIComponent(ip)}/${action}`), { method: 'POST' }).catch(() => {})
  ));
}

// ── Small UI atoms ──────────────────────────────────────────────────────────────
function Chip({ text, color, bg, title }: { text: string; color: string; bg: string; title?: string }) {
  return (
    <span title={title} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, color, background: bg, border: `1px solid ${color}2e`, whiteSpace: 'nowrap' }}>{text}</span>
  );
}
function KB({ email, ips, onRefresh, size = 'sm' }: { email: string; ips: string[]; onRefresh: () => void; size?: 'sm' | 'xs' }) {
  const [busy, setBusy] = useState<'' | 'k' | 'b'>('');
  async function run(action: 'approve' | 'reject', which: 'k' | 'b') {
    setBusy(which);
    try { await actOnIps(email, ips, action); onRefresh(); } finally { setBusy(''); }
  }
  const pad = size === 'xs' ? '2px 7px' : '3px 9px';
  const fs = size === 'xs' ? 10 : 10;
  const mk = (label: string, color: string, on: () => void, active: boolean) => (
    <button onClick={(e) => { e.stopPropagation(); on(); }} disabled={!!busy}
      style={{ background: 'none', border: `1px solid ${color}55`, borderRadius: 6, color, fontSize: fs, fontWeight: 600, padding: pad, cursor: busy ? 'default' : 'pointer', opacity: busy && !active ? 0.4 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = `${color}18`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
    >{label}</button>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      {mk(busy === 'k' ? '…' : '✓ Keep', 'var(--green)', () => run('approve', 'k'), busy === 'k')}
      {mk(busy === 'b' ? '…' : '⛔ Block', 'var(--red)', () => run('reject', 'b'), busy === 'b')}
    </span>
  );
}
const chev = (open: boolean) => (
  <span style={{ width: 12, textAlign: 'center', color: 'var(--text-faint)', fontSize: 10, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▸</span>
);

// ── Connection flow log (Zeek vpn.log-style) ────────────────────────────────────
function fmtTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
const FLOW_GRID = '92px minmax(150px,1.1fr) 14px minmax(150px,1.4fr) 116px';
function FlowTable({ flows, proto, empty }: { flows: ConnFlow[]; proto: string; empty?: string }) {
  if (!flows.length) return <div style={{ padding: '8px 40px', fontSize: 11, color: 'var(--text-faint)' }}>{empty ?? 'No recent connections logged.'}</div>;
  return (
    <div style={{ background: 'var(--bg)', overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: FLOW_GRID, gap: 8, padding: '5px 14px 5px 40px', borderTop: '1px solid var(--border-subtle)', minWidth: 540 }}>
        <IpHeadCell>Time</IpHeadCell><IpHeadCell>Source ip:port</IpHeadCell><IpHeadCell> </IpHeadCell><IpHeadCell>Destination (sni)</IpHeadCell><IpHeadCell>Protocol</IpHeadCell>
      </div>
      {flows.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: FLOW_GRID, gap: 8, padding: '4px 14px 4px 40px', borderTop: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: 11, minWidth: 540 }}>
          <span style={{ color: 'var(--text-faint)' }}>{fmtTs(f.ts)}</span>
          <span style={{ color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.ip}:{f.sport}</span>
          <span style={{ color: 'var(--text-faint)' }}>→</span>
          <span style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${f.host}${f.dport ? ':' + f.dport : ''}`}>{f.host}{f.dport ? <span style={{ color: 'var(--text-faint)' }}>:{f.dport}</span> : null}</span>
          <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proto}</span>
        </div>
      ))}
    </div>
  );
}

// ── IP table (deepest expand) — dense, aligned, log-style ───────────────────────
const IP_GRID = '30px minmax(118px,1fr) minmax(120px,1.3fr) 52px 46px 92px 96px';
function IpHeadCell({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-faint)', textAlign: right ? 'right' : 'left' }}>{children}</div>;
}
function IpRow({ item, email, flows, proto, onRefresh }: { item: NetIp; email: string; flows: ConnFlow[]; proto: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const { ip, status, activeNow } = item;
  const st = sourceTag(ip.source);
  const blocked = status === 'blocked';
  const pending = status === 'pending';
  const ipFlows = flows.filter((f) => f.ip === ip.ip);
  return (
    <>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'grid', gridTemplateColumns: IP_GRID, gap: 8, alignItems: 'center', padding: '6px 14px 6px 40px', borderTop: '1px solid var(--border-subtle)', opacity: blocked ? 0.5 : 1, cursor: 'pointer', background: open ? 'var(--surface-hover)' : 'transparent' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeNow ? 'var(--green)' : pending ? 'var(--amber)' : 'var(--text-faint)', boxShadow: activeNow ? '0 0 5px var(--green)' : 'none' }} title={activeNow ? 'active now' : status} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: 'var(--text-faint)', marginRight: 4, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▸</span>{ip.ip}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[ip.city, ip.region, ip.country].filter(Boolean).join(', ')}>
          {[ip.city, ip.region, ip.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ') || '—'}
          <span style={{ color: (ip.proxy || ip.hosting) ? 'var(--red)' : ip.mobile ? 'var(--amber)' : 'var(--text-faint)', marginLeft: 5, fontWeight: (ip.proxy || ip.hosting) ? 700 : 400 }}>{(ip.proxy || ip.hosting) ? 'datacenter' : ip.mobile ? 'mobile' : 'fixed'}</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: (ip.conns ?? 0) > 0 ? 'var(--text-bright)' : 'var(--text-faint)', textAlign: 'right' }}>{ip.conns ?? 0}</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }} title={`first seen ${fmtAgo(ip.firstSeen)} · last ${fmtAgo(ip.lastSeen)}`}>{fmtAgo(ip.firstSeen)}</span>
        <span><Chip text={blocked ? 'blocked' : st.label} color={blocked ? 'var(--red)' : st.color} bg={blocked ? 'var(--red-dim)' : st.bg} title={st.title} /></span>
        <span style={{ textAlign: 'right' }}><KB email={email} ips={[ip.ip]} onRefresh={onRefresh} size="xs" /></span>
      </div>
      {open && <FlowTable flows={ipFlows} proto={proto} empty="No recent connections logged for this IP." />}
    </>
  );
}
function IpTable({ ips, email, flows, proto, onRefresh }: { ips: NetIp[]; email: string; flows: ConnFlow[]; proto: string; onRefresh: () => void }) {
  return (
    <div style={{ background: 'var(--bg)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: IP_GRID, gap: 8, alignItems: 'center', padding: '5px 14px 5px 40px', borderTop: '1px solid var(--border-subtle)' }}>
        <IpHeadCell> </IpHeadCell><IpHeadCell>Source IP</IpHeadCell><IpHeadCell>Location · type</IpHeadCell>
        <IpHeadCell right>Conns</IpHeadCell><IpHeadCell right>First</IpHeadCell><IpHeadCell>Why trusted</IpHeadCell><IpHeadCell right>Action</IpHeadCell>
      </div>
      {ips.map((item) => <IpRow key={`${item.status}-${item.ip.ip}`} item={item} email={email} flows={flows} proto={proto} onRefresh={onRefresh} />)}
      <div style={{ padding: '4px 14px 6px 40px', fontSize: 9, color: 'var(--text-faint)' }}>click an IP to see its connection flows</div>
    </div>
  );
}

// ── Network row ─────────────────────────────────────────────────────────────────
function NetworkRow({ net, email, flows, proto, onRefresh }: { net: Network; email: string; flows: ConnFlow[]; proto: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const p = net.ips.filter((i) => i.status === 'pending').length;
  const b = net.ips.filter((i) => i.status === 'blocked').length;
  const keepable = net.ips.filter((i) => i.status !== 'blocked').map((i) => i.ip.ip);

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: net.conflict ? 'var(--red-dim)' : 'transparent' }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', cursor: 'pointer' }}>
        {chev(open)}
        <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--surface-hover)', border: `1px solid ${net.conflict ? 'var(--red)' : 'var(--border)'}`, color: net.conflict ? 'var(--red)' : 'var(--text-dim)' }}>{net.flag} {net.country || '??'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {net.isp}
            {(net.city || net.region) ? <span style={{ color: 'var(--text-dim)' }}> · {[net.city, net.region].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}</span> : null}
            <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'monospace', color: 'var(--text-faint)' }}>{net.cidrs.join(' · ')}</span>
          </div>
          <div style={{ fontSize: 10, color: net.conflict ? 'var(--red)' : 'var(--text-dim)', marginTop: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>{net.ips.length} IP{net.ips.length === 1 ? '' : 's'}</span>
            <span>· {net.conns} conns</span>
            {net.mobileLabel && <span>· {net.mobileLabel}</span>}
            {net.datacenter && <span style={{ color: 'var(--red)', fontWeight: 700 }}>· datacenter/proxy</span>}
            <span>· {net.activeNow ? 'active now' : `last ${fmtAgo(net.lastActive)}`}</span>
            {net.expected === 'yes' && <span style={{ color: 'var(--green)' }}>· expected ISP</span>}
            {net.expected === 'no' && <span style={{ color: 'var(--red)', fontWeight: 700 }}>· not an expected ISP</span>}
            {p > 0 && <span style={{ color: 'var(--amber)' }}>· {p} pending</span>}
            {b > 0 && <span style={{ color: 'var(--text-faint)' }}>· {b} blocked</span>}
          </div>
        </div>
        {net.activeNow && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', flexShrink: 0 }} />}
        {keepable.length > 0 && <KB email={email} ips={keepable} onRefresh={onRefresh} />}
      </div>
      {open && <IpTable ips={net.ips} email={email} flows={flows} proto={proto} onRefresh={onRefresh} />}
    </div>
  );
}

// ── Key drill-down (networks ↔ flows) — the deep view, shared by review + in-posture ─
function KeyDrillDown({ u, onRefresh }: { u: UserStat; onRefresh: () => void }) {
  const [view, setView] = useState<'networks' | 'flows'>('networks');
  const nets = buildNetworks(u);
  const proto = u.vpnProtocol ? [u.vpnProtocol.protocol, u.vpnProtocol.security].filter(Boolean).join('-') : 'vpn';
  const flows = u.flows ?? [];
  const sessMin = u.sessions.reduce((s, x) => s + x.durMin, 0);
  const topDests = u.top_domains.slice(0, 3).map((d) => d.hostname || d.host).join(' · ');

  return (
    <div style={{ background: 'var(--bg)' }}>
      <div style={{ padding: '5px 12px 5px 24px', fontSize: 10, color: 'var(--text-faint)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-subtle)' }}>
        <span>key age <span style={{ color: 'var(--text-dim)' }}>{fmtAgo(u.first_seen)}</span></span>
        <span><span style={{ color: 'var(--text-dim)' }}>{u.conns_24h}</span> conns/24h · peak <span style={{ color: 'var(--text-dim)' }}>{u.deviceEstimate?.peakToday ?? 0}</span></span>
        <span><span style={{ color: 'var(--text-dim)' }}>{u.sessions.length}</span> sessions · {fmtDur(sessMin)}</span>
        {u.traffic && <span>↑<span style={{ color: 'var(--text-dim)' }}>{fmtBytes(u.traffic.up)}</span> ↓<span style={{ color: 'var(--text-dim)' }}>{fmtBytes(u.traffic.down)}</span></span>}
        {topDests && <span>top dest: <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{topDests}</span></span>}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['networks', 'flows'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ border: 'none', background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? 'var(--bg)' : 'var(--text-dim)', padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {v === 'networks' ? `Networks ${nets.length}` : `Flows ${flows.length}`}
            </button>
          ))}
        </div>
      </div>
      {view === 'flows'
        ? <FlowTable flows={flows} proto={proto} empty="No recent connections logged for this key." />
        : nets.length === 0
          ? <div style={{ padding: '8px 24px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>No devices seen.</div>
          : nets.map((net) => <NetworkRow key={net.isp} net={net} email={u.email} flows={flows} proto={proto} onRefresh={onRefresh} />)}
    </div>
  );
}

// ── Posture evaluation (auto-learned baseline from established networks) ─────────
const ESTABLISHED_SOURCES = new Set(['known_ip_seed', 'manual_approval', 'auto_trusted_isp']);
function evalKeyPosture(u: UserStat, preset: PosturePreset): PostureResult {
  const nets = buildNetworks(u);
  const baselineIsps = new Set<string>();
  const baselineCountries = new Set<string>();
  for (const d of u.devices.approved_info ?? []) {
    if (d.source && ESTABLISHED_SOURCES.has(d.source)) {
      baselineIsps.add(ispLabel(d));
      if (d.country) baselineCountries.add(d.country);
    }
  }
  const learning = baselineIsps.size === 0; // no locked baseline yet → don't flag new networks
  const activeNets: ActiveNet[] = nets.filter((n) => n.activeNow).map((n) => ({
    isp: n.isp,
    country: n.country,
    knownIsp: learning || baselineIsps.has(n.isp),
    knownCountry: learning || !n.country || baselineCountries.has(n.country),
    lat: n.lat,
    lon: n.lon,
    datacenter: n.datacenter,
  }));
  return evaluatePosture({
    preset,
    activeNets,
    trafficGB: u.traffic ? u.traffic.total / 1e9 : undefined,
    trafficCapGB: u.meta?.trafficLimitGB || undefined,
    ispConflict: !!u.deviceEstimate?.ispConflict,
    conflictIsps: u.deviceEstimate?.conflictIsps,
  });
}

const STATE_META: Record<PostureState, { label: string; color: string; bg: string }> = {
  out:    { label: 'out of posture', color: 'var(--red)',   bg: 'var(--red-dim)' },
  review: { label: 'needs review',   color: 'var(--amber)', bg: 'var(--amber-dim)' },
  in:     { label: 'in posture',     color: 'var(--green)', bg: 'var(--green-dim)' },
};
const VIOLATION_ICON: Record<Violation['rule'], string> = {
  max_networks: '⚂', impossible_travel: '🌐', new_isp: '🛜', geo: '📍', traffic: '📈', datacenter: '🖥', conflict: '⚠',
};

function PresetSelect({ email, preset, onChanged }: { email: string; preset: PosturePreset; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(p: PosturePreset) {
    if (p === preset) return;
    setBusy(true);
    try {
      await fetch(apiUrl('/api/posture'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, preset: p }) });
      onChanged();
    } finally { setBusy(false); }
  }
  return (
    <select value={preset} disabled={busy} onClick={(e) => e.stopPropagation()} onChange={(e) => pick(e.target.value as PosturePreset)}
      title={PRESET_META[preset].blurb}
      style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, padding: '3px 6px', fontFamily: 'inherit', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {PRESET_ORDER.map((p) => <option key={p} value={p}>{PRESET_META[p].label}</option>)}
    </select>
  );
}

// ── Group-level posture — "apply to the whole group" (clears per-key overrides) ──
function GroupPresetSelect({ group, emails, current, onChanged }: { group: string; emails: string[]; current?: PosturePreset; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(p: string) {
    if (!p) return;
    setBusy(true);
    try {
      await fetch(apiUrl('/api/posture'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, preset: p, clearKeys: emails }) });
      onChanged();
    } finally { setBusy(false); }
  }
  return (
    <select value={current ?? ''} disabled={busy} onClick={(e) => e.stopPropagation()} onChange={(e) => pick(e.target.value)}
      title="Apply one posture to every key in this group"
      style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-faint)', fontSize: 9, fontWeight: 700, padding: '2px 5px', fontFamily: 'inherit', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      <option value="">set all…</option>
      {PRESET_ORDER.map((p) => <option key={p} value={p}>{PRESET_META[p].label}</option>)}
    </select>
  );
}

// ── In-app help — what each posture includes (customer-readable) ─────────────────
function PostureHelp() {
  const cards: { p: PosturePreset; rules: string[] }[] = [
    { p: 'strict',   rules: ['1 network at a time', 'home country only', 'blocks new ISPs', 'blocks datacenter/proxy IPs'] },
    { p: 'balanced', rules: ['up to 2 networks at once', 'warns on a new ISP or country', 'ignores same-network churn', 'flags datacenter IPs for review'] },
    { p: 'open',     rules: ['no limits', 'nothing is flagged', '(use for your own / power keys)'] },
  ];
  const colorOf = (p: PosturePreset) => p === 'strict' ? 'var(--red)' : p === 'balanced' ? 'var(--accent)' : 'var(--text-faint)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14, background: 'var(--surface)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>What each posture does</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {cards.map(({ p, rules }) => (
          <div key={p} style={{ border: `1px solid ${colorOf(p)}55`, borderRadius: 6, padding: '8px 10px', background: 'var(--bg)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: colorOf(p), textTransform: 'uppercase', letterSpacing: 0.5 }}>{PRESET_META[p].label}{p === 'balanced' && <span style={{ fontSize: 8, color: 'var(--text-faint)', marginLeft: 5 }}>DEFAULT</span>}</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {rules.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 9, fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.6 }}>
        <span style={{ color: 'var(--red)' }}>⚠ Always on (every posture, even Open):</span> impossible travel (one key in two far-apart places at once) and a concurrent 2-ISP conflict. These always flag — and clear when you Keep or Block the networks involved.
        <br />Set a posture <b>per key</b> (the dropdown on each row) or <b>for a whole group</b> (the &quot;set all&quot; dropdown on the group header).
      </div>
    </div>
  );
}

// ── Review card — a key out of / needing review against its posture ─────────────
function ReviewCard({ u, preset, result, onRefresh }: { u: UserStat; preset: PosturePreset; result: PostureResult; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const nets = buildNetworks(u);
  const name = u.meta?.displayName ?? u.email;
  const sm = STATE_META[result.state];
  const offendIps = (isp: string) => (nets.find((n) => n.isp === isp)?.ips.filter((i) => i.status !== 'blocked').map((i) => i.ip.ip)) ?? [];

  return (
    <div style={{ border: `1px solid ${sm.color}`, borderRadius: 10, overflow: 'hidden', marginBottom: 8, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: sm.bg }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface)', color: sm.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{name.charAt(0).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{name}<span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>· {u.meta?.group ?? 'Ungrouped'}</span></div>
          <div style={{ fontSize: 9, color: sm.color, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{sm.label}</div>
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>posture</span>
        <PresetSelect email={u.email} preset={preset} onChanged={onRefresh} />
      </div>

      <div style={{ padding: '8px 12px' }}>
        {result.violations.map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
            <span style={{ fontSize: 13 }}>{VIOLATION_ICON[v.rule]}</span>
            <span style={{ flex: 1, fontSize: 12, color: v.severity === 'hard' ? 'var(--text-bright)' : 'var(--text-dim)' }}>{v.title}</span>
            {v.isp && offendIps(v.isp).length > 0 && <KB email={u.email} ips={offendIps(v.isp)} onRefresh={onRefresh} size="xs" />}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => setOpen((o) => !o)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>
            {open ? '▾ Hide details' : '▸ Investigate'}
          </button>
        </div>
      </div>
      {open && <KeyDrillDown u={u} onRefresh={onRefresh} />}
    </div>
  );
}

// ── In-posture row — quiet, collapsed, expandable to the drill-down ─────────────
function InPostureRow({ u, preset, onRefresh }: { u: UserStat; preset: PosturePreset; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const nets = buildNetworks(u);
  const name = u.meta?.displayName ?? u.email;
  const live = liveNetCount(nets);
  const countries = [...new Set(nets.filter((n) => n.activeNow).map((n) => n.country).filter(Boolean))].join(', ');

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
        {chev(open)}
        <span style={{ color: 'var(--green)', fontSize: 13 }}>✓</span>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{name.charAt(0).toUpperCase()}</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)', minWidth: 90 }}>{name}{u.meta?.isOwner && <span style={{ marginLeft: 5, fontSize: 8, color: 'var(--accent)', fontWeight: 800 }}>OWNER</span>}</span>
        <PresetSelect email={u.email} preset={preset} onChanged={onRefresh} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{live} network{live === 1 ? '' : 's'}{countries ? ` · ${countries}` : ''}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: u.status === 'online' ? 'var(--green)' : 'var(--text-faint)' }}>{u.status === 'online' ? '● online' : fmtAgo(u.last_seen)}</span>
      </div>
      {open && <KeyDrillDown u={u} onRefresh={onRefresh} />}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function DevicesPageClient() {
  const { t, lang, setLang } = useI18n();
  const { data, mutate } = useSWR<StatsResponse>(apiUrl('/api/stats'), fetcher, { refreshInterval: 30_000 });
  const { data: postureStore, mutate: mutatePosture } = useSWR<PostureStore>(apiUrl('/api/posture'), fetcher, { refreshInterval: 60_000 });
  const [search, setSearch] = useState('');
  const [inOpen, setInOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const onRefresh = useCallback(() => { mutate(); mutatePosture(); }, [mutate, mutatePosture]);

  const users: UserStat[] = data?.active ?? [];
  const filtered = search
    ? users.filter((u) =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.meta?.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (u.meta?.group ?? '').toLowerCase().includes(search.toLowerCase()))
    : users;

  // Evaluate every key against its resolved posture.
  const evaluated = filtered.map((u) => {
    const preset = resolvePreset(postureStore, u.email, u.meta?.group);
    return { u, preset, result: evalKeyPosture(u, preset) };
  });
  const order: Record<PostureState, number> = { out: 0, review: 1, in: 2 };
  const review = evaluated.filter((e) => e.result.state !== 'in').sort((a, b) => order[a.result.state] - order[b.result.state]);
  const inPosture = evaluated.filter((e) => e.result.state === 'in');

  // In-posture, grouped (group sections preserved per the owner's earlier ask).
  const byGroup = new Map<string, typeof inPosture>();
  for (const e of inPosture) {
    const g = e.u.meta?.group ?? 'Ungrouped';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(e);
  }
  const inGroups = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  const needCount = review.length;

  // All emails per group (both buckets) — so "set all" on a group header reaches every key.
  const groupEmails = new Map<string, string[]>();
  for (const e of evaluated) {
    const g = e.u.meta?.group ?? 'Ungrouped';
    if (!groupEmails.has(g)) groupEmails.set(g, []);
    groupEmails.get(g)!.push(e.u.email);
  }

  return (
    <div style={{ padding: '22px 26px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>● {t('sidebar.navDevices')} · posture</span>
          <div style={{ marginTop: 4, fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 500, color: 'var(--text-faint)' }}>
            {users.length} keys · <span style={{ color: 'var(--green)' }}>{inPosture.length} in posture</span>
            {needCount > 0 && <span style={{ color: 'var(--red)', marginLeft: 8 }}>· {needCount} need review</span>}
          </div>
          <div style={{ marginTop: 5 }}>
            <button onClick={() => setHelpOpen((o) => !o)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 10, fontWeight: 600, padding: '3px 9px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {helpOpen ? '▾ Hide posture help' : 'ⓘ What is a posture?'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="text" placeholder="search…" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-bright)', fontSize: 11, padding: '5px 10px', outline: 'none', width: 140, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            {(['en', 'ru', 'es', 'pt'] as const).map((choice) => (
              <button key={choice} onClick={() => setLang(choice)}
                style={{ border: 'none', background: lang === choice ? 'var(--accent)' : 'transparent', color: lang === choice ? 'var(--bg)' : 'var(--text-dim)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{choice}</button>
            ))}
          </div>
        </div>
      </header>

      {!data ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
      ) : (
        <>
          {helpOpen && <PostureHelp />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 10px' }}>
            <span style={{ color: needCount ? 'var(--red)' : 'var(--green)', fontSize: 14 }}>{needCount ? '⚠' : '✓'}</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: needCount ? 'var(--red)' : 'var(--green)' }}>
              {needCount ? `Needs review · ${needCount}` : 'All keys in posture'}
            </span>
          </div>
          {review.map((e) => <ReviewCard key={e.u.uuid} u={e.u} preset={e.preset} result={e.result} onRefresh={onRefresh} />)}

          {inPosture.length > 0 && (
            <div style={{ marginTop: 18, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div onClick={() => setInOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', background: 'var(--surface-hover)', cursor: 'pointer' }}>
                {chev(inOpen)}
                <span style={{ color: 'var(--green)', fontSize: 13 }}>✓</span>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--green)' }}>In posture · {inPosture.length}</span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>nothing to do — expand to browse</span>
              </div>
              {inOpen && inGroups.map(([group, es]) => (
                <div key={group}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--accent)' }}>{group} · {es.length}</span>
                    <span style={{ flex: 1 }} />
                    <GroupPresetSelect group={group} emails={groupEmails.get(group) ?? []} current={postureStore?.groups?.[group]} onChanged={onRefresh} />
                  </div>
                  {es.map((e) => <InPostureRow key={e.u.uuid} u={e.u} preset={e.preset} onRefresh={onRefresh} />)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
