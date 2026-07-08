'use client';
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { apiUrl } from '@/lib/api-path';
import { serverConfig } from '@/lib/server-config';
import { useI18n } from '@/lib/i18n';

const PRESETS = [
  { id: 'standard',    label: 'Standard',    desc: 'Fastest default. Best for modern clients on normal networks.',          protocols: ['vless-reality'] },
  { id: 'compatible',  label: 'Compatible',  desc: 'Adds fallback options for mixed or older client apps.',                 protocols: ['vless-reality', 'vmess-ws-tls'] },
  { id: 'universal',   label: 'Universal',   desc: 'Broadest coverage across client apps and network conditions.',          protocols: ['vless-reality', 'vmess-ws-tls', 'trojan-tls'] },
  { id: 'performance', label: 'Performance', desc: 'Optimized for speed and low latency on strong networks.',              protocols: ['vless-reality', 'hysteria2', 'wireguard'] },
  { id: 'cdn-safe',    label: 'CDN Safe',    desc: 'Best for restrictive networks and CDN-routed traffic.',                protocols: ['vless-ws-tls', 'vless-grpc-tls'] },
  { id: 'legacy',      label: 'Legacy',      desc: 'For older apps and maximum backward compatibility.',                   protocols: ['vmess-ws-tls', 'vmess-grpc-tls', 'shadowsocks'] },
  { id: 'custom',      label: 'Custom',      desc: 'Manually select protocols for a one-off bundle.',                      protocols: [] as string[] },
];

const ALL_PROTOCOLS = [
  { key: 'vless-reality',     label: 'VLESS Reality',    color: '#00d4ff' },
  { key: 'vless-ws-tls',      label: 'VLESS WS',         color: '#4e9eff' },
  { key: 'vless-grpc-tls',    label: 'VLESS gRPC',       color: '#4e9eff' },
  { key: 'vless-xhttp-tls',   label: 'VLESS XHTTP',      color: '#4e9eff' },
  { key: 'vless-httpupgrade', label: 'HTTPUpgrade',      color: '#4e9eff' },
  { key: 'vmess-ws-tls',      label: 'VMess WS',         color: '#4e9eff' },
  { key: 'vmess-grpc-tls',    label: 'VMess gRPC',       color: '#4e9eff' },
  { key: 'trojan-tls',        label: 'Trojan TLS',       color: '#b57bff' },
  { key: 'trojan-ws-tls',     label: 'Trojan WS',        color: '#b57bff' },
  { key: 'shadowsocks',       label: 'Shadowsocks',      color: '#ffb347' },
  { key: 'hysteria2',         label: 'Hysteria2',        color: '#3ddc84' },
  { key: 'wireguard',         label: 'WireGuard',        color: '#57c7b8' },
];

const fs: React.CSSProperties = { width: '100%', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '8px 10px', color: '#eef3f8', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
function FL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(180,195,215,0.45)', marginBottom: 5, textTransform: 'uppercase' }}>{children}</div>;
}

