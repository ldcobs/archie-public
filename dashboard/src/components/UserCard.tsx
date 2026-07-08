'use client';
import { useState, useCallback } from 'react';
import { copyText } from '@/lib/clipboard';
import type { IpInfo, UserStat } from '@/lib/types';
import { Btn, groupColor } from './ui';
import { apiUrl } from '@/lib/api-path';
import type { VpnProtocol } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { protocolBadges } from './Modals';

// ── QR Modal ──────────────────────────────────────────────────────────────────

function QrModal({ email, uuid, onClose }: { email: string; uuid: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState('');
  const [tab, setTab] = useState<'qr' | 'sub'>('qr');

  const subPath = apiUrl(`/api/sub/${uuid}`);
  const subUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${subPath}`
    : subPath;

  const copyAndFlag = useCallback(async (text: string, label: string) => {
    try {
      await copyText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* clipboard not available */ }
  }, []);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, maxWidth: 440, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 4 }}>{email}</div>

        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 12 }}>
          <Btn small variant={tab === 'qr' ? 'primary' : 'default'} onClick={() => setTab('qr')}>{t('qr.qrCode')}</Btn>
          <Btn small variant={tab === 'sub' ? 'primary' : 'default'} onClick={() => setTab('sub')}>{t('qr.subscription')}</Btn>
        </div>

        {tab === 'qr' && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>{t('modal.scanQr')}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={apiUrl(`/api/qr/${encodeURIComponent(email)}?sub=1`)}
              alt={`Subscription QR code for ${email}`}
              style={{ width: 280, height: 280, borderRadius: 8, background: 'var(--bg)' }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Btn variant="primary" onClick={() => copyAndFlag(subUrl, "sub")}>
                {copied === 'sub' ? t('modal.copied') : t('modal.copySubUrl')}
              </Btn>
            </div>
          </>
        )}

        {tab === 'sub' && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>{t('qr.addSubUrl')}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>{t('qr.autoUpdates')}</div>
            <div style={{
              background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '12px', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all',
              fontFamily: 'monospace', textAlign: 'left',
            }}>
              {subUrl}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Btn variant="primary" onClick={() => copyAndFlag(subUrl, "sub")}>
                {copied === 'sub' ? t('modal.copied') : t('modal.copySubUrl')}
              </Btn>
            </div>
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <Btn variant="default" onClick={onClose}>{t('modal.close')}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function fmtCompactInt(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 100000 ? 0 : 1,
  }).format(value);
}

function formatRelativeTime(value: string | null | undefined, t: (key: string, vars?: Record<string, string>) => string) {
  if (!value) return t('time.never');
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return t('time.never');
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}${t('time.s')} ${t('time.ago')}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${t('time.m')} ${t('time.ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('time.h')} ${t('time.ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}${t('time.d')} ${t('time.ago')}`;
}

function formatElapsedTime(value: string | null | undefined, t: (key: string, vars?: Record<string, string>) => string) {
  if (!value) return '—';
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return `<1${t('time.m')}`;
  if (minutes < 60) return `${minutes}${t('time.m')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('time.h')} ${minutes % 60}${t('time.m')}`;
  const days = Math.floor(hours / 24);
  return `${days}${t('time.d')} ${hours % 24}${t('time.h')}`;
}

// Total minutes → "3h 12m" / "45m" / "0m". Drops minutes past 10h so the metric
// value stays short enough to render without truncation in the narrow cells.
function fmtDuration(totalMin: number, t: (key: string) => string): string {
  if (totalMin <= 0) return `0${t('time.m')}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}${t('time.m')}`;
  if (m === 0 || h >= 10) return `${h}${t('time.h')}`;
  return `${h}${t('time.h')} ${m}${t('time.m')}`;
}

// Which generation preset matches this key's protocol set (mirrors NewKeyPanel TIERS).
const PRESETS: [string, string[]][] = [
  ['Standard',   ['vless-reality']],
  ['Compatible', ['vless-reality', 'vmess-ws-tls']],
  ['Universal',  ['vless-reality', 'vmess-ws-tls', 'trojan-tls']],
];
function presetLabel(protocols: string[] | null | undefined): string {
  const p = protocols ?? [];
  if (!p.length) return '';
  for (const [name, set] of PRESETS) {
    if (set.length === p.length && set.every(x => p.includes(x))) return name;
  }
  return 'Custom';
}

function latestSessionStart(u: UserStat): string | null {
  if (!u.sessions.length) return null;
  return [...u.sessions]
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())[0]
    ?.start ?? null;
}

