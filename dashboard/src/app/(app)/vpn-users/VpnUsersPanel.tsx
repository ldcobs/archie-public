'use client';
import { useState, useEffect, useCallback } from 'react';
import { copyText } from '@/lib/clipboard';
import useSWR from 'swr';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import type { UserStat } from '@/lib/types';
import { protocolColor, protocolName } from '@/lib/protocol-catalog';
import { useI18n } from '@/lib/i18n';
import { PRESET_META, PRESET_ORDER, resolvePreset, type PosturePreset, type PostureStore } from '@/lib/posture';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
  if (b >= 1e9)  return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6)  return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtLastSeen(iso: string | null): string {
  if (!iso) return 'Never';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function keyStatus(u: UserStat): 'Active' | 'Disabled' | 'Expired' {
  if (u.meta?.disabled) return 'Disabled';
  if (u.expired)        return 'Expired';
  return 'Active';
}
// Balanced: High is reserved for concurrency (simultaneous 2+ ISPs = real sharing).
// A high distinct-IP count over a day is normal roaming, only a soft Medium signal.
// Keep in sync with calcRisk in VpnUsersPageClient.tsx.
function calcRisk(u: UserStat): 'High' | 'Medium' | 'Low' {
  if (u.deviceEstimate.ispConflict) return 'High';
  if ((u.devices?.pending_count ?? 0) > 0
    || u.deviceEstimate.sourceIps.length > 6
    || u.new_ips.length > 1) return 'Medium';
  return 'Low';
}
// Specific, human explanation of the current risk — used in the action banner.
// Keep in sync with riskReason in VpnUsersPageClient.tsx.
function riskReason(u: UserStat): string {
  const de = u.deviceEstimate;
  if (de.ispConflict) {
    const isps = de.conflictIsps.length ? ` (${de.conflictIsps.join(', ')})` : '';
    return `This key is active from ${de.conflictIsps.length || 2} different ISPs at the same time${isps} — a strong sign it is being shared across people or locations.`;
  }
  const parts: string[] = [];
  if ((u.devices?.pending_count ?? 0) > 0) parts.push(`${u.devices?.pending_count} device(s) pending approval`);
  if (de.sourceIps.length > 6) parts.push(`${de.sourceIps.length} IPs seen today (likely roaming, not necessarily shared)`);
  if (u.new_ips.length > 1) parts.push(`${u.new_ips.length} new IPs recently`);
  return parts.length ? parts.join('; ') + '.' : 'No concurrency or sharing signals.';
}
const RISK_SEGMENTS: Record<string, number> = { Low: 1, Medium: 3, High: 5 };
const RISK_COLOR:    Record<string, string>  = { Low: 'var(--green)', Medium: 'var(--amber)', High: 'var(--red)' };
const protoColor = protocolColor;

type PanelTab = 'overview' | 'access-keys' | 'devices' | 'limits' | 'traffic';
type SubFmt   = 'raw' | 'clash' | 'singbox';
type UriEntry = { protocol: string; label: string; uri: string };
type ModalId  = 'qr' | 'editlimits' | 'devices' | 'rotate' | 'delete' | 'reenable' | null;

// Block info returned by the disable route when a re-enable is refused (409).
interface BlockInfo {
  expired: boolean;
  overLimit: boolean;
  usedGB: number;
  limitGB: number | null;
  expiresAt: string | null;
}

const GROUP_PALETTE = ['#4e9eff','#22dd88','#b57bff','#ffb347','#ff7070','#57c7b8','#e8a838'];
function groupColor(name: string): string {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

const PROTO_PRESETS = [
  { id: 'standard',    label: 'Standard',    protocols: ['vless-reality'] },
  { id: 'compatible',  label: 'Compatible',  protocols: ['vless-reality', 'vmess-ws-tls'] },
  { id: 'universal',   label: 'Universal',   protocols: ['vless-reality', 'vmess-ws-tls', 'trojan-tls'] },
  { id: 'performance', label: 'Performance', protocols: ['vless-reality', 'hysteria2', 'wireguard'] },
  { id: 'cdn-safe',    label: 'CDN Safe',    protocols: ['vless-ws-tls', 'vless-grpc-tls'] },
  { id: 'legacy',      label: 'Legacy',      protocols: ['vmess-ws-tls', 'vmess-grpc-tls', 'shadowsocks'] },
];
const ALL_PROTOCOLS = [
  'vless-reality', 'vless-ws-tls', 'vless-grpc-tls', 'vless-xhttp-tls', 'vless-httpupgrade',
  'vmess-ws-tls', 'vmess-grpc-tls', 'trojan-tls', 'trojan-ws-tls', 'shadowsocks', 'hysteria2', 'wireguard',
].map(key => ({ key, label: protocolName(key) }));
function samePresetId(protos: string[]): string | null {
  const sorted = [...protos].sort().join(',');
  const p = PROTO_PRESETS.find(x => [...x.protocols].sort().join(',') === sorted);
  return p?.id ?? null;
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function ModalWrap({ onClose, title, children, width = 480 }: { onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid rgba(74,108,149,0.3)', borderRadius: 12, width, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <div style={{ padding: '16px 18px' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function VpnUsersPanel({ stat, onClose, onRefresh, allStats }: {
  stat: UserStat; onClose: () => void; onRefresh: () => void; allStats: UserStat[];
}) {
  const { t } = useI18n();
  const [tab, setTab]         = useState<PanelTab>('overview');
  const [modal, setModal]     = useState<ModalId>(null);
  const [uris, setUris]       = useState<UriEntry[]>([]);
  const [subUrl, setSubUrl]   = useState('');
  const [subFmt, setSubFmt]   = useState<SubFmt>('raw');
  const [copied, setCopied]   = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  // Re-enable (force-resolve) modal state
  const [blockInfo,    setBlockInfo]    = useState<BlockInfo | null>(null);
  const [resExpiry,    setResExpiry]    = useState('');
  const [resLimitGB,   setResLimitGB]   = useState('');
  const [resResetUsage, setResResetUsage] = useState(false);
  const [reEnableErr,  setReEnableErr]  = useState<string | null>(null);

  // Posture store — same SWR key as DevicesPageClient, shared cache
  const fetcher = (url: string) => fetch(url).then(r => r.json());
  const { data: postureStore, mutate: mutatePosture } = useSWR<PostureStore>(apiUrl('/api/posture'), fetcher, { refreshInterval: 60_000 });
  const currentPreset = resolvePreset(postureStore, stat.email, stat.meta?.group);
  const [postureSaving, setPostureSaving] = useState(false);

  const handleSavePosture = async (p: PosturePreset) => {
    if (p === currentPreset) return;
    setPostureSaving(true);
    await fetch(apiUrl('/api/posture'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: stat.email, preset: p }),
    }).catch(() => {});
    await mutatePosture();
    setPostureSaving(false);
  };

  // Edit limits state (hard resource caps only — behavior is owned by posture)
  const [limDevices,   setLimDevices]   = useState(String(stat.devices?.limit ?? 0));
  const [limTrafficGB, setLimTrafficGB] = useState(String(stat.meta?.trafficLimitGB ?? 0));
  const [limConcurrent, setLimConcurrent] = useState(String(stat.meta?.connectionLimit ?? 0));
  const [limExpiry,    setLimExpiry]    = useState(stat.meta?.expiresAt?.slice(0, 10) ?? '');
  const [limSaving,    setLimSaving]    = useState(false);
  const [limErr,       setLimErr]       = useState<string | null>(null);

  // Protocol editing (Access Keys tab)
  const [protos,      setProtos]      = useState<string[]>(stat.meta?.protocols?.length ? stat.meta.protocols : ['vless-reality']);
  const [protoSaving, setProtoSaving] = useState(false);
  const [protoSaved,  setProtoSaved]  = useState(false);

  const name    = stat.meta?.displayName ?? stat.email;
  const group   = stat.meta?.group ?? 'Ungrouped';
  const gc      = groupColor(group);
  const status  = keyStatus(stat);
  const risk    = calcRisk(stat);
  const meta    = stat.meta;

  const trafficBytes  = stat.traffic?.total ?? 0;
  const limitGB       = meta?.trafficLimitGB ?? 0;
  const limitBytes    = limitGB * 1e9;
  const trafficPct    = limitBytes > 0 ? Math.min(100, Math.round(trafficBytes / limitBytes * 100)) : (trafficBytes > 0 ? 100 : 0);
  const trafficBar    = trafficPct > 85 ? 'var(--red)' : trafficPct > 60 ? 'var(--amber)' : 'var(--accent)';
  const approvedCount = stat.devices?.approved_count ?? 0;
  const pendingCount  = stat.devices?.pending_count ?? 0;
  const deviceLimit   = stat.devices?.limit ?? 0;
  const dailyAvgGB    = trafficBytes > 0 ? (trafficBytes / 1e9 / 30) : 0;
  const assignedProtocols = meta?.protocols ?? [];
  const riskCol       = RISK_COLOR[risk];
  const riskSegs      = RISK_SEGMENTS[risk];
  const RISK_REASON   = { High: t('ak.riskReasonHigh'), Medium: t('ak.riskReasonMedium'), Low: t('ak.riskReasonLow') };

  const fullSubUrl = subFmt === 'raw' ? subUrl : `${subUrl}?format=${subFmt}`;

  const loadUris = useCallback(() => {
    fetchJson<{ uris: UriEntry[]; subUrl: string }>(apiUrl(`/api/keys/${stat.uuid}/uris`))
      .then(d => { if (d) { setUris(d.uris ?? []); setSubUrl(d.subUrl ?? ''); } })
      .catch(() => {});
  }, [stat.uuid]);

  useEffect(() => { loadUris(); }, [loadUris]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLimDevices(String(stat.devices?.limit ?? 0));
    setLimTrafficGB(String(stat.meta?.trafficLimitGB ?? 0));
    setLimConcurrent(String(stat.meta?.connectionLimit ?? 0));
    setLimExpiry(stat.meta?.expiresAt?.slice(0, 10) ?? '');
    setProtos(stat.meta?.protocols?.length ? stat.meta.protocols : ['vless-reality']);
  }, [stat]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const copy = useCallback((text: string) => {
    copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }, []);

  const doAction = useCallback(async (action: string, fn: () => Promise<void>) => {
    setWorking(action);
    try { await fn(); } catch {}
    setWorking(null);
  }, []);

  const postDisable = (payload: object) =>
    fetch(apiUrl(`/api/users/${encodeURIComponent(stat.email)}/disable`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const handleDisable = () => {
    const willDisable = status !== 'Disabled';

    if (willDisable) {
      if (!confirm(t('ak.disableConfirm', { name }))) return;
      doAction('disable', async () => {
        await postDisable({ disabled: true });
        onRefresh();
      });
      return;
    }

    // Re-enable: attempt a plain re-enable first. If the key is still
    // limit-blocked the backend refuses with 409 + the reason, and we open the
    // force-resolve modal instead of silently bouncing.
    doAction('disable', async () => {
      const res = await postDisable({ disabled: false });
      if (res.status === 409) {
        const info = await res.json() as BlockInfo;
        setBlockInfo(info);
        setReEnableErr(null);
        setResExpiry(stat.meta?.expiresAt?.slice(0, 10) ?? '');
        setResLimitGB(info.limitGB != null ? String(info.limitGB) : '');
        setResResetUsage(false);
        setModal('reenable');
        return;
      }
      onRefresh();
    });
  };

  const doReEnableResolve = () => doAction('disable', async () => {
    const resolution: Record<string, unknown> = {};
    if (blockInfo?.expired && resExpiry) resolution.newExpiresAt = new Date(resExpiry).toISOString();
    if (blockInfo?.overLimit) {
      if (resResetUsage) resolution.resetUsage = true;
      if (resLimitGB !== '') resolution.newLimitGB = Number(resLimitGB);
    }
    const res = await postDisable({ disabled: false, resolution });
    if (res.status === 409) {
      const info = await res.json() as BlockInfo & { error?: string };
      setBlockInfo(info);
      setReEnableErr(t('ak.reEnableInsufficient'));
      return;
    }
    setModal(null);
    setBlockInfo(null);
    onRefresh();
  });

  const handleDelete = () => setModal('delete');
  const doDelete = () => doAction('delete', async () => {
    await fetch(apiUrl(`/api/users/${encodeURIComponent(stat.email)}`), { method: 'DELETE' });
    setModal(null); onRefresh(); onClose();
  });

  const doRotate = () => doAction('rotate', async () => {
    await fetch(apiUrl(`/api/users/${encodeURIComponent(stat.email)}/rotate`), { method: 'POST' });
    setModal(null); loadUris(); onRefresh();
  });

  // Resend access: generate a fresh invite link bound to this existing user (e.g. they
  // lost the app or got a new device). The link opens straight onto their current setup
  // — it reads their live key/limits, so any config change is reflected automatically.
  const handleResendInvite = () => doAction('invite', async () => {
    const res = await fetch(apiUrl('/api/invite'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, displayName: name, boundEmail: stat.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token?.token) {
      const base = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
        ?? (typeof window !== 'undefined' ? window.location.origin + '/v3' : '/v3');
      copy(`${base}/invite/${data.token.token}`);
    }
  });

  const handleResetTraffic = () => {
    if (!confirm(t('ak.resetTrafficConfirm', { name }))) return;
    doAction('reset', async () => {
      await fetch(apiUrl(`/api/users/${encodeURIComponent(stat.email)}/traffic-reset`), { method: 'POST' });
      onRefresh();
    });
  };

  const handleSaveLimits = async () => {
    setLimSaving(true);
    setLimErr(null);
    try {
      const metaRes = await fetch(apiUrl(`/api/meta/${stat.uuid}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trafficLimitGB:  Number(limTrafficGB),
          connectionLimit: Number(limConcurrent),
          expiresAt:       limExpiry || null,
        }),
      });
      if (!metaRes.ok) {
        const detail = await metaRes.json().catch(() => ({}));
        throw new Error(detail.error ?? `Save failed (HTTP ${metaRes.status})`);
      }
      const devRes = await fetch(apiUrl(`/api/devices/${encodeURIComponent(stat.email)}/reset`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: Number(limDevices) }),
      });
      if (!devRes.ok) {
        const detail = await devRes.json().catch(() => ({}));
        throw new Error(detail.error ?? `Device limit save failed (HTTP ${devRes.status})`);
      }
      // Only close + refresh once we know the change actually persisted.
      setLimSaving(false);
      setModal(null);
      onRefresh();
    } catch (e) {
      setLimSaving(false);
      setLimErr(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const toggleProto = (key: string) => {
    setProtos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    setProtoSaved(false);
  };
  const applyPreset = (ids: string[]) => { setProtos([...ids]); setProtoSaved(false); };

  const handleSaveProtocols = async () => {
    if (protos.length === 0) return;
    setProtoSaving(true);
    await fetch(apiUrl(`/api/meta/${stat.uuid}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocols: protos }),
    }).catch(() => {});
    setProtoSaving(false);
    setProtoSaved(true);
    loadUris();
    onRefresh();
  };

  const handleDeviceAction = useCallback(async (ip: string, action: 'approve' | 'reject' | 'clear') => {
    await fetch(apiUrl(`/api/devices/${encodeURIComponent(stat.email)}/${encodeURIComponent(ip)}/${action}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }).catch(() => {});
    onRefresh();
  }, [stat.email, onRefresh]);

  // Posture preset display
  const presetMeta  = PRESET_META[currentPreset];
  const presetColor = currentPreset === 'strict' ? 'var(--red)' : currentPreset === 'open' ? 'var(--green)' : 'var(--amber)';

  const TABS: { key: PanelTab; label: string }[] = [
    { key: 'overview',    label: t('ak.tabOverview') },
    { key: 'access-keys', label: t('ak.tabAccessKeys') },
    { key: 'devices',     label: t('ak.tabDevices') },
    { key: 'limits',      label: t('ak.tabLimits') },
    { key: 'traffic',     label: t('ak.tabTraffic') },
  ];

  const statusLabel = status === 'Active' ? t('ak.statusActive') : status === 'Disabled' ? t('ak.statusDisabled') : t('ak.statusExpired');

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(120,80,220,0.2)', border: '2px solid rgba(120,80,220,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 22 }}>🔑</span>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)', flex: 1, letterSpacing: -0.3 }}>{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              border: `1.5px solid ${status === 'Active' ? 'var(--green)' : status === 'Expired' ? 'var(--amber)' : 'var(--text-faint)'}`,
              color: status === 'Active' ? 'var(--green)' : status === 'Expired' ? 'var(--amber)' : 'var(--text-dim)',
              background: 'transparent',
            }}>{statusLabel}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 4px' }}>×</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('ak.ownerLabel')} <strong style={{ color: 'var(--text-bright)' }}>{name}</strong></span>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('ak.groupLabel')}</span>
          <span style={{ padding: '2px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: `${gc}22`, color: gc, border: `1px solid ${gc}44` }}>{group}</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 10.5, fontWeight: 600, padding: '9px 11px', whiteSpace: 'nowrap',
            color: tab === key ? '#00d4ff' : 'var(--text-faint)',
            borderBottom: tab === key ? '2px solid #00d4ff' : '2px solid transparent',
            marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0, padding: '10px 12px' }}>

        {/* ═══ AT-RISK ACTION BANNER ═══ */}
        {status === 'Active' && risk === 'High' && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 9, padding: '11px 13px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--red)', letterSpacing: 0.2 }}>{t('ak.riskBannerTitle')}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45, marginBottom: 8 }}>{riskReason(stat)}</div>

            {/* Per-IP targeted action: block the network you don't recognise, keep the legit one online */}
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 7 }}>{t('ak.riskBannerPickIp')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {stat.ips.map(info => {
                const kept = (stat.devices?.approved_manual ?? []).includes(info.ip);
                return (
                <div key={info.ip} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px' }}>
                  <span style={{ fontSize: 13 }}>{info.flag}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)', fontFamily: 'monospace' }}>{info.ip}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.isp || '—'}{info.label ? ` · ${info.label}` : ''}</div>
                  </div>
                  {kept ? (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--green)', flexShrink: 0, padding: '5px 9px' }}>✓ {t('ak.riskKeptIp')}</span>
                  ) : (
                    <button onClick={() => handleDeviceAction(info.ip, 'approve')}
                      style={{ background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 6, padding: '5px 9px', fontSize: 10.5, fontWeight: 700, color: 'var(--green)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                      ✓ {t('ak.riskKeepIp')}
                    </button>
                  )}
                  <button onClick={() => handleDeviceAction(info.ip, 'reject')}
                    style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 6, padding: '5px 9px', fontSize: 10.5, fontWeight: 700, color: 'var(--red)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    ⛔ {t('ak.riskBlockIp')}
                  </button>
                </div>
                );
              })}
            </div>

            {/* Whole-key escalation — only if the key itself is compromised */}
            <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginBottom: 5 }}>{t('ak.riskBannerWholeKey')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setModal('rotate')}
                style={{ flex: '1 1 auto', background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 7, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--amber)', cursor: 'pointer', fontFamily: 'inherit' }}>
                ↻ {t('ak.riskActionRotate')}
              </button>
              <button onClick={handleDisable} disabled={working === 'disable'}
                style={{ flex: '1 1 auto', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 7, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--red)', cursor: working === 'disable' ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                ⏸ {t('ak.riskActionDisable')}
              </button>
            </div>
          </div>
        )}

        {/* ═══ OVERVIEW ═══ */}
        {tab === 'overview' && <>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 7, marginBottom: 7 }}>

            {/* Key Overview */}
            <Card>
              <CardLabel>{t('ak.keyOverview')}</CardLabel>
              <InfoRow label={t('common.status')}>
                <Chip label={statusLabel}
                  bg={status==='Active'?'var(--green-dim)':status==='Expired'?'var(--amber-dim)':'var(--surface-hover)'}
                  color={status==='Active'?'var(--green)':status==='Expired'?'var(--amber)':'var(--text-dim)'} />
              </InfoRow>
              <InfoRow label={t('ak.created')}>{fmtDate(meta?.createdAt)}</InfoRow>
              <InfoRow label={t('ak.lastSeenLabel')}>
                <div style={{ textAlign: 'right' }}>
                  <div>{fmtLastSeen(stat.last_seen)}</div>
                  {stat.ips[0] && <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>{stat.ips[0].ip}</div>}
                </div>
              </InfoRow>
              <InfoRow label={t('ak.protocolsLabel')}>
                {assignedProtocols.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end', maxWidth: 150 }}>
                    {assignedProtocols.map(p => (
                      <span key={p} style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: `${protoColor(p)}18`, color: protoColor(p), border: `1px solid ${protoColor(p)}33`, whiteSpace: 'nowrap' }}>
                        {protocolName(p)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>{t('ak.defaultProto')}</span>
                )}
              </InfoRow>
            </Card>

            {/* Subscription */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <CardLabel style={{ marginBottom: 0 }}>{t('ak.subscription')}</CardLabel>
                <button onClick={() => copy(fullSubUrl)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: copied ? 'var(--green)' : 'var(--text-dim)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                  <span>{copied ? '✓' : '⧉'}</span> {copied ? t('ak.copied') : t('ak.copy')}
                </button>
              </div>
              {subUrl && (
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-dim)', background: 'var(--surface)', borderRadius: 5, padding: '6px 8px', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => copy(fullSubUrl)} title={fullSubUrl}>
                  {fullSubUrl}
                </div>
              )}
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 4 }}>{t('ak.format')}</div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 7 }}>
                {(['raw','clash','singbox'] as SubFmt[]).map(f => (
                  <SubBtn key={f} label={f === 'singbox' ? 'SingBox' : f === 'clash' ? 'Clash' : 'Raw'} active={subFmt === f} onClick={() => setSubFmt(f)} />
                ))}
              </div>
              <button onClick={() => setModal('qr')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, width: '100%', padding: '6px 0', background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', borderRadius: 5, cursor: 'pointer', color: 'var(--accent)', fontSize: 10, fontWeight: 700, fontFamily: 'inherit', marginBottom: 7 }}>
                ⊞ {t('ak.showQr')} ({subFmt === 'singbox' ? 'SingBox' : subFmt === 'clash' ? 'Clash' : 'Raw'})
              </button>
              <div style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>{t('ak.universalLink')}</div>
            </Card>
          </div>

          {/* Row 2: Traffic + Devices + Risk */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 7, marginBottom: 7 }}>

            <Card>
              <CardLabel>{t('ak.trafficUsed')}</CardLabel>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1, marginBottom: 3 }}>{fmtBytes(trafficBytes)}</div>
              <div style={{ fontSize: 10, color: limitGB ? 'var(--text-dim)' : '#00d4ff', marginBottom: 6, fontWeight: limitGB ? 600 : 800 }}>{limitGB ? `${limitGB} GB limit` : t('ak.unlimited')}</div>
              {limitGB > 0 && (
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', borderRadius: 2, width: `${trafficPct}%`, background: trafficBar }} />
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{t('ak.sinceLabel')} {fmtShortDate(meta?.createdAt)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{t('ak.dailyAvg')} {dailyAvgGB.toFixed(1)} GB</div>
            </Card>

            <Card>
              <CardLabel>{t('ak.devicesLabel')}</CardLabel>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, marginBottom: 3 }}>
                <span style={{ color: approvedCount > 0 ? 'var(--green)' : 'var(--text-bright)' }}>{approvedCount}</span>
                <span style={{ color: 'var(--text-bright)' }}> / {deviceLimit || '∞'}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>{t('ak.approvedLimit')}</div>
              {pendingCount > 0
                ? <>
                    <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6, fontWeight: 600 }}>{t('ak.pendingReview', { n: String(pendingCount) })}</div>
                    <button onClick={() => setModal('devices')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 10, fontWeight: 600, padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>{t('ak.reviewDevices')}</button>
                  </>
                : <div style={{ fontSize: 10, color: 'var(--green)' }}>{t('ak.allApproved')}</div>}
            </Card>

            <Card>
              <CardLabel>{t('ak.sharingRisk')}</CardLabel>
              <div style={{ fontSize: 20, fontWeight: 800, color: riskCol, lineHeight: 1, marginBottom: 4 }}>
                {risk === 'High' ? t('ak.riskHigh') : risk === 'Medium' ? t('ak.riskMedium') : t('ak.riskLow')}
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < riskSegs ? riskCol : 'var(--border)' }} />
                ))}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginBottom: 6 }}>{RISK_REASON[risk]}</div>
              <button onClick={() => setTab('limits')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 10, fontWeight: 600, padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>{t('ak.viewDetails')}</button>
            </Card>
          </div>

          {/* Limits & Posture Summary */}
          <Card style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-bright)' }}>{t('ak.limitsSummary')}</span>
              <button onClick={() => setModal('editlimits')} style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.editLimits')}</button>
            </div>
            {/* Posture row — full width, visually distinct */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: 'var(--surface-hover)', border: '1px solid var(--border-subtle)', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>Security posture</span>
              <span style={{ padding: '2px 10px', borderRadius: 5, fontSize: 11, fontWeight: 800, background: `${presetColor}18`, color: presetColor, border: `1px solid ${presetColor}44` }}>{presetMeta.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', flex: 1 }}>{presetMeta.blurb}</span>
              <button onClick={() => setTab('limits')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 10, fontWeight: 600, padding: 0, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Change →</button>
            </div>
            {/* Hard resource limits grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '8px 8px' }}>
              <SummaryCell label={t('ak.limDeviceLimit')} value={deviceLimit ? `${deviceLimit} devices` : t('ak.unlimited')} />
              <SummaryCell label="Max networks" value={meta?.connectionLimit ? String(meta.connectionLimit) : t('ak.unlimited')} />
              <SummaryCell label={t('ak.limTraffic')} value={limitGB ? `${limitGB} GB` : t('ak.unlimited')} />
              <SummaryCell label={t('ak.limExpiry')} value={meta?.expiresAt ? new Date(meta.expiresAt).toLocaleDateString() : 'Never'} />
            </div>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardLabel>{t('ak.quickActions')}</CardLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 7 }}>
              <ActionBtn icon="⧉"  label={t('ak.copySubscription')} onClick={() => copy(fullSubUrl)} active={copied} />
              <ActionBtn icon="⊞"  label={t('ak.showQr')}           onClick={() => setModal('qr')} />
              <ActionBtn icon="↻"  label={t('ak.rotateKey')}        color="#ffaa32" onClick={() => setModal('rotate')} />
              <ActionBtn icon="✉"  label={working === 'invite' ? 'Generating…' : 'Resend invite'} onClick={handleResendInvite} loading={working === 'invite'} />
              <ActionBtn icon="⏸"  label={status === 'Disabled' ? t('ak.reEnableKey') : t('ak.disableKey')} onClick={handleDisable} loading={working === 'disable'} />
              <ActionBtn icon="↺"  label={t('ak.resetTraffic')}     onClick={handleResetTraffic} loading={working === 'reset'} />
              <ActionBtn icon="🗑" label={t('ak.deleteKey')}         color="#ff5555" onClick={handleDelete} loading={working === 'delete'} />
            </div>
          </Card>
        </>}

        {/* ═══ DEVICES tab ═══ */}
        {tab === 'devices' && (
          <DevicesContent stat={stat} onAction={handleDeviceAction} t={t} />
        )}

        {/* ═══ LIMITS tab ═══ */}
        {tab === 'limits' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{t('ak.tabLimits')}</span>
              <button onClick={() => setModal('editlimits')} style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 700, color: 'var(--bg)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.editLimits')}</button>
            </div>

            {/* ── Security Posture section ── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Security posture</div>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-hover)', border: `1px solid ${presetColor}44` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: presetColor }}>{presetMeta.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{presetMeta.blurb}</span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {PRESET_ORDER.map(p => {
                    const col = p === 'strict' ? 'var(--red)' : p === 'open' ? 'var(--green)' : 'var(--amber)';
                    const on = p === currentPreset;
                    return (
                      <button key={p} onClick={() => handleSavePosture(p)} disabled={postureSaving}
                        style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: `1.5px solid ${on ? col : 'var(--border)'}`, background: on ? `${col}1a` : 'var(--surface)', color: on ? col : 'var(--text-dim)', fontSize: 11, fontWeight: 700, cursor: postureSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        {PRESET_META[p].label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 9.5, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  Posture controls how Archie reacts when this key connects from a new location or ISP.
                  It also drives the <strong style={{ color: 'var(--text-dim)' }}>Devices page</strong> for this key.
                </div>
              </div>
            </div>

            {/* ── Hard resource limits section ── */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Resource limits</div>
              <div style={{ display: 'grid', gap: 6 }}>
                <LimitRow label={t('ak.limDeviceLimit')}   value={deviceLimit ? `${deviceLimit} devices` : t('ak.unlimited')} />
                <LimitRow label="Max concurrent networks"  value={meta?.connectionLimit ? String(meta.connectionLimit) : t('ak.unlimited')} />
                <LimitRow label={t('ak.limTraffic')}       value={limitGB ? `${limitGB} GB` : t('ak.unlimited')} />
                <LimitRow label={t('ak.limExpiry')}        value={meta?.expiresAt ? new Date(meta.expiresAt).toLocaleDateString() : 'Never'} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ ACCESS KEYS tab ═══ */}
        {tab === 'access-keys' && (() => {
          const activePreset = samePresetId(protos);
          const dirty = (() => {
            const saved = (meta?.protocols?.length ? meta.protocols : ['vless-reality']).slice().sort().join(',');
            return saved !== [...protos].sort().join(',');
          })();
          return (
          <div>
            <Card style={{ marginBottom: 10 }}>
              <CardLabel>{t('ak.protocolsLabel')}</CardLabel>
              <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginBottom: 8, lineHeight: 1.4 }}>
                Selecting a preset does <strong style={{ color: 'var(--text-dim)' }}>not</strong> create extra keys — this is still <strong style={{ color: 'var(--accent)' }}>one access key</strong>. All chosen protocols are bundled inside its single subscription URL.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 9 }}>
                {PROTO_PRESETS.map(p => {
                  const on = activePreset === p.id;
                  return (
                    <button key={p.id} onClick={() => applyPreset(p.protocols)} style={{
                      padding: '4px 9px', borderRadius: 5, fontSize: 9.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? 'var(--accent-glow)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-dim)' : 'var(--surface-hover)',
                      color: on ? '#00d4ff' : 'var(--text-dim)',
                    }}>{p.label}</button>
                  );
                })}
                <span style={{ alignSelf: 'center', fontSize: 9, color: 'var(--text-faint)' }}>
                  {activePreset ? '' : 'Custom'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 5, marginBottom: 10 }}>
                {ALL_PROTOCOLS.map(p => {
                  const on = protos.includes(p.key);
                  const c = protoColor(p.key);
                  return (
                    <button key={p.key} onClick={() => toggleProto(p.key)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? `${c}55` : 'var(--border-subtle)'}`,
                      background: on ? `${c}1a` : 'var(--surface-hover)', textAlign: 'left',
                    }}>
                      <span style={{ width: 13, height: 13, borderRadius: 3, flexShrink: 0, border: `1.5px solid ${on ? c : 'var(--text-faint)'}`, background: on ? c : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--bg)', fontWeight: 900 }}>{on ? '✓' : ''}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: on ? 'var(--text-bright)' : 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                    </button>
                  );
                })}
              </div>
              {protos.length === 0 && <div style={{ fontSize: 9.5, color: 'var(--amber)', marginBottom: 8 }}>{t('ak.selectOneProto')}</div>}
              <button onClick={handleSaveProtocols} disabled={protoSaving || protos.length === 0 || !dirty} style={{
                width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                cursor: (protoSaving || !dirty || protos.length === 0) ? 'default' : 'pointer',
                background: dirty && protos.length > 0 ? 'var(--accent)' : 'var(--surface-hover)',
                color: dirty && protos.length > 0 ? 'var(--bg)' : 'var(--text-faint)',
              }}>
                {protoSaving ? t('ak.saving') : protoSaved && !dirty ? `✓ ${t('ak.saving').replace('…','')}` : dirty ? t('ak.saveProtocols') : t('ak.noChanges')}
              </button>
            </Card>

            <Card style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                <CardLabel style={{ marginBottom: 0 }}>{t('ak.subscription')} <span style={{ color: 'var(--green)', fontWeight: 700 }}>{t('ak.subRecommended')}</span></CardLabel>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--green)', background: 'var(--green-dim)', padding: '2px 7px', borderRadius: 4, letterSpacing: 0.4 }}>{t('ak.autoUpdates')}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', marginBottom: 8, lineHeight: 1.4 }}>
                One URL that delivers all protocols and refreshes automatically.
              </div>
              {subUrl && (
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-dim)', background: 'var(--surface)', borderRadius: 5, padding: '7px 9px', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => copy(fullSubUrl)} title={fullSubUrl}>{fullSubUrl}</div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => copy(fullSubUrl)} style={{ flex: 1, padding: '7px 0', background: 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--bg)', fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit' }}>{copied ? `✓ ${t('ak.copied')}` : `⧉ ${t('ak.copySubscription')}`}</button>
                <button onClick={() => setModal('qr')} style={{ flex: 1, padding: '7px 0', background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent)', fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit' }}>⊞ {t('ak.showQr')}</button>
              </div>
            </Card>

            <CardLabel>{t('ak.directLinks', { n: String(uris.length) })} <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>{t('ak.manualImport')}</span></CardLabel>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', marginBottom: 8, lineHeight: 1.4 }}>
              Individual protocol configs inside the subscription. Copy one to import manually.
            </div>
            {uris.length === 0
              ? <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('ak.noLinks')}</div>
              : uris.map(u => (
                  <div key={u.protocol} style={{ background: 'var(--surface-hover)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `${protoColor(u.protocol)}18`, color: protoColor(u.protocol) }}>{u.label}</span>
                      <button onClick={() => copy(u.uri)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'inherit' }}>⧉ {t('ak.copy')}</button>
                    </div>
                    <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-faint)', wordBreak: 'break-all', lineHeight: 1.5 }}>{u.uri.slice(0, 80)}…</div>
                  </div>
                ))}
          </div>
          );
        })()}

        {tab === 'traffic' && <TrafficTab stat={stat} allStats={allStats} t={t} />}
      </div>
    </div>

    {/* ═══ QR Code modal ═══ */}
    {modal === 'qr' && (
      <ModalWrap title={`QR Code — ${name}`} onClose={() => setModal(null)} width={340}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, justifyContent: 'center' }}>
            {(['raw','clash','singbox'] as SubFmt[]).map(f => (
              <SubBtn key={f} label={f === 'singbox' ? 'SingBox' : f === 'clash' ? 'Clash' : 'Raw'} active={subFmt === f} onClick={() => setSubFmt(f)} />
            ))}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={subFmt}
            src={apiUrl(`/api/qr/${encodeURIComponent(stat.email)}?sub=1${subFmt !== 'raw' ? `&format=${subFmt}` : ''}`)}
            alt="QR Code"
            style={{ width: 260, height: 260, borderRadius: 8, imageRendering: 'pixelated' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>
            Scan with your VPN client · <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{subFmt === 'singbox' ? 'SingBox' : subFmt === 'clash' ? 'Clash' : 'Raw'}</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 9, fontFamily: 'monospace', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullSubUrl}</div>
          <button onClick={() => copy(fullSubUrl)} style={{ marginTop: 10, background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 11, fontWeight: 700, color: 'var(--bg)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {copied ? `✓ ${t('ak.copied')}` : `⧉ ${t('ak.copy')} URL`}
          </button>
        </div>
      </ModalWrap>
    )}

    {/* ═══ Edit Limits modal ═══ */}
    {modal === 'editlimits' && (
      <ModalWrap title={t('ak.editLimits')} onClose={() => setModal(null)} width={420}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Resource limits</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, marginBottom: 16 }}>
          <Field label={t('ak.limDeviceLimit')} hint={t('ak.limDeviceHint')}>
            <input type="number" min="0" value={limDevices} onChange={e => setLimDevices(e.target.value)} style={fieldSt} />
          </Field>
          <Field label="Max concurrent networks" hint="0 = unlimited">
            <input type="number" min="0" value={limConcurrent} onChange={e => setLimConcurrent(e.target.value)} style={fieldSt} />
          </Field>
          <Field label={t('ak.limTraffic')} hint={t('ak.limDeviceHint')}>
            <input type="number" min="0" value={limTrafficGB} onChange={e => setLimTrafficGB(e.target.value)} style={fieldSt} />
          </Field>
          <Field label={t('ak.limExpiry')} hint={t('ak.limExpiryHint')}>
            <input type="date" value={limExpiry} onChange={e => setLimExpiry(e.target.value)} style={fieldSt} />
          </Field>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--surface-hover)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Security posture</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>Controls how Archie reacts when this key connects from a new location or ISP. Change it in the Limits tab.</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {PRESET_ORDER.map(p => {
              const col = p === 'strict' ? 'var(--red)' : p === 'open' ? 'var(--green)' : 'var(--amber)';
              const on = p === currentPreset;
              return (
                <button key={p} onClick={() => handleSavePosture(p)} disabled={postureSaving}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: `1.5px solid ${on ? col : 'var(--border)'}`, background: on ? `${col}1a` : 'var(--surface)', color: on ? col : 'var(--text-dim)', fontSize: 11, fontWeight: 700, cursor: postureSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  {PRESET_META[p].label}
                </button>
              );
            })}
          </div>
        </div>
        {limErr && (
          <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 7, background: 'var(--red-dim)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 11, fontWeight: 600 }}>
            {limErr}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => setModal(null)} style={{ flex: 1, background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.cancel')}</button>
          <button onClick={handleSaveLimits} disabled={limSaving} style={{ flex: 2, background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 700, color: 'var(--bg)', cursor: limSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {limSaving ? t('ak.saving') : t('ak.saveChanges')}
          </button>
        </div>
      </ModalWrap>
    )}

    {/* ═══ Devices modal ═══ */}
    {modal === 'devices' && (
      <ModalWrap title={`Devices — ${name}`} onClose={() => setModal(null)} width={520}>
        <DevicesContent stat={stat} onAction={async (ip, action) => { await handleDeviceAction(ip, action); }} t={t} />
      </ModalWrap>
    )}

    {/* ═══ Rotate Key modal ═══ */}
    {modal === 'rotate' && (
      <ModalWrap title={`${t('ak.rotateKey')} — ${name}`} onClose={() => setModal(null)} width={420}>
        <div style={{ fontSize: 13, color: 'rgba(180,195,215,0.7)', marginBottom: 16, lineHeight: 1.6 }}>
          {t('ak.rotateWarning', { name: `<strong>${name}</strong>` }).split('<strong>').map((part, i) => {
            const [before, after] = part.split('</strong>');
            return after !== undefined
              ? <span key={i}><strong style={{ color: 'var(--text-bright)' }}>{before}</strong>{after}</span>
              : <span key={i}>{before}</span>;
          })}<br /><br />
          <strong style={{ color: 'var(--amber)' }}>{t('ak.cannotUndo')}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModal(null)} style={{ flex: 1, background: 'var(--surface-hover)', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 600, color: 'rgba(180,195,215,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.cancel')}</button>
          <button onClick={doRotate} disabled={working === 'rotate'} style={{ flex: 1, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 700, color: 'var(--amber)', cursor: working === 'rotate' ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{working === 'rotate' ? t('ak.rotating') : t('ak.rotateKey')}</button>
        </div>
      </ModalWrap>
    )}

    {/* ═══ Delete modal ═══ */}
    {modal === 'delete' && (
      <ModalWrap title={`${t('ak.deleteKey')} — ${name}`} onClose={() => setModal(null)} width={420}>
        <div style={{ fontSize: 13, color: 'rgba(180,195,215,0.7)', marginBottom: 16, lineHeight: 1.6 }}>
          {t('ak.deleteWarning', { name })} <strong style={{ color: 'var(--red)' }}>{t('ak.cannotUndo')}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModal(null)} style={{ flex: 1, background: 'var(--surface-hover)', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 600, color: 'rgba(180,195,215,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.cancel')}</button>
          <button onClick={doDelete} disabled={working === 'delete'} style={{ flex: 1, background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 700, color: 'var(--red)', cursor: working === 'delete' ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {working === 'delete' ? t('ak.deleting') : t('ak.deleteKey')}
          </button>
        </div>
      </ModalWrap>
    )}

    {/* ═══ Re-enable (force-resolve limit) modal ═══ */}
    {modal === 'reenable' && blockInfo && (
      <ModalWrap title={t('ak.reEnableTitle', { name })} onClose={() => { setModal(null); setBlockInfo(null); }} width={440}>
        {/* Why it's blocked */}
        <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 8, padding: '11px 13px', marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 600, lineHeight: 1.5 }}>
            {blockInfo.expired
              ? t('ak.reEnableWhyExpired', { date: blockInfo.expiresAt?.slice(0, 10) ?? '—' })
              : t('ak.reEnableWhyQuota', { used: String(blockInfo.usedGB), limit: String(blockInfo.limitGB ?? 0) })}
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'rgba(180,195,215,0.7)', marginBottom: 14, lineHeight: 1.55 }}>
          {t('ak.reEnableHint')}
        </div>

        {/* Resolution: expiry */}
        {blockInfo.expired && (
          <div style={{ marginBottom: 13 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }}>{t('ak.reEnableNewExpiry')}</label>
            <input type="date" value={resExpiry} onChange={e => setResExpiry(e.target.value)}
              style={{ width: '100%', background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', fontSize: 12, color: 'var(--text-bright)', fontFamily: 'inherit' }} />
          </div>
        )}

        {/* Resolution: quota */}
        {blockInfo.overLimit && (
          <>
            <div style={{ marginBottom: 11 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }}>{t('ak.reEnableNewLimit')}</label>
              <input type="number" min={0} value={resLimitGB} onChange={e => setResLimitGB(e.target.value)}
                style={{ width: '100%', background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', fontSize: 12, color: 'var(--text-bright)', fontFamily: 'inherit' }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(180,195,215,0.85)', marginBottom: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={resResetUsage} onChange={e => setResResetUsage(e.target.checked)} style={{ cursor: 'pointer' }} />
              {t('ak.reEnableResetUsage')}
            </label>
          </>
        )}

        {reEnableErr && (
          <div style={{ fontSize: 11.5, color: 'var(--amber)', fontWeight: 600, marginBottom: 11 }}>⚠ {reEnableErr}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setModal(null); setBlockInfo(null); }} style={{ flex: 1, background: 'var(--surface-hover)', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 600, color: 'rgba(180,195,215,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('ak.cancel')}</button>
          <button onClick={doReEnableResolve} disabled={working === 'disable'} style={{ flex: 1.4, background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 12, fontWeight: 700, color: 'var(--bg)', cursor: working === 'disable' ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {working === 'disable' ? t('ak.reEnableWorking') : t('ak.reEnableConfirm')}
          </button>
        </div>
      </ModalWrap>
    )}
    </>
  );
}

// ── Traffic tab ───────────────────────────────────────────────────────────────
type DailyRow = { day: string; upload: number; download: number };

function Split({ up, down, total }: { up: number; down: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
      <span style={{ color: '#4e9eff' }}>↑ {fmtBytes(up)}</span>
      <span style={{ color: 'var(--green)' }}>↓ {fmtBytes(down)}</span>
      <span style={{ color: 'var(--text-bright)', fontWeight: 700 }}>Σ {fmtBytes(total)}</span>
    </div>
  );
}

function TrafficTab({ stat, allStats, t }: { stat: UserStat; allStats: UserStat[]; t: (k: string, v?: Record<string,string>) => string }) {
  const [period, setPeriod]       = useState<1 | 7 | 30>(30);
  const [rows, setRows]           = useState<DailyRow[]>([]);
  const [loadingRows, setLoading] = useState(false);

  const group   = stat.meta?.group ?? 'Ungrouped';
  const members = allStats.filter(u => (u.meta?.group ?? 'Ungrouped') === group);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(apiUrl(`/api/traffic?email=${encodeURIComponent(stat.email)}&days=${period}`))
      .then(r => r.json())
      .then((d: { rows: DailyRow[] }) => { setRows(d.rows ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stat.email, period]);

  const myUp    = rows.reduce((s, r) => s + r.upload, 0);
  const myDown  = rows.reduce((s, r) => s + r.download, 0);
  const myTotal = myUp + myDown;

  const limitGB    = stat.meta?.trafficLimitGB ?? 0;
  const limitBytes = limitGB * 1e9;
  // For 30d use stat.traffic (server-computed 30d); for shorter periods use our fetched sum
  const displayTotal = period === 30 && stat.traffic ? stat.traffic.total : myTotal;
  const displayUp    = period === 30 && stat.traffic ? stat.traffic.up    : myUp;
  const displayDown  = period === 30 && stat.traffic ? stat.traffic.down  : myDown;
  const pct = limitBytes > 0 ? Math.min(100, Math.round(displayTotal / limitBytes * 100)) : 0;
  const barColor = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--accent)';

  const gUp = members.reduce((s, u) => s + (u.traffic?.up ?? 0), 0);
  const gDown = members.reduce((s, u) => s + (u.traffic?.down ?? 0), 0);
  const gTotal = gUp + gDown;

  // Daily bar chart data — last N days
  const chartRows = rows.slice(-Math.min(period, 14)); // show up to 14 bars
  const chartMax  = Math.max(...chartRows.map(r => r.upload + r.download), 1);


  const periodLabels: Record<number, string> = { 1: 'Today', 7: '7d', 30: '30d' };

  return (
    <div>
      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {t('ak.accumulated')}
        </span>
        <div style={{ display: 'flex', gap: 2, background: 'var(--border-subtle)', borderRadius: 6, padding: 2 }}>
          {([1, 7, 30] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? '#00d4ff' : 'transparent',
              color: period === p ? '#041019' : 'var(--text-dim)',
              border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{periodLabels[p]}</button>
          ))}
        </div>
      </div>

      {/* This key card */}
      <Card style={{ marginBottom: 10 }}>
        <CardLabel>{t('ak.thisKey')}</CardLabel>
        {loadingRows ? (
          <div style={{ fontSize: 11, color: 'var(--text-faint)', paddingBottom: 6 }}>{t('ak.loading')}</div>
        ) : (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1, marginBottom: 4 }}>{fmtBytes(displayTotal)}</div>
            <div style={{ marginBottom: 7 }}><Split up={displayUp} down={displayDown} total={displayTotal} /></div>
            {limitBytes > 0 && period === 30 && (
              <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginBottom: 5 }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: barColor }} />
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 10 }}>
              {limitGB && period === 30
                ? <>{pct}% of {limitGB} GB limit</>
                : <><span style={{ fontWeight: 800, color: 'rgba(220,232,245,0.85)' }}>{t('ak.unlimited')}</span></>
              }
            </div>

            {/* Daily bar chart */}
            {chartRows.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 52, marginBottom: 4 }}>
                  {chartRows.map(r => {
                    const tot = r.upload + r.download;
                    const h = Math.max(3, Math.round((tot / chartMax) * 50));
                    const upH = Math.round((r.upload / (tot || 1)) * h);
                    const downH = h - upH;
                    return (
                      <div key={r.day} title={`${r.day}\n↑ ${fmtBytes(r.upload)}\n↓ ${fmtBytes(r.download)}`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', cursor: 'default' }}>
                        <div style={{ background: '#4e9eff', height: upH, borderRadius: '2px 2px 0 0' }} />
                        <div style={{ background: 'var(--green)', height: downH }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'rgba(180,195,215,0.25)' }}>
                  <span>{chartRows[0]?.day.slice(5)}</span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#4e9eff' }}>↑ up</span>
                    <span style={{ color: 'var(--green)' }}>↓ down</span>
                  </span>
                  <span>{chartRows[chartRows.length - 1]?.day.slice(5)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Group breakdown — always shows 30d from stats (no re-fetch needed) */}
      <CardLabel>{t('ak.groupTotal')} · {group} ({members.length})</CardLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {members
          .slice()
          .sort((a, b) => (b.traffic?.total ?? 0) - (a.traffic?.total ?? 0))
          .map(u => {
            const isSelf = u.uuid === stat.uuid;
            return (
              <div key={u.uuid} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 8px', borderRadius: 6,
                background: isSelf ? 'var(--accent-dim)' : 'transparent',
                border: isSelf ? '1px solid var(--accent-dim)' : '1px solid transparent',
              }}>
                <span style={{ fontSize: 12.5, fontWeight: isSelf ? 700 : 500, color: isSelf ? 'var(--text-bright)' : 'rgba(180,195,215,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>
                  {u.meta?.displayName ?? u.email}
                </span>
                <Split up={u.traffic?.up ?? 0} down={u.traffic?.down ?? 0} total={u.traffic?.total ?? 0} />
              </div>
            );
          })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 8px', marginTop: 4, borderTop: '1px solid rgba(74,108,149,0.25)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-bright)' }}>{t('ak.groupTotal')}</span>
          <Split up={gUp} down={gDown} total={gTotal} />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: '10px 12px', ...style }}>{children}</div>;
}
function CardLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6, ...style }}>{children}</div>;
}
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 10 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: 'var(--text-bright)', fontWeight: 500, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: bg, color }}>{label}</span>;
}
function SummaryCell({ label, value, vc }: { label: string; value: string; vc?: string }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
      <div style={{ fontSize: 9, color: 'var(--text-faint)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: vc ?? 'var(--text-bright)' }}>{value}</div>
    </div>
  );
}
function LimitRow({ label, value, vc }: { label: string; value: string; vc?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 6, fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: vc ?? 'var(--text-bright)' }}>{value}</span>
    </div>
  );
}
function SubBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '4px 0', border: `1px solid ${active ? 'var(--accent-glow)' : 'var(--border)'}`,
      borderRadius: 4, background: active ? 'var(--accent)' : 'var(--surface-hover)',
      color: active ? '#041019' : 'var(--text-dim)',
      fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
}
function ActionBtn({ icon, label, onClick, color, loading, active }: {
  icon: string; label: string; onClick: () => void; color?: string; loading?: boolean; active?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '7px 7px',
      background: active ? 'var(--green-dim)' : 'var(--surface-hover)',
      border: `1px solid ${active ? 'var(--green)' : 'var(--border-subtle)'}`,
      borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
      color: active ? 'var(--green)' : (color ?? 'var(--text-dim)'),
      fontSize: 9.5, fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.5 : 1, width: '100%',
    }}>
      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 9, color: 'rgba(180,195,215,0.25)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