export default function NewKeyPanel({ groups, onClose, onCreated }: { groups: string[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Always offer Ungrouped (the catch-all) and default to it — never force the
  // operator to pick, and never default to an arbitrary existing group.
  const groupOptions = Array.from(new Set(['Ungrouped', ...groups]));
  const [group, setGroup] = useState('Ungrouped');
  const [customGroup, setCustomGroup] = useState('');
  const [preset, setPreset] = useState('standard');
  const [protocols, setProtocols] = useState<string[]>(['vless-reality']);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ email: string; uuid: string } | null>(null);
  const [copiedSub, setCopiedSub] = useState(false);

  function selectPreset(id: string) {
    setPreset(id);
    const p = PRESETS.find(x => x.id === id);
    if (p && p.protocols.length > 0) setProtocols([...p.protocols]);
  }

  function toggleProtocol(key: string) {
    setProtocols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    setPreset('custom');
  }

  async function create() {
    if (!email) { setError(t('keys.errKeyRequired')); return; }
    if (protocols.length === 0) { setError(t('keys.errProtocolRequired')); return; }
    setCreating(true); setError('');
    const finalGroup = group === '__new__' ? customGroup : (group || 'Ungrouped');
    const r = await fetch(apiUrl('/api/users'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName: displayName || email, group: finalGroup, protocols }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error ?? 'Failed'); }
    else { setResult({ email: d.email, uuid: d.uuid }); }
    setCreating(false);
  }

  if (result) {
    const subUrl = `${serverConfig.publicBaseUrl}/api/sub/${result.uuid}`;
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(74,108,149,0.2)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#22dd88', textTransform: 'uppercase' }}>{t('keys.keyCreated')}</div>
          <button onClick={onCreated} style={{ background: 'none', border: 'none', color: 'rgba(180,195,215,0.4)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.45)', marginBottom: 3, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>{t('keys.fieldKeyNameLabel')}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8f5', fontFamily: 'monospace' }}>{result.email}</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.45)', marginBottom: 5, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>{t('keys.fieldSubUrl')}</div>
          <div onClick={() => { copyText(subUrl).then(() => { setCopiedSub(true); setTimeout(() => setCopiedSub(false), 1500); }); }} style={{ fontSize: 10, color: copiedSub ? '#22dd88' : 'rgba(180,195,215,0.6)', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.2)', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', cursor: 'pointer', wordBreak: 'break-all', marginBottom: 8 }}>
            {copiedSub ? t('keys.copiedSub') : subUrl}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(180,195,215,0.4)' }}>{t('keys.subUrlHint')}</div>
        </div>
        <div style={{ marginBottom: 14, padding: '8px 10px', background: 'rgba(34,221,136,0.06)', border: '1px solid rgba(34,221,136,0.15)', borderRadius: 6, fontSize: 11, color: 'rgba(34,221,136,0.7)' }}>
          {t('keys.keyActive60s')}
        </div>
        <button onClick={onCreated} style={{ width: '100%', background: '#00d4ff', color: '#041019', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{t('keys.done')}</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(74,108,149,0.2)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#00d4ff', textTransform: 'uppercase' }}>{t('keys.newVpnKey')}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(180,195,215,0.4)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
      </div>
      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,77,90,0.1)', color: '#ff7d86', fontSize: 12 }}>{error}</div>}

      <FL>{t('keys.fieldKeyNameShort')}</FL>
      <input value={email} onChange={e => setEmail(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="e.g. alex" style={fs} />

      <FL>{t('keys.fieldDisplayNameOpt')}</FL>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Alex Rivera" style={fs} />

      <FL>{t('keys.fieldGroup2')}</FL>
      <select value={group} onChange={e => setGroup(e.target.value)} style={{ ...fs }}>
        {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
        <option value="__new__">{t('keys.newGroupOption')}</option>
      </select>
      {group === '__new__' && <input value={customGroup} onChange={e => setCustomGroup(e.target.value)} placeholder={t('keys.newGroupName')} style={fs} />}

      <FL>{t('keys.fieldProtocolPreset')}</FL>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => selectPreset(p.id)} style={{
            background: preset === p.id ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
            color: preset === p.id ? '#00d4ff' : 'rgba(180,195,215,0.55)',
            border: `1px solid ${preset === p.id ? 'rgba(0,212,255,0.3)' : 'rgba(74,108,149,0.2)'}`,
            borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{p.label}</button>
        ))}
      </div>
      {(() => { const p = PRESETS.find(x => x.id === preset); return p?.desc ? <div style={{ fontSize: 10, color: 'rgba(180,195,215,0.35)', marginBottom: 10, lineHeight: 1.4 }}>{p.desc}</div> : null; })()}

      <FL>{t('keys.fieldProtocols', { n: String(protocols.length) })}</FL>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
        {ALL_PROTOCOLS.map(({ key, label, color }) => {
          const on = protocols.includes(key);
          return (
            <div key={key} onClick={() => toggleProtocol(key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: on ? `${color}10` : 'transparent', border: `1px solid ${on ? `${color}30` : 'transparent'}` }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${on ? color : 'rgba(74,108,149,0.4)'}`, background: on ? color : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {on && <div style={{ width: 6, height: 6, background: '#000', borderRadius: 1 }} />}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: on ? color : 'rgba(180,195,215,0.5)' }}>{label}</span>
            </div>
          );
        })}
      </div>

      <button onClick={create} disabled={creating} style={{ width: '100%', background: creating ? 'rgba(0,212,255,0.4)' : '#00d4ff', color: '#041019', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 11, fontWeight: 800, cursor: creating ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        {creating ? t('keys.creating') : t('keys.createKey')}
      </button>
    </div>
  );
}
