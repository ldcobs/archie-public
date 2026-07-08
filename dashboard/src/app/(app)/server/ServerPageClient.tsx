'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { Badge, Btn, KpiCard, MultiLineChart, Panel, PanelHeader } from '@/components/ui';
import { useI18n, type Lang } from '@/lib/i18n';
import type { ServiceRuntimeHealth, StatsResponse } from '@/lib/types';

function serviceTone(ok: boolean | null) {
  if (ok === null) return { bg: 'var(--surface-hover)', border: 'var(--border-subtle)', color: 'var(--text-dim)', label: 'Unknown' };
  if (ok)         return { bg: 'rgba(34,230,107,0.08)',  border: 'rgba(34,230,107,0.22)',  color: '#22e66b',              label: 'Running' };
  return              { bg: 'rgba(255,77,90,0.08)',   border: 'rgba(255,77,90,0.22)',   color: '#ff6b75',              label: 'Down'    };
}

const LOCALE_MAP: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', es: 'es-ES', pt: 'pt-BR' };

function formatServiceTimestamp(ts: string | null | undefined, lang: Lang) {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(LOCALE_MAP[lang] ?? 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Metric({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ?? 'var(--text-bright)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ServiceCard({
  name,
  service,
  note,
  lang,
  labels,
}: {
  name: string;
  service: ServiceRuntimeHealth | null | undefined;
  note: string;
  lang: Lang;
  labels: { running: string; down: string; unknown: string; uptime: string; lastRestart: string };
}) {
  const ok = service?.running ?? null;
  const t = serviceTone(ok);
  const statusLabel = ok === null ? labels.unknown : ok ? labels.running : labels.down;
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: t.bg, border: `1px solid ${t.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-bright)' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: t.color }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, display: 'inline-block', boxShadow: ok ? `0 0 6px ${t.color}` : 'none' }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase' }}>{statusLabel}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-dim)' }}>{note}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 3 }}>{labels.uptime}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#dce8f5' }}>{service?.uptime ?? '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 3 }}>{labels.lastRestart}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#dce8f5' }}>{formatServiceTimestamp(service?.last_restart, lang)}</div>
        </div>
      </div>
    </div>
  );
}

function CollapsePanel({ title, badge, defaultOpen = true, children }: { title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', borderBottom: open ? '1px solid var(--border-subtle)' : 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-dim)' }}>{title}</span>
          {badge}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
      </div>
      {open && children}
    </Panel>
  );
}

export default function ServerPageClient() {
  const { data, error, isLoading } = useSWR<StatsResponse>(
    apiUrl('/api/stats?threatWindow=7d'),
    fetchJson,
    { refreshInterval: 15_000, revalidateOnFocus: true, dedupingInterval: 1_000 },
  );
  const { data: protection } = useSWR<{ mode: 'temp-ban' | 'permanent-deny' }>(
    apiUrl('/api/security-mode'),
    fetchJson,
    { refreshInterval: 20_000 },
  );

  const { lang, setLang, t } = useI18n();
  const h = data?.server_health;
  const attacks24h = useMemo(() => (data?.ssh_hourly ?? []).reduce((s, b) => s + b.n, 0), [data]);
  const serviceLabels = {
    running: t('server.running'),
    down: t('server.down'),
    unknown: t('server.unknown'),
    uptime: t('server.uptimeLabel'),
    lastRestart: t('server.lastRestartLabel'),
  };

  const langToggle = (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
      {(['en', 'ru', 'es', 'pt'] as const).map(c => (
        <button key={c} onClick={e => { e.stopPropagation(); setLang(c); }} style={{ border: 'none', background: lang === c ? 'var(--accent)' : 'transparent', color: lang === c ? 'var(--bg)' : 'var(--text-dim)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{c}</button>
      ))}
    </div>
  );

  // Pending action items — derived from live data
  const actionItems = useMemo(() => {
    const items: { level: 'error' | 'warn' | 'info'; title: string; detail: string; href?: string }[] = [];
    if (h) {
      if (h.xray_running      === false) items.push({ level: 'error', title: 'Xray is not running',      detail: 'Core VPN engine is down — all tunnels are broken.',         href: '/inbounds' });
      if (h.hysteria2_running === false) items.push({ level: 'error', title: 'Hysteria2 is not running', detail: 'QUIC transport is offline. Check: systemctl status hysteria-server' });
      if (h.wg_running        === false) items.push({ level: 'error', title: 'WireGuard interface missing', detail: 'wg0 not detected. Check: systemctl status wg-quick@wg0' });
      // nginx only runs in domain modes (B/C) — cert_domain is only ever set
      // when a real cert was found, so it's a reliable signal that nginx is
      // actually expected to be running. IP-only installs (Mode A) never run
      // nginx by design; flagging it there is a false "error" alarm.
      if (h.nginx_running === false && h.cert_domain) items.push({ level: 'error', title: 'nginx is not running',     detail: 'Reverse proxy is down — WebSocket / gRPC inbounds unreachable.' });
      if (h.vpn_api_running   === false) items.push({ level: 'warn', title: 'vpn-api is not responding', detail: 'Restart, test, and host-level runtime checks will be unavailable until the Python control plane returns.' });
      if (h.disk_pct  >= 90) items.push({ level: 'error', title: `Disk critical (${h.disk_pct}%)`,   detail: `${h.disk_used_gb} GB used of ${h.disk_total_gb} GB. Free space immediately.` });
      if (h.disk_pct  >= 75 && h.disk_pct < 90) items.push({ level: 'warn', title: `Disk high (${h.disk_pct}%)`, detail: `${h.disk_used_gb} GB used of ${h.disk_total_gb} GB. Monitor closely.` });
      if (h.mem_pct   >= 90) items.push({ level: 'error', title: `Memory critical (${h.mem_pct}%)`,  detail: `${h.mem_used_mb} MB used of ${h.mem_total_mb} MB.` });
      if (h.mem_pct   >= 75 && h.mem_pct < 90) items.push({ level: 'warn', title: `Memory high (${h.mem_pct}%)`, detail: `${h.mem_used_mb} MB used of ${h.mem_total_mb} MB.` });
      if (h.load_1    >= 4)  items.push({ level: 'error', title: `CPU load critical (${h.load_1.toFixed(2)})`, detail: 'Load average above 4 — server may be struggling under traffic.' });
      if (h.load_1    >= 2 && h.load_1 < 4) items.push({ level: 'warn',  title: `CPU load high (${h.load_1.toFixed(2)})`, detail: 'Elevated load. Monitor if it persists.' });
      if (h.cert_expiry_days != null && h.cert_expiry_days <= 30) items.push({ level: h.cert_expiry_days <= 7 ? 'error' : 'warn', title: `TLS cert expires in ${h.cert_expiry_days}d`, detail: `Certificate for ${h.cert_domain ?? 'your domain'} needs renewal. Run: certbot renew` });
    }
    if (data) {
      const expiredKeys = data.active?.filter(u => u.expired) ?? [];
      if (expiredKeys.length > 0) items.push({ level: 'warn', title: `${expiredKeys.length} expired key${expiredKeys.length > 1 ? 's' : ''}`, detail: 'Expired keys still exist in config. Review or remove them.', href: '/keys' });
      const unblocked = data.ssh_threats?.filter(t => !t.banned && !t.perm_blocked && t.count >= 10) ?? [];
      if (unblocked.length > 0) items.push({ level: 'warn', title: `${unblocked.length} high-volume SSH attacker${unblocked.length > 1 ? 's' : ''} not banned`, detail: `${unblocked.length} IP${unblocked.length > 1 ? 's' : ''} with ≥10 attempts, not yet caught by fail2ban. Review and manually block in Security.`, href: '/security' });
    }
    return items;
  }, [h, data]);

  // Capacity estimate
  const cores  = h?.cpu_cores  ?? 0;
  const ramMb  = h?.mem_total_mb ?? 0;
  const cpuCap = cores * 25;
  const ramCap = Math.max(0, Math.floor((ramMb - 512) / 3));
  const cap    = cores && ramMb ? Math.min(cpuCap, ramCap) : 0;
  const capTier = cap >= 60 ? { label: 'High capacity · est.', color: '#22e66b' }
               : cap >= 25  ? { label: 'Medium · est.', color: '#ffb347' }
               :               { label: 'Light use · est.', color: '#b57bff' };

  return (
    <div style={{ padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: 'var(--accent)', textTransform: 'uppercase' }}>{t('server.title')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{t('server.subtitle')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {protection?.mode && <Badge variant={protection.mode === 'permanent-deny' ? 'alert' : 'ok'}>{protection.mode}</Badge>}
          {langToggle}
          <Btn variant="default" onClick={() => window.location.assign(apiUrl('/inbounds'))}>{t('server.xrayControls')}</Btn>
        </div>
      </div>

      {/* KPI row — 6 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10 }}>
        <KpiCard label={t('health.uptime')} sub="server up" value={h?.uptime ?? '—'} variant="accent" />
        <KpiCard label="CPU" sub={h ? `load ${h.load_1.toFixed(2)} · ${h.load_5.toFixed(2)} · ${h.load_15.toFixed(2)}` : '1m · 5m · 15m'}
          value={h ? `${Math.max(6, Math.min(100, Math.round((h.load_1 / (h.cpu_cores ?? 2)) * 100))).toFixed(0)}%` : '—'} variant="purple"
          delta={h ? (h.load_1 >= 4 ? t('health.critical') : h.load_1 >= 2 ? t('health.high') : t('health.normal')) : undefined}
          deltaDir={h ? (h.load_1 >= 2 ? 'up' : 'neutral') : 'neutral'} />
        <KpiCard label={t('health.memory')} sub={h ? `${h.mem_used_mb.toLocaleString()} / ${h.mem_total_mb.toLocaleString()} MB` : 'usage'}
          value={h ? `${h.mem_pct}%` : '—'} variant="green"
          delta={h ? (h.mem_pct >= 90 ? t('health.critical') : h.mem_pct >= 75 ? t('health.high') : 'ok') : undefined}
          deltaDir={h ? (h.mem_pct >= 75 ? 'up' : 'neutral') : 'neutral'} />
        <KpiCard label={t('health.disk')} sub={h ? `${h.disk_used_gb} / ${h.disk_total_gb} GB` : 'usage'}
          value={h ? `${h.disk_pct}%` : '—'} variant="amber"
          delta={h ? (h.disk_pct >= 90 ? t('health.critical') : h.disk_pct >= 75 ? t('health.high') : 'ok') : undefined}
          deltaDir={h ? (h.disk_pct >= 75 ? 'up' : 'neutral') : 'neutral'} />
        <KpiCard label="Network I/O"
          sub={h?.net_iface ? `via ${h.net_iface} · since boot` : 'since boot'}
          value={h?.net_rx_gb != null ? `${h.net_rx_gb}↓ ${h.net_tx_gb}↑` : '—'}
          variant="muted" />
        <KpiCard
          label="TLS Certificate"
          sub={h?.cert_domain ?? 'days to expiry'}
          value={h?.cert_expiry_days != null ? `${h.cert_expiry_days}d` : '—'}
          variant={h?.cert_expiry_days != null && h.cert_expiry_days <= 30 ? 'amber' : 'green'}
          delta={h?.cert_expiry_days != null ? (h.cert_expiry_days <= 7 ? 'critical' : h.cert_expiry_days <= 30 ? 'renew soon' : 'valid') : undefined}
          deltaDir={h?.cert_expiry_days != null && h.cert_expiry_days <= 30 ? 'up' : 'neutral'}
        />
      </div>

      {/* Pending actions */}
      {(actionItems.length > 0 || data) && (
        <CollapsePanel
          title="Action Required"
          defaultOpen={actionItems.length > 0}
          badge={
            actionItems.length > 0
              ? <span style={{ fontSize: 10, fontWeight: 800, color: actionItems.some(i => i.level === 'error') ? '#ff6b75' : '#ffb347', background: actionItems.some(i => i.level === 'error') ? 'rgba(255,77,90,0.12)' : 'rgba(255,179,71,0.12)', border: `1px solid ${actionItems.some(i => i.level === 'error') ? 'rgba(255,77,90,0.3)' : 'rgba(255,179,71,0.3)'}`, borderRadius: 4, padding: '1px 8px' }}>{actionItems.length} item{actionItems.length > 1 ? 's' : ''}</span>
              : <span style={{ fontSize: 10, fontWeight: 700, color: '#22e66b', background: 'rgba(34,230,107,0.08)', border: '1px solid rgba(34,230,107,0.2)', borderRadius: 4, padding: '1px 8px' }}>All clear</span>
          }
        >
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionItems.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(34,230,107,0.05)', border: '1px solid rgba(34,230,107,0.12)' }}>
                <span style={{ fontSize: 16 }}>✓</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22e66b' }}>No issues detected</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>All services running, resources within normal range.</div>
                </div>
              </div>
            ) : actionItems.map((item, i) => {
              const isErr = item.level === 'error';
              const color = isErr ? '#ff6b75' : '#ffb347';
              const bg    = isErr ? 'rgba(255,77,90,0.06)'  : 'rgba(255,179,71,0.06)';
              const bdr   = isErr ? 'rgba(255,77,90,0.2)'   : 'rgba(255,179,71,0.2)';
              const icon  = isErr ? '✕' : '⚠';
              const row = (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 8, background: bg, border: `1px solid ${bdr}`, cursor: item.href ? 'pointer' : 'default' }}
                  onClick={() => item.href && window.location.assign(apiUrl(item.href))}>
                  <span style={{ fontSize: 13, color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.45 }}>{item.detail}</div>
                  </div>
                  {item.href && <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0, marginTop: 2 }}>→</span>}
                </div>
              );
              return row;
            })}
          </div>
        </CollapsePanel>
      )}

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{t('server.sshAttacks')}</div>
          <MultiLineChart h={90} series={[{ id: 'ssh', label: t('server.attempts'), color: '#ff6b75', data: data?.ssh_hourly ?? [] }]} />
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{t('server.vpnTraffic')}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ color: '#00d4ff', label: t('server.connections') }, { color: '#bd93f9', label: t('server.uniqueIps') }].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 16, height: 2, borderRadius: 2, background: s.color }} />
                  <span style={{ fontSize: 8, color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <MultiLineChart h={90} legend={false} series={[
            { id: 'conns', label: t('server.connections'), color: '#00d4ff', data: data?.conns_hourly ?? [] },
            { id: 'ips',   label: t('server.uniqueIps'),  color: '#bd93f9', data: data?.unique_ips_hourly ?? [] },
          ]} />
        </div>
      </div>

      {/* VPS Capacity — collapsed by default */}
      {h && (
        <CollapsePanel title="VPS Capacity" defaultOpen={false} badge={cap > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: capTier.color, background: `${capTier.color}18`, border: `1px solid ${capTier.color}33`, borderRadius: 4, padding: '1px 8px' }}>{capTier.label}</span> : undefined}>
          <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
              <Metric label="CPU" value={h.cpu_cores ? `${h.cpu_cores} cores` : '—'} sub={h.cpu_model?.replace(/\(R\)|\(TM\)/gi, '') ?? ''} accent="#b57bff" />
              <Metric label="RAM" value={h.mem_total_mb ? `${(h.mem_total_mb / 1024).toFixed(1)} GB` : '—'} sub={`${Math.round(((h.mem_total_mb ?? 0) - (h.mem_used_mb ?? 0)) / 1024 * 10) / 10} GB free`} accent="#22e66b" />
              <Metric label="↓ Now" value={h.net_rx_mbps != null ? `${h.net_rx_mbps} Mbps` : '—'} sub={h.net_iface ?? 'live'} accent="#00d4ff" />
              <Metric label="↑ Now" value={h.net_tx_mbps != null ? `${h.net_tx_mbps} Mbps` : '—'} sub="live throughput" accent="#4e9eff" />
            </div>
            {cap > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>Estimated concurrent VPN clients</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {([
                    { label: 'Light', sub: 'browsing only', mult: 1.5 },
                    { label: 'Mixed', sub: 'browsing + streaming', mult: 1 },
                    { label: 'Heavy', sub: '4K / large transfers', mult: 0.4 },
                  ] as const).map(({ label, sub, mult }) => (
                    <div key={label} style={{ textAlign: 'center', background: 'var(--surface-active)', border: `1px solid ${capTier.color}22`, borderRadius: 10, padding: '18px 0' }}>
                      <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color: capTier.color }}>{Math.round(cap * mult)}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)', marginTop: 8 }}>{label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  {h.cpu_cores} vCPU · {(ramMb / 1024).toFixed(1)} GB RAM — port speed and devices-per-user are the real ceiling.
                </div>
              </div>
            )}
          </div>
        </CollapsePanel>
      )}

      {/* Service Health + Security Context side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, alignItems: 'start' }}>
        <CollapsePanel title={t('server.serviceHealth')} badge={<Badge variant={error ? 'alert' : 'ok'}>{error ? 'degraded' : 'live'}</Badge>}>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
            <ServiceCard name="Xray"      service={h?.xray_service}      note={t('server.xrayNote')} lang={lang} labels={serviceLabels} />
            <ServiceCard name="Hysteria2" service={h?.hysteria2_service} note={t('server.hysteria2Note')} lang={lang} labels={serviceLabels} />
            <ServiceCard name="WireGuard" service={h?.wg_service}        note={t('server.wgNote')} lang={lang} labels={serviceLabels} />
            <ServiceCard name="nginx"     service={h?.nginx_service}     note={t('server.nginxNote')} lang={lang} labels={serviceLabels} />
            <ServiceCard name="Dashboard" service={h?.dashboard_service} note={t('server.dashboardNote')} lang={lang} labels={serviceLabels} />
            <ServiceCard name="vpn-api"   service={h?.vpn_api_service}   note={t('server.vpnApiNote')} lang={lang} labels={serviceLabels} />
          </div>
        </CollapsePanel>

        <Panel>
          <PanelHeader title="Security Context" />
          <div style={{ padding: '8px 14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Protection Mode', value: protection?.mode ?? '—', sub: 'active policy', accent: protection?.mode === 'permanent-deny' ? '#ff4d5a' : '#22e66b' },
              { label: 'SSH Attempts (24h)', value: data ? attacks24h.toLocaleString() : '—', sub: data ? `${data.ssh_threats.length} tracked IPs` : '—', accent: '#ff9d42' },
              { label: 'Permanent Blocks', value: data ? String(data.perm_blocks.length) : '—', sub: 'IPs in deny list', accent: '#b57bff' },
              {
                label: 'TLS Certificate',
                value: h?.cert_expiry_days != null ? `${h.cert_expiry_days}d` : '—',
                sub: h?.cert_domain ? `${h.cert_domain} · expires in` : 'days until expiry',
                accent: h?.cert_expiry_days == null ? 'var(--text-faint)' : h.cert_expiry_days <= 7 ? '#ff9d42' : h.cert_expiry_days <= 30 ? '#ffcc44' : '#22e66b',
              },
            ].map(({ label, value, sub, accent }) => (
              <div key={label}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: accent, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {isLoading && <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>Refreshing…</div>}
    </div>
  );
}