const fieldSt: React.CSSProperties = {
  width: '100%', background: 'var(--surface)', border: '1px solid rgba(74,108,149,0.25)',
  borderRadius: 7, padding: '8px 10px', color: '#eef3f8', fontSize: 12, outline: 'none', boxSizing: 'border-box',
};

// ── Devices content ───────────────────────────────────────────────────────────
function DevicesContent({ stat, onAction, t }: {
  stat: UserStat;
  onAction: (ip: string, action: 'approve' | 'reject' | 'clear') => Promise<void>;
  t: (k: string, v?: Record<string,string>) => string;
}) {
  const [acting, setActing] = useState<string | null>(null);
  const act = async (ip: string, action: 'approve' | 'reject' | 'clear') => {
    setActing(`${ip}-${action}`);
    await onAction(ip, action);
    setActing(null);
  };
  const pending  = stat.devices?.pending_info  ?? [];
  const approved = stat.devices?.approved_info ?? [];
  const blocked  = stat.devices?.rejected_info ?? [];
  const all = [...pending, ...approved, ...blocked];

  const ispCount: Record<string, number> = {};
  for (const d of all) ispCount[d.isp] = (ispCount[d.isp] ?? 0) + 1;

  const lastByIp: Record<string, string> = {};
  for (const s of stat.sessions ?? []) for (const ip of s.ips) {
    if (!lastByIp[ip] || s.end > lastByIp[ip]) lastByIp[ip] = s.end;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (d: any, status: 'approved' | 'pending' | 'blocked', actions: Partial<Record<'onApprove'|'onReject'|'onRemove', () => void>>) => (
    <DeviceRow key={`${status}-${d.ip}`} ip={d.ip} flag={d.flag} city={`${d.city}, ${d.cc}`} isp={d.isp}
      mobile={!!d.mobile} connectedAt={lastByIp[d.ip] ?? null} duplicate={(ispCount[d.isp] ?? 0) > 1}
      status={status} acting={acting?.startsWith(d.ip)} tMobile={t('ak.devMobile')} tWifi={t('ak.devWifi')}
      tApprove={t('ak.devApprove')} tReject={t('ak.devReject')} tClear={t('ak.devClear')} tRestore={t('ak.devRestore')}
      {...actions} />
  );

  if (!all.length) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>{t('ak.devNone')}</div>;
  }
  return (
    <div>
      {pending.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--amber)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>{t('ak.devPending')} ({pending.length})</div>
          {pending.map(d => row(d, 'pending', { onApprove: () => act(d.ip, 'approve'), onReject: () => act(d.ip, 'reject') }))}
          <div style={{ borderBottom: '1px solid var(--border-subtle)', margin: '10px 0' }} />
        </>
      )}
      {approved.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--green)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>{t('ak.devApproved')} ({approved.length})</div>
          {approved.map(d => row(d, 'approved', { onRemove: () => act(d.ip, 'clear') }))}
        </>
      )}
      {blocked.length > 0 && (
        <>
          <div style={{ borderBottom: '1px solid var(--border-subtle)', margin: '10px 0' }} />
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--red)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>{t('ak.devBlocked')} ({blocked.length})</div>
          {blocked.map(d => row(d, 'blocked', { onApprove: () => act(d.ip, 'approve') }))}
        </>
      )}
    </div>
  );
}

