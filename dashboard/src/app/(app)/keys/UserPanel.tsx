'use client';
import { useState, useEffect, useCallback } from 'react';
import { copyText } from '@/lib/clipboard';
import { apiUrl } from '@/lib/api-path';
import { serverConfig } from '@/lib/server-config';
import { useI18n } from '@/lib/i18n';
import type { UserStat } from '@/lib/types';
import { DeviceChip } from '@/components/DeviceChip';

const PROTO_COLOR: Record<string, string> = {
  'vless-reality': '#00d4ff', 'vless-reality-vision': '#00d4ff',
  'vless-ws-tls': '#4e9eff', 'vless-grpc-tls': '#4e9eff',
  'vless-xhttp-tls': '#4e9eff', 'vless-httpupgrade': '#4e9eff',
  'vmess-ws-tls': '#4e9eff', 'vmess-grpc-tls': '#4e9eff',
  'trojan-tls': '#b57bff', 'trojan-ws': '#b57bff',
  'shadowsocks': '#ffb347', 'hysteria2': '#3ddc84', 'wireguard': '#57c7b8',
};
function pc(k: string) { return PROTO_COLOR[k] ?? 'rgba(180,195,215,0.4)'; }
function pl(k: string) {
  return ({ 'vless-reality': 'Reality', 'vless-reality-vision': 'Reality+', 'vless-ws-tls': 'VLESS WS', 'vless-grpc-tls': 'VLESS gRPC', 'vless-xhttp-tls': 'XHTTP', 'vless-httpupgrade': 'HTTPUpgrade', 'vmess-ws-tls': 'VMess WS', 'vmess-grpc-tls': 'VMess gRPC', 'trojan-tls': 'Trojan', 'trojan-ws': 'Trojan WS', 'shadowsocks': 'SS', 'hysteria2': 'HY2', 'wireguard': 'WG' } as Record<string, string>)[k] ?? k;
}
function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