function ProtoBadges({ p, profileKeys }: { p: VpnProtocol | null; profileKeys?: string[] | null }) {
  const fromProfile = protocolBadges(profileKeys);
  const badges = fromProfile.length > 0 ? fromProfile : [
    p?.protocol?.toUpperCase(),
    p?.security === 'reality' ? 'Reality' : p?.security !== 'none' ? p?.security : null,
    p?.flow === 'xtls-rprx-vision' ? 'XTLS Vision' : p?.flow || null,
  ].filter(Boolean) as string[];
  if (!badges.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
      {badges.map((b, i) => (
        <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: b === '|' ? 'transparent' : 'var(--purple-dim)', color: b === '|' ? 'var(--muted)' : 'var(--purple)', border: b === '|' ? 'none' : '1px solid var(--purple)', fontWeight: 600 }}>
          {b}
        </span>
      ))}
    </span>
  );
}

function DeviceStateBadges({ info, u, currentIp }: { info: IpInfo; u: UserStat; currentIp: string | null }) {
  const { t } = useI18n();
  const activeNow = info.ip === currentIp;
  const isNew = u.new_ips.includes(info.ip);

  if (!activeNow && !isNew) return null;

  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {activeNow && (
        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green)', fontWeight: 700 }}>
          {t('user.currentShort').toUpperCase()}
        </span>
      )}
      {isNew && (
        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 700 }}>
          {t('user.newShort').toUpperCase()}
        </span>
      )}
    </div>
  );
}

function DeviceListRow({
  info,
  u,
  tone,
  actions,
  currentIp,
}: {
  info: IpInfo;
  u: UserStat;
  tone: 'approved' | 'pending' | 'blocked';
  actions?: React.ReactNode;
  currentIp: string | null;
}) {
  const toneColor =
    tone === 'approved' ? 'var(--green)' :
    tone === 'pending' ? 'var(--amber)' :
    'var(--red)';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) auto',
      gap: 10,
      alignItems: 'center',
      padding: '8px 12px',
      borderTop: '1px solid var(--border-subtle)',
    }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)', fontFamily: 'monospace' }}>{info.ip}</span>
          <DeviceStateBadges info={info} u={u} currentIp={currentIp} />
          <span style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 3,
            background: info.mobile ? 'var(--amber-dim)' : 'var(--green-dim)',
            color: info.mobile ? 'var(--amber)' : 'var(--green)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {info.mobile ? 'mobile' : 'wifi'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.45, minWidth: 0 }}>
          <span style={{ color: toneColor }}>{info.flag} {[info.city, info.country].filter(Boolean).join(', ') || info.country || 'Unknown'}</span>
          {info.isp ? <><br /><span style={{ opacity: 0.72 }}>{info.isp}</span></> : null}
        </div>
      </div>
      {actions ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div> : null}
    </div>
  );
}

// ── Collapsible row ───────────────────────────────────────────────────────────