function DeviceRow({ ip, flag, city, isp, status, mobile, connectedAt, duplicate, onApprove, onReject, onRemove, acting, tMobile, tWifi, tApprove, tReject, tClear, tRestore }: {
  ip: string; flag: string; city: string; isp: string;
  status: 'approved' | 'pending' | 'blocked';
  mobile?: boolean; connectedAt?: string | null; duplicate?: boolean;
  onApprove?: () => void; onReject?: () => void; onRemove?: () => void; acting?: boolean | null;
  tMobile: string; tWifi: string; tApprove: string; tReject: string; tClear: string; tRestore: string;
}) {
  const [sg, sc]: [string, string] = status === 'approved' ? ['var(--green-dim)', 'var(--green)'] : status === 'pending' ? ['var(--amber-dim)', 'var(--amber)'] : ['var(--red-dim)', 'var(--red)'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'var(--surface-hover)', marginBottom: 5, opacity: acting ? 0.6 : 1 }}>
      <span style={{ fontSize: 18 }}>{flag}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>{ip}</span>
          <span style={{ padding: '0 5px', borderRadius: 3, fontSize: 8, fontWeight: 700, lineHeight: '13px', background: mobile ? 'rgba(255,184,0,.15)' : 'rgba(57,211,83,.1)', color: mobile ? '#ffb800' : '#39d353' }}>
            {mobile ? tMobile : tWifi}
          </span>
          {duplicate && (
            <span style={{ padding: '0 5px', borderRadius: 3, fontSize: 8, fontWeight: 700, lineHeight: '13px', background: 'var(--amber-dim)', color: 'var(--amber)' }} title="Same ISP as another device">DUP</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {city} · {isp}{connectedAt ? ` · ${fmtLastSeen(connectedAt)}` : ''}
        </div>
      </div>
      <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 700, background: sg, color: sc, flexShrink: 0 }}>{status}</span>
      {status === 'pending' && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={onApprove} style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: 'var(--green-dim)', color: 'var(--green)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{tApprove}</button>
          <button onClick={onReject}  style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: 'var(--red-dim)',  color: 'var(--red)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{tReject}</button>
        </div>
      )}
      {status === 'approved' && onRemove && (
        <button onClick={onRemove} style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{tClear}</button>
      )}
      {status === 'blocked' && onApprove && (
        <button onClick={onApprove} style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: 'var(--green-dim)', color: 'var(--green)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{tRestore}</button>
      )}
    </div>
  );
}