const fs: React.CSSProperties = { width: '100%', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '8px 10px', color: '#eef3f8', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
function FL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(180,195,215,0.45)', marginBottom: 5, textTransform: 'uppercase' }}>{children}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, color: 'rgba(180,195,215,0.35)' }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: 'rgba(180,195,215,0.5)', textTransform: 'uppercase' }}>{title}</span>
      </button>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

export default function UserPanel({ stat, onClose, onRefresh }: { stat: UserStat; onClose: () => void; onRefresh: () => void }) {
  const { t } = useI18n();
  const meta = stat.meta;
  const [displayName, setDisplayName] = useState(meta?.displayName ?? stat.email);
  const [group, setGroup] = useState(meta?.group ?? 'Ungrouped');
  const [notes, setNotes] = useState(meta?.notes ?? '');
  const [expiresAt, setExpiresAt] = useState(meta?.expiresAt?.slice(0, 10) ?? '');
  const [trafficLimitGB, setTrafficLimitGB] = useState(String(meta?.trafficLimitGB ?? 0));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [subFormat, setSubFormat] = useState<'raw' | 'clash' | 'singbox'>('raw');
  const [uris, setUris] = useState<{ protocol: string; label: string; uri: string }[]>([]);
  // Gateway routing
  const [gateways, setGateways] = useState<{ tag: string; name: string; flag?: string }[]>([]);
  const [currentGw, setCurrentGw] = useState<string>('');
  const [selectedGw, setSelectedGw] = useState<string>('');
  const [gwApplying, setGwApplying] = useState(false);
  const [gwResult, setGwResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copiedUri, setCopiedUri] = useState<string | null>(null);
  const [trafficRows, setTrafficRows] = useState<{ day: string; upload: number; download: number }[]>([]);

  const baseSubUrl = `${serverConfig.publicBaseUrl}/api/sub/${stat.uuid}`;
  const subUrl = subFormat === 'raw' ? baseSubUrl : `${baseSubUrl}?format=${subFormat}`;
  const qrSubUrl = apiUrl(`/api/qr/${encodeURIComponent(stat.email)}?sub=1`);
  const emailKey = stat.email.split('@')[0] || stat.email;

  useEffect(() => {
    fetch(apiUrl(`/api/keys/${stat.uuid}/uris`))
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.uris)) setUris(d.uris); })
      .catch(() => {});
    fetch(apiUrl(`/api/traffic?email=${encodeURIComponent(emailKey)}&days=30`))
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.rows)) setTrafficRows(d.rows); })
      .catch(() => {});
    fetch(apiUrl('/api/gateways'))
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.gateways)) setGateways(d.gateways);
        const assignment = d.user_assignments?.[stat.email] ?? '';
        setCurrentGw(assignment);
        setSelectedGw(assignment);
      })
      .catch(() => {});
  }, [stat.uuid, emailKey, stat.email]);

  const statusColor = stat.status === 'online' ? '#22dd88' : stat.status === 'recent' ? '#ffb347' : 'rgba(180,195,215,0.3)';

  async function save() {
    setSaving(true); setError('');
    const r = await fetch(apiUrl(`/api/meta/${stat.uuid}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, group, notes, expiresAt: expiresAt || null, trafficLimitGB: Number(trafficLimitGB) }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Save failed'); }
    else onRefresh();
    setSaving(false);
  }

  async function applyGateway() {
    setGwApplying(true); setGwResult(null);
    const email = stat.email;
    let res: { ok: boolean; error?: string };
    if (selectedGw) {
      const r = await fetch(apiUrl(`/api/gateways/${selectedGw}/assign`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      res = await r.json().catch(() => ({ ok: false }));
    } else {
      const r = await fetch(apiUrl(`/api/gateways/${currentGw || '_'}/unassign`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      res = await r.json().catch(() => ({ ok: false }));
    }
    setGwApplying(false);
    if (res.ok) { setCurrentGw(selectedGw); setGwResult({ ok: true, msg: 'Applied — Xray restarted' }); }
    else setGwResult({ ok: false, msg: res.error ?? 'Failed' });
  }

  async function del() {
    if (!confirm(`Delete key ${stat.email}? This removes the user from Xray config.`)) return;
    setDeleting(true);
    const r = await fetch(apiUrl(`/api/users/${encodeURIComponent(stat.email)}`), { method: 'DELETE' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? 'Delete failed'); setDeleting(false); }
    else { onRefresh(); onClose(); }
  }

  const onDeviceAction = useCallback(() => { onRefresh(); }, [onRefresh]);

  function copy(text: string, key: string) {
    copyText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); });
  }

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(74,108,149,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, boxShadow: stat.status === 'online' ? '0 0 6px #22dd88' : 'none' }} />
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#00d4ff', textTransform: 'uppercase' }}>{t('keys.panelVpnKey')}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(180,195,215,0.4)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
      </div>

      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,77,90,0.1)', color: '#ff7d86', fontSize: 12 }}>{error}</div>}

      {/* Identity */}
      <Section title={t('keys.sectionIdentity')}>
        <FL>{t('keys.fieldDisplayName')}</FL>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fs} />
        <FL>{t('keys.fieldGroup')}</FL>
        <input value={group} onChange={e => setGroup(e.target.value)} style={fs} />
        <FL>{t('keys.fieldKeyName')}</FL>
        <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.6)', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.2)', borderRadius: 7, padding: '8px 10px', marginBottom: 12, fontFamily: 'monospace' }}>{stat.email}</div>
        <FL>{t('keys.fieldUUID')}</FL>
        <div onClick={() => copy(stat.uuid, 'uuid')} title="Click to copy" style={{ fontSize: 10, color: copied === 'uuid' ? '#22dd88' : 'rgba(180,195,215,0.45)', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.2)', borderRadius: 7, padding: '7px 10px', marginBottom: 12, fontFamily: 'monospace', cursor: 'pointer', wordBreak: 'break-all' }}>
          {copied === 'uuid' ? '✓ Copied' : stat.uuid}
        </div>
      </Section>

      {/* Subscription */}
      <Section title={`${t('keys.sectionSubscription')}${meta?.subFetchCount ? ` · ${t('keys.subFetchCount', { n: String(meta.subFetchCount) })}` : ''}`}>
        {/* Format tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {([
            { key: 'raw',     label: 'Raw',     hint: 'v2rayN · Hiddify · Shadowrocket · NekoBox' },
            { key: 'clash',   label: 'Clash',   hint: 'Mihomo · Stash · Surge · Loon' },
            { key: 'singbox', label: 'SingBox', hint: 'sing-box · NekoBox · Hiddify (SB)' },
          ] as const).map(({ key, label, hint }) => (
            <button
              key={key}
              onClick={() => setSubFormat(key)}
              title={hint}
              style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                borderRadius: 5, cursor: 'pointer', border: '1px solid',
                background: subFormat === key ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
                borderColor: subFormat === key ? 'rgba(0,212,255,0.3)' : 'rgba(74,108,149,0.2)',
                color: subFormat === key ? '#00d4ff' : 'rgba(180,195,215,0.45)',
              }}
            >{label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowQr(q => !q)} title="Toggle QR code for current URL" style={{ background: showQr ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showQr ? 'rgba(0,212,255,0.25)' : 'rgba(74,108,149,0.2)'}`, borderRadius: 5, padding: '4px 10px', cursor: 'pointer', color: showQr ? '#00d4ff' : 'rgba(180,195,215,0.5)', fontSize: 13 }}>⬛</button>
        </div>

        {/* Format hint */}
        <div style={{ fontSize: 9.5, color: 'rgba(180,195,215,0.3)', marginBottom: 6, letterSpacing: 0.3 }}>
          {subFormat === 'raw' && 'Universal base64 list · paste into any client'}
          {subFormat === 'clash' && 'Clash.Meta YAML · requires Mihomo fork for VLESS/Reality'}
          {subFormat === 'singbox' && 'sing-box JSON · full config with TUN + auto-select'}
        </div>

        {/* Sub URL row */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <div onClick={() => copy(subUrl, 'sub')} title="Click to copy subscription URL" style={{ flex: 1, fontSize: 10, color: copied === 'sub' ? '#22dd88' : 'rgba(180,195,215,0.5)', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.2)', borderRadius: 6, padding: '7px 10px', fontFamily: 'monospace', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {copied === 'sub' ? '✓ Copied' : subUrl}
          </div>
        </div>

        {/* QR code */}
        {showQr && (
          <div style={{ marginBottom: 10, textAlign: 'center', background: '#fff', borderRadius: 8, padding: 8, display: 'inline-block' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSubUrl} alt="Subscription QR" width={180} height={180} style={{ display: 'block' }} />
          </div>
        )}

        {/* Client info */}
        {meta?.detectedClient && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'rgba(180,195,215,0.6)', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#dce8f5' }}>{meta.detectedClient}</span>
            <span style={{ color: 'rgba(180,195,215,0.3)' }}>·</span>
            <span>{meta.subFetchCount} {meta.subFetchCount !== 1 ? t('keys.fetchCounts') : t('keys.fetchCount')}</span>
            {meta.lastSubFetch && (
              <>
                <span style={{ color: 'rgba(180,195,215,0.3)' }}>·</span>
                <span>{t('keys.lastSubFetch')} {new Date(meta.lastSubFetch).toLocaleString()}</span>
              </>
            )}
          </div>
        )}
        {meta?.detectedClient === 'Unknown' && meta.detectedClientRaw && (
          <div style={{ fontSize: 9, color: 'rgba(180,195,215,0.25)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>{meta.detectedClientRaw.slice(0, 80)}</div>
        )}
        {!meta?.detectedClient && (
          <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.3)' }}>{t('keys.neverFetched')}</div>
        )}
      </Section>

      {/* Traffic history */}
      {trafficRows.length > 0 && (() => {
        const totalUp   = trafficRows.reduce((s, r) => s + r.upload, 0);
        const totalDown = trafficRows.reduce((s, r) => s + r.download, 0);
        const recent    = trafficRows.slice(-7);
        const peakDay   = [...trafficRows].sort((a, b) => (b.upload + b.download) - (a.upload + a.download))[0];
        return (
          <Section title={`Usage · last 30d`}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              {[
                { label: 'Total ↑', val: totalUp },
                { label: 'Total ↓', val: totalDown },
                { label: 'Combined', val: totalUp + totalDown },
              ].map(({ label, val }) => (
                <div key={label} style={{ flex: 1, background: '#0a0f18', border: '1px solid rgba(74,108,149,0.2)', borderRadius: 6, padding: '7px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: 'rgba(180,195,215,0.4)', marginBottom: 3, letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#dce8f5' }}>{fmtBytes(val)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(180,195,215,0.3)', marginBottom: 6 }}>
              Last 7 days · peak {peakDay.day.slice(5)}: {fmtBytes(peakDay.upload + peakDay.download)}
            </div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 36 }}>
              {recent.map(r => {
                const total = r.upload + r.download;
                const max   = Math.max(...recent.map(x => x.upload + x.download), 1);
                const h     = Math.max(2, Math.round((total / max) * 34));
                return (
                  <div key={r.day} title={`${r.day.slice(5)}: ${fmtBytes(total)}`} style={{ flex: 1, height: h, background: 'rgba(0,212,255,0.35)', borderRadius: '2px 2px 0 0', cursor: 'default' }} />
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 8.5, color: 'rgba(180,195,215,0.25)' }}>
              <span>{recent[0]?.day.slice(5)}</span>
              <span>{recent[recent.length - 1]?.day.slice(5)}</span>
            </div>
          </Section>
        );
      })()}

      {/* Devices */}
      {(() => {
        const activeIps = new Set((stat.ips ?? []).map(x => x.ip));
        const approved = (stat.devices?.approved_info ?? []).map(ip => ({ ip, status: 'approved' as const, activeNow: activeIps.has(ip.ip) }));
        const pending  = (stat.devices?.pending_info  ?? []).map(ip => ({ ip, status: 'pending'  as const, activeNow: false }));
        const blocked  = (stat.devices?.rejected_info ?? []).map(ip => ({ ip, status: 'blocked'  as const, activeNow: false }));
        const all = [...approved, ...pending, ...blocked];
        const limit = meta?.connectionLimit ?? 0;
        const overLimit = limit > 0 && activeIps.size > limit;
        const title = `Devices${limit > 0 ? ` · ${activeIps.size}/${limit}` : all.length > 0 ? ` · ${all.length}` : ''}`;
        return (
          <Section title={title}>
            {all.length === 0 ? (
              <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.3)', marginBottom: 8 }}>No known devices</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {all.map(({ ip, status, activeNow }) => (
                  <DeviceChip key={`${status}-${ip.ip}`} ip={ip} status={status} activeNow={activeNow} email={stat.email} onDone={onDeviceAction} />
                ))}
              </div>
            )}
            {overLimit && (
              <div style={{ fontSize: 10, color: '#ff6060', fontWeight: 700, marginTop: 4 }}>
                ⚠ Over connection limit ({activeIps.size} active, limit {limit})
              </div>
            )}
            {pending.length > 0 && (
              <div style={{ fontSize: 10, color: '#f0a500', marginTop: 4 }}>
                {pending.length} device{pending.length > 1 ? 's' : ''} waiting for approval — click to approve or reject
              </div>
            )}
          </Section>
        );
      })()}

      {/* Protocols */}
      <Section title={t('keys.sectionProtocols')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {(meta?.protocols ?? []).map(p => (
            <span key={p} style={{ fontSize: 10, fontWeight: 700, color: pc(p), background: `${pc(p)}18`, border: `1px solid ${pc(p)}33`, borderRadius: 4, padding: '3px 8px' }}>{pl(p)}</span>
          ))}
          {(meta?.protocols ?? []).length === 0 && <span style={{ fontSize: 11, color: 'rgba(180,195,215,0.3)' }}>{t('keys.noProtocol')}</span>}
        </div>
      </Section>

      {/* Connection keys */}
      <Section title={t('keys.sectionConnKeys', { n: String(uris.length) })}>
        {uris.length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.3)', marginBottom: 8 }}>{t('keys.loading')}</div>
        )}
        {uris.map(u => (
          <div key={u.protocol} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: pc(u.protocol), background: `${pc(u.protocol)}18`, border: `1px solid ${pc(u.protocol)}33`, borderRadius: 3, padding: '2px 7px' }}>{u.label}</span>
              <button
                onClick={() => { copyText(u.uri).then(() => { setCopiedUri(u.protocol); setTimeout(() => setCopiedUri(null), 1500); }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: copiedUri === u.protocol ? '#22dd88' : 'rgba(180,195,215,0.4)', padding: '2px 6px' }}
              >
                {copiedUri === u.protocol ? t('keys.copiedShort') : t('keys.copy')}
              </button>
            </div>
            <div style={{ fontSize: 9.5, color: 'rgba(180,195,215,0.4)', fontFamily: 'monospace', wordBreak: 'break-all', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.15)', borderRadius: 5, padding: '6px 8px', lineHeight: 1.5, userSelect: 'all' }}>
              {u.uri}
            </div>
          </div>
        ))}
      </Section>

      {/* Traffic */}
      <Section title={t('keys.sectionTraffic')}>
        {stat.traffic ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[['↑ Up', fmtBytes(stat.traffic.up)], ['↓ Down', fmtBytes(stat.traffic.down)], ['Σ Total', fmtBytes(stat.traffic.total)]].map(([l, v]) => (
              <div key={l} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.4)' }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8f5', marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.3)', marginBottom: 8 }}>{t('keys.noTraffic')}</div>}
        <FL>{t('keys.fieldTrafficLimit')}</FL>
        <input type="number" min={0} value={trafficLimitGB} onChange={e => setTrafficLimitGB(e.target.value)} style={fs} />
      </Section>

      {/* Activity */}
      <Section title={t('keys.sectionActivity')}>
        <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.5)', marginBottom: 6 }}>
          {t('keys.lastSeen')} <span style={{ color: '#dce8f5' }}>{stat.last_seen ? new Date(stat.last_seen).toLocaleString() : '—'}</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.5)', marginBottom: 8 }}>
          {t('keys.connections24h')} <span style={{ color: '#dce8f5' }}>{stat.conns_24h}</span>
        </div>
        {stat.ips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {stat.ips.slice(0, 4).map((ip, idx) => (
              <div key={`${ip.ip}-${idx}`} style={{ fontSize: 10, color: 'rgba(180,195,215,0.6)', display: 'flex', gap: 6 }}>
                <span>{ip.flag}</span>
                <span style={{ fontFamily: 'monospace' }}>{ip.ip}</span>
                <span style={{ color: 'rgba(180,195,215,0.35)' }}>{ip.city}, {ip.cc} · {ip.isp}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Limits & expiry */}
      <Section title={t('keys.sectionLimits')}>
        <FL>{t('keys.fieldExpiry')}</FL>
        <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={fs} />
        {stat.expired && <div style={{ fontSize: 11, color: '#ff6b75', marginBottom: 8 }}>{t('keys.keyExpiredWarn')} {stat.expiredReason}</div>}
      </Section>

      {/* Notes */}
      <Section title={t('keys.sectionNotes')}>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...fs, resize: 'vertical' }} placeholder={t('keys.fieldNotes')} />
      </Section>

      {/* Devices */}
      {stat.devices && (stat.devices.approved.length + stat.devices.pending.length) > 0 && (
        <Section title={t('keys.sectionDevices', { approved: String(stat.devices.approved_count), pending: String(stat.devices.pending_count) })}>
          {stat.deviceEstimate?.ispConflict && <div style={{ fontSize: 11, color: '#ff6b75', marginBottom: 6 }}>{t('keys.ispConflict')}</div>}
          <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.35)' }}>{t('keys.pendingDevices')} {stat.devices.pending.join(', ') || t('keys.noDevices')}</div>
        </Section>
      )}

      {/* Exit Gateway */}
      {gateways.length > 0 && (
        <Section title={t('gateways.currentRoute')}>
          <FL>{t('gateways.currentRoute')}</FL>
          <select
            value={selectedGw}
            onChange={e => { setSelectedGw(e.target.value); setGwResult(null); }}
            style={fs}
          >
            <option value="">{t('gateways.direct')}</option>
            {gateways.map(g => (
              <option key={g.tag} value={g.tag}>{g.flag} {g.name}</option>
            ))}
          </select>
          {selectedGw !== currentGw && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#ffb347', marginBottom: 6 }}>⚠ {t('gateways.restartNote')}</div>
              <button
                onClick={applyGateway}
                disabled={gwApplying}
                style={{ background: '#00d4ff', color: '#041019', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: gwApplying ? 'wait' : 'pointer', fontFamily: 'inherit' }}
              >
                {gwApplying ? t('gateways.applying') : t('gateways.applyRoute')}
              </button>
            </div>
          )}
          {gwResult && (
            <div style={{ fontSize: 11, color: gwResult.ok ? '#22dd88' : '#ff6b6b', marginTop: 4 }}>
              {gwResult.ok ? '✅' : '❌'} {gwResult.msg}
            </div>
          )}
        </Section>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <button onClick={save} disabled={saving} style={{ background: saving ? 'rgba(0,212,255,0.4)' : '#00d4ff', color: '#041019', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 11, fontWeight: 800, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {saving ? t('keys.saving') : t('keys.saveChanges')}
        </button>
        <button onClick={del} disabled={deleting} style={{ background: 'rgba(255,77,90,0.08)', color: '#ff6b75', border: '1px solid rgba(255,77,90,0.2)', borderRadius: 7, padding: '9px 14px', fontSize: 11, fontWeight: 700, cursor: deleting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {deleting ? t('keys.deleting') : t('keys.deleteKey')}
        </button>
      </div>
    </div>
  );
}