function CollapseRow({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', border: '1px solid var(--border)',
          borderRadius: open ? '8px 8px 0 0' : 8,
          background: 'var(--surface-hover)', cursor: 'pointer',
          fontFamily: 'inherit', color: 'var(--text)', fontSize: 12, fontWeight: 500,
          transition: 'background .15s',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && children && (
        <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', background: 'var(--surface)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function UserCard({ u, onRefresh, onEdit, onDelete, collapsed, onToggleCollapse }: {
  u: UserStat;
  onRefresh: () => void;
  onEdit: (u: UserStat) => void;
  onDelete: (email: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [sessOpen, setSessOpen] = useState(false);
  const [devOpen,  setDevOpen]  = useState(false);
  const [qrOpen,   setQrOpen]   = useState(false);

  const color  = groupColor(u.meta?.group ?? '');
  const status = u.status;
  const isOnline = status === 'online';
  const isRecent = status === 'recent';

  // ── Two distinct axes ──
  // Connectivity = is the client connected right now (online / recent / offline).
  // Key state    = is the key usable at all (active / disabled / expired).
  const isDisabled = !!u.meta?.disabled;
  const keyState: 'active' | 'disabled' | 'expired' =
    isDisabled ? 'disabled' : u.expired ? 'expired' : 'active';
  const keyStateLabel =
    keyState === 'disabled' ? t('user.keyDisabled')
    : keyState === 'expired' ? t('user.keyExpiredShort')
    : t('user.active');
  const keyStateColor =
    keyState === 'disabled' ? 'var(--text-faint)'
    : keyState === 'expired' ? 'var(--red)'
    : 'var(--green)';

  // ── Risk ──
  const riskFactors: string[] = [];
  if (u.new_ips.length > 0)         riskFactors.push(t('user.riskNewIp'));
  if (u.deviceEstimate?.ispConflict) riskFactors.push(t('user.riskMultiIsp'));
  if (u.expired)                     riskFactors.push(u.expiredReason === 'traffic' ? t('user.riskOverQuota') : t('user.riskExpired'));
  if (u.devices && u.devices.approved_count >= u.devices.limit && u.devices.limit > 0)
                                     riskFactors.push(t('user.riskDeviceLimit'));

  const riskCode = (u.deviceEstimate?.ispConflict || u.expired) ? 'high'
    : riskFactors.length > 0 ? 'medium' : 'low';
  const riskLevel = riskCode === 'high' ? t('user.high') : riskCode === 'medium' ? t('user.medium') : t('user.low');
  const riskColor = riskCode === 'high' ? 'var(--red)' : riskCode === 'medium' ? 'var(--yellow)' : 'var(--green)';

  // ── Connectivity badge style ──
  const statusLabel = isOnline ? t('user.online') : isRecent ? t('user.recent') : t('user.offline');
  const statusColor = isOnline ? 'var(--green)' : isRecent ? 'var(--yellow)' : 'var(--text-dim)';
  const statusBorder = isOnline ? 'var(--green)' : isRecent ? 'var(--yellow)' : 'var(--border)';
  const statusBg    = isOnline ? 'var(--green-dim)'  : isRecent ? 'var(--yellow-dim)' : 'var(--surface-hover)';
  const dotColor    = isOnline ? 'var(--green)' : isRecent ? 'var(--yellow)' : 'var(--text-faint)';

  // ── Last IP ──
  const lastIp = u.ips.length > 0 ? u.ips[0] : u.ips_24h.length > 0 ? u.ips_24h[0] : null;

  // ── Devices string ──
  const devStr = u.devices ? `${u.devices.approved_count}/${u.devices.limit}` : '—';
  const devAtLimit = u.devices && u.devices.approved_count >= u.devices.limit;

  const displayName = u.meta?.displayName ?? u.email.split('@')[0];
  const currentSessionStart = latestSessionStart(u);
  const activeIpCount = u.ips.length;

  // ── Connected-over-24h metric (sum of session durations in the rolling 24h window) ──
  const sessionCount = u.sessions.length;
  const totalConnectedMin = u.sessions.reduce((s, x) => s + x.durMin, 0);
  const connectedValue = fmtDuration(totalConnectedMin, t);
  const sessionsCaption = sessionCount === 0
    ? t('user.noSessions')
    : sessionCount === 1
      ? t('user.oneSession')
      : t('user.sessionsN', { count: String(sessionCount) });

  // ── Connectivity sub-line (under the name) ──
  const connectivityDetail = isOnline
    ? `${t('user.connected')} · ${formatElapsedTime(currentSessionStart ?? u.last_seen, t)}`
    : `${t('user.lastSeenMetric')} · ${formatRelativeTime(u.last_seen, t)}`;

  async function approveIp(ip: string) {
    const replaceOldest = !!u.devices && u.devices.approved_count >= u.devices.limit;
    await fetch(apiUrl(`/api/devices/${encodeURIComponent(u.email)}/${ip}/approve`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_oldest: replaceOldest }),
    });
    onRefresh();
  }

  async function rejectIp(ip: string) {
    await fetch(apiUrl(`/api/devices/${encodeURIComponent(u.email)}/${ip}/reject`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    onRefresh();
  }

  async function clearIp(ip: string) {
    await fetch(apiUrl(`/api/devices/${encodeURIComponent(u.email)}/${ip}/clear`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    onRefresh();
  }

  // Compact strip — dormant users OR explicitly collapsed cards
  if ((u.conns_24h === 0 && !u.devices?.warning) || collapsed) {
    const protocols = u.meta?.protocols ?? [];
    const trafficStr = u.traffic && u.traffic.total > 0 ? fmtBytes(u.traffic.total) : null;
    const pendingCount = u.devices?.pending_count ?? 0;
    const canExpand = !!onToggleCollapse && (u.conns_24h > 0 || !!u.devices?.warning);
    return (
      <div
        onClick={canExpand ? onToggleCollapse : undefined}
        title={canExpand ? t('user.clickToExpand') : undefined}
        style={{
          borderRadius: 8, padding: '9px 14px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderLeft: `3px solid ${color}`,
          cursor: canExpand ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Status dot */}
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, boxShadow: isOnline ? `0 0 5px ${dotColor}` : 'none' }} />

          {/* Name + badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100, maxWidth: 160 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
            {u.meta?.isOwner && <span style={{ fontSize: 9, color: 'var(--amber)', flexShrink: 0 }}>♛</span>}
            {isDisabled && <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-faint)', background: 'var(--surface-hover)', border: '1px solid var(--border)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>{t('user.keyDisabled').toUpperCase()}</span>}
            {!isDisabled && u.expired && <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--red)', background: 'var(--red-dim)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>EXP</span>}
            {pendingCount > 0 && <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--yellow)', background: 'var(--yellow-dim)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>!{pendingCount}</span>}
          </div>

          {/* Status / last seen */}
          <span style={{ fontSize: 10, color: isOnline ? 'var(--green)' : isRecent ? 'var(--amber)' : 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {isOnline ? 'online' : isRecent ? formatRelativeTime(u.last_seen, t) : u.last_seen ? formatRelativeTime(u.last_seen, t) : t('user.neverConnected')}
          </span>

          {/* Separator */}
          <span style={{ flex: 1 }} />

          {/* Protocol chips */}
          {protocols.slice(0, 2).map(p => {
            const PROTO_COLOR: Record<string, string> = { 'vless-reality': 'var(--accent)', 'vless-reality-vision': 'var(--accent)', 'trojan-tls': 'var(--purple)', 'trojan-ws': 'var(--purple)', 'hysteria2': 'var(--green)', 'wireguard': 'var(--accent)' };
            const PROTO_LABEL: Record<string, string> = { 'vless-reality': 'Reality', 'vless-reality-vision': 'Reality+', 'vless-ws-tls': 'WS', 'vless-grpc-tls': 'gRPC', 'vless-xhttp-tls': 'XHTTP', 'trojan-tls': 'Trojan', 'trojan-ws': 'Trojan WS', 'hysteria2': 'HY2', 'wireguard': 'WG', 'shadowsocks': 'SS' };
            const pc = PROTO_COLOR[p] ?? 'var(--text-faint)';
            return <span key={p} style={{ fontSize: 9, fontWeight: 700, color: pc, background: `${pc}1a`, border: `1px solid ${pc}4d`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0 }}>{PROTO_LABEL[p] ?? p}</span>;
          })}

          {/* Last IP flag + country */}
          {lastIp && (
            <span style={{ fontSize: 11, flexShrink: 0 }} title={`${lastIp.ip} · ${lastIp.city ?? ''}, ${lastIp.country ?? ''} · ${lastIp.isp ?? ''}`}>
              {lastIp.flag} <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{lastIp.cc}</span>
            </span>
          )}

          {/* Connections 24h */}
          {u.conns_24h > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{u.conns_24h} conn</span>
          )}

          {/* Traffic */}
          {trafficStr && <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{trafficStr}</span>}

          {/* Actions — do NOT toggle the strip */}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginLeft: 4, cursor: 'default' }}>
            <Btn small variant="ghost" onClick={() => setQrOpen(true)} style={{ fontSize: 11, color: 'var(--text-dim)' }}>⬜</Btn>
            <Btn small variant="ghost" onClick={() => onEdit(u)} style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}>✎</Btn>
            <Btn small variant="ghost" style={{ color: 'var(--red)', border: '1px solid var(--red)' }} onClick={() => onDelete(u.email)}>🗑</Btn>
          </div>
        </div>
        {qrOpen && <QrModal email={u.email} uuid={u.uuid} onClose={() => setQrOpen(false)} />}
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 14,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      padding: '22px 24px',
    }}>

      {/* ── Header (click the bar to collapse; action cluster is excluded) ── */}
      <div
        onClick={onToggleCollapse}
        title={onToggleCollapse ? t('user.clickToCollapse') : undefined}
        style={{ marginBottom: 16, cursor: onToggleCollapse ? 'pointer' : 'default' }}
      >
        {/* Row 1 — name + badges/actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: dotColor,
              boxShadow: isOnline ? `0 0 8px ${dotColor}` : undefined,
              animation: isOnline ? 'pulse 2s infinite' : undefined,
            }} />
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1.15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
            {u.meta?.isOwner && (
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)', fontWeight: 700, letterSpacing: 0.5, flexShrink: 0 }}>
                {t('user.owner')}
              </span>
            )}
          </div>
          {/* action cluster — does NOT collapse the card */}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'default' }}>
            <span style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 999,
              textTransform: 'uppercase' as const, letterSpacing: 0.8, fontWeight: 700,
              background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
            }}>
              {statusLabel}
            </span>
            <span style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 999,
              textTransform: 'uppercase' as const, letterSpacing: 0.8, fontWeight: 700,
              background: `color-mix(in srgb, ${keyStateColor} 14%, transparent)`,
              color: keyStateColor, border: `1px solid color-mix(in srgb, ${keyStateColor} 55%, transparent)`,
            }} title={t('legend.activeMeans')}>
              {keyStateLabel}
            </span>
            <Btn small variant="ghost" onClick={() => setQrOpen(true)} style={{ fontSize: 13, color: 'var(--text-faint)' }}>⬜</Btn>
            <Btn small variant="ghost" onClick={() => onEdit(u)} style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}>✎</Btn>
            <Btn small variant="ghost" style={{ color: 'var(--red)', border: '1px solid var(--red-dim)' }} onClick={() => onDelete(u.email)}>🗑</Btn>
          </div>
        </div>

        {/* Row 2 — connectivity detail, full width single line */}
        <div style={{ fontSize: 11, color: statusColor, marginTop: 5, marginLeft: 19, whiteSpace: 'nowrap' }}>
          {connectivityDetail}
        </div>

        {/* Row 3 — UUID + protocol composition + preset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginLeft: 19, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-faint)' }} title={u.uuid}>
            {u.uuid.slice(0, 8)}…
          </span>
          <ProtoBadges p={u.vpnProtocol} profileKeys={u.meta?.protocols} />
          {presetLabel(u.meta?.protocols) && (
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: 'var(--surface-hover)', color: 'var(--text-dim)', border: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {presetLabel(u.meta?.protocols)}
            </span>
          )}
          {u.new_ips.length > 0 && (
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)', fontWeight: 700 }}>
              {t('user.newIpBadge')}
            </span>
          )}
          {u.deviceEstimate?.ispConflict && (
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red)', fontWeight: 700 }}>
              {t('user.multiIspBadge')}
            </span>
          )}
        </div>
      </div>

      {/* ── Expired banner ── */}
      {u.expired && (
        <a href={apiUrl('/keys')} style={{ display: 'block', textDecoration: 'none', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 6, padding: '7px 12px', marginBottom: 14, fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>
          {u.expiredReason === 'traffic' ? t('user.overQuota') : t('user.expired')}
        </a>
      )}

      {/* ── 4-metric grid (uniform type scale: label 9 · value 18 · caption 10) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
        {([
          { label: t('user.activeIpsShort').toUpperCase(), value: String(activeIpCount),     caption: t('user.5min'),         color: activeIpCount > 0 ? 'var(--green)' : 'var(--text-bright)' },
          { label: t('user.connections24h').toUpperCase(), value: fmtCompactInt(u.conns_24h), caption: t('user.24h'),          color: 'var(--text-bright)' },
          { label: t('user.connected24h').toUpperCase(),   value: connectedValue,             caption: sessionsCaption,        color: totalConnectedMin > 0 ? 'var(--accent)' : 'var(--text-bright)' },
          { label: t('user.approvedSlots').toUpperCase(),  value: devStr,                     caption: t('user.devices').toLowerCase(), color: devAtLimit ? 'var(--yellow)' : 'var(--text-bright)' },
        ] as { label: string; value: string; caption: string; color: string }[]).map(m => (
          <div key={m.label} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '9px 8px', background: 'var(--surface-hover)', minWidth: 0 }}>
            <div style={{ fontSize: 8.5, letterSpacing: 0.4, textTransform: 'uppercase' as const, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.25, minHeight: 22, wordBreak: 'break-word' }}>
              {m.label}
            </div>
            <div style={{
              fontSize: 17,
              fontWeight: 700,
              color: m.color,
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
            }}>
              {m.value}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginTop: 4, whiteSpace: 'nowrap' }}>
              {m.caption}
            </div>
          </div>
        ))}
      </div>

      {/* ── Traffic ── */}
      {u.traffic && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' as const, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('user.traffic').toUpperCase()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            {([
              { label: t('user.upload').toUpperCase(),   val: `↑ ${fmtBytes(u.traffic.up)}`,    color: 'var(--green)' },
              { label: t('user.download').toUpperCase(), val: `↓ ${fmtBytes(u.traffic.down)}`,  color: 'var(--accent)' },
              { label: t('user.total').toUpperCase(),    val: `Σ ${fmtBytes(u.traffic.total)}`, color: 'var(--text-bright)' },
            ] as const).map((t, i) => (
              <div key={t.label} style={{ padding: '10px 12px', borderRight: i < 2 ? '1px solid var(--border-subtle)' : undefined }}>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 4 }}>{t.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.color, whiteSpace: 'nowrap' }}>{t.val}</div>
              </div>
            ))}
          </div>
          {(u.meta?.trafficLimitGB ?? 0) > 0 && (() => {
            const pct = Math.min(100, Math.round(u.traffic!.total / (u.meta!.trafficLimitGB! * 1e9) * 100));
            const bc  = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--accent)';
            return (
              <div style={{ marginTop: 5, height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: bc, borderRadius: 2 }} />
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Last IP ── */}
      {lastIp && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' as const, color: 'var(--text-dim)', marginBottom: 6 }}>
            {t('user.lastIp').toUpperCase()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr) auto', alignItems: 'start', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {lastIp.ip}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4, minWidth: 0 }}>
              {lastIp.flag} {[lastIp.city, lastIp.country].filter(Boolean).join(', ')}
              {lastIp.isp ? <><br /><span style={{ opacity: 0.7, fontSize: 11 }}>{lastIp.isp.substring(0, 28)}</span></> : null}
            </span>
            {lastIp.mobile !== undefined && (
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: lastIp.mobile ? 'var(--amber-dim)' : 'var(--green-dim)', color: lastIp.mobile ? 'var(--amber)' : 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'center' }}>
                {lastIp.mobile ? 'mobile' : 'wifi'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Expiry ── */}
      {u.meta?.expiresAt && (
        <div style={{ fontSize: 11, color: u.expired ? 'var(--red)' : 'var(--muted)', marginBottom: 12 }}>
          {u.expired ? t('user.expiredLabel') : t('user.expires')}: {new Date(u.meta.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
          {!u.expired && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>({formatRelativeTime(u.meta.expiresAt, t).replace(` ${t('time.ago')}`, ` ${t('time.left')}`)})</span>}
        </div>
      )}

      {/* ── Collapsible sections ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {u.devices && (
          <CollapseRow label={`${t('user.devices')} (${u.devices.approved_count}/${u.devices.limit})`} open={devOpen} onToggle={() => setDevOpen(o => !o)}>
            <div style={{ padding: '10px 12px 6px', fontSize: 11, color: 'var(--muted)' }}>
              {t('user.approvedSummary', { approved: String(u.devices.approved_count), limit: String(u.devices.limit) })}
              {u.devices.pending_count > 0 && <span style={{ marginLeft: 8, color: 'var(--yellow)' }}>· {t('user.pendingShort', { count: String(u.devices.pending_count) })}</span>}
              {u.devices.rejected_count > 0 && <span style={{ marginLeft: 8, color: 'var(--red)' }}>· {t('user.blockedShort', { count: String(u.devices.rejected_count) })}</span>}
            </div>

            {u.devices.pending_info.length > 0 && (
              <div>
                <div style={{ padding: '6px 12px', fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--amber)' }}>
                  {t('user.pendingDevices')}
                </div>
                {u.devices.pending_info.map((info) => (
                  <DeviceListRow
                    key={`pending-${info.ip}`}
                    info={info}
                    u={u}
                    tone="pending"
                    currentIp={lastIp?.ip ?? null}
                    actions={
                      <>
                        <Btn small variant="default" style={{ borderColor: 'rgba(57,211,83,0.3)', color: 'var(--green)' }} onClick={() => void approveIp(info.ip)}>
                          {u.devices.approved_count >= u.devices.limit ? t('device.replace') : t('device.approve')}
                        </Btn>
                        <Btn small variant="default" style={{ borderColor: 'rgba(255,68,68,.3)', color: 'var(--red)' }} onClick={() => void rejectIp(info.ip)}>
                          {t('device.reject')}
                        </Btn>
                      </>
                    }
                  />
                ))}
              </div>
            )}

            {u.devices.approved_info.length > 0 && (
              <div>
                <div style={{ padding: '10px 12px 6px', fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--green)' }}>
                  {t('user.approvedDevices')}
                </div>
                {u.devices.approved_info.map((info) => (
                  <DeviceListRow
                    key={`approved-${info.ip}`}
                    info={info}
                    u={u}
                    tone="approved"
                    currentIp={lastIp?.ip ?? null}
                    actions={
                      <Btn small variant="default" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }} onClick={() => void clearIp(info.ip)}>
                        {t('device.clear')}
                      </Btn>
                    }
                  />
                ))}
              </div>
            )}

            {u.devices.rejected_info.length > 0 && (
              <div>
                <div style={{ padding: '10px 12px 6px', fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--red)' }}>
                  {t('user.blockedDevices')}
                </div>
                {u.devices.rejected_info.map((info) => (
                  <DeviceListRow
                    key={`blocked-${info.ip}`}
                    info={info}
                    u={u}
                    tone="blocked"
                    currentIp={lastIp?.ip ?? null}
                    actions={
                      <Btn small variant="default" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }} onClick={() => void clearIp(info.ip)}>
                        {t('device.clear')}
                      </Btn>
                    }
                  />
                ))}
              </div>
            )}

            {u.devices.approved_info.length === 0 && u.devices.pending_info.length === 0 && u.devices.rejected_info.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--muted)' }}>
                {t('user.noDevicesListed')}
              </div>
            )}
          </CollapseRow>
        )}


        {u.sessions.length > 0 && (
          <CollapseRow label={`${t('user.sessions')} (${u.sessions.length})`} open={sessOpen} onToggle={() => setSessOpen(o => !o)}>
            <div style={{ maxHeight: 130, overflowY: 'auto' }}>
              {u.sessions.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 14px', fontSize: 10, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--muted)' }}>
                    {new Date(s.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>{s.durMin}{t('user.minShort')} · {s.conns} {t('user.connShort')}</span>
                </div>
              ))}
            </div>
          </CollapseRow>
        )}
      </div>

      {/* ── Risk footer ── */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' as const, letterSpacing: 1.5 }}>{t('user.riskLevel').toUpperCase()}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: riskColor, padding: '2px 10px',
          borderRadius: 6, border: `1px solid ${riskColor}44`, background: `${riskColor}14`,
        }}>
          {riskLevel}
        </span>
        {riskCode !== 'low' && riskFactors[0] && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{riskFactors[0]}</span>
        )}
      </div>

      {qrOpen && <QrModal email={u.email} uuid={u.uuid} onClose={() => setQrOpen(false)} />}
    </div>
  );
}
