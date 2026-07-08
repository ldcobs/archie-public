'use client';

import { useState, Fragment } from 'react';
import { IconBrandWindows, IconBrandApple, IconBrandAndroid, IconTerminal2, IconExternalLink, IconCheck, IconX, IconMinus, IconQuestionMark } from '@tabler/icons-react';
import { CLIENT_MATRIX, MATRIX_PROTOCOLS, type SupportTier, type Platform } from '@/lib/client-matrix';
import { PROTOCOL_BY_KEY } from '@/lib/protocol-catalog';

const PLATFORM_META: Record<Platform, { label: string; Icon: React.ComponentType<{ size?: number; stroke?: number }> }> = {
  ios:     { label: 'iOS',     Icon: IconBrandApple },
  android: { label: 'Android', Icon: IconBrandAndroid },
  windows: { label: 'Windows', Icon: IconBrandWindows },
  mac:     { label: 'macOS',   Icon: IconBrandApple },
  linux:   { label: 'Linux',   Icon: IconTerminal2 },
};

const ALL_PLATFORMS: Platform[] = ['ios', 'android', 'windows', 'mac', 'linux'];

function TierBadge({ tier, note }: { tier: SupportTier; note?: string }) {
  const cfg: Record<SupportTier, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
    full:    { icon: <IconCheck size={13} stroke={2.5} />,        bg: 'var(--green-dim)',           color: 'var(--green)',      label: 'Supported' },
    partial: { icon: <IconMinus size={13} stroke={2.5} />,        bg: 'var(--amber-dim)',           color: 'var(--amber)',      label: 'Partial' },
    no:      { icon: <IconX size={13} stroke={2.5} />,            bg: 'var(--red-dim)',             color: 'var(--red)',        label: 'Not supported' },
    unknown: { icon: <IconQuestionMark size={13} stroke={2.5} />, bg: 'rgba(130,140,160,0.12)',     color: 'var(--text-faint)', label: 'Unknown' },
  };
  const { icon, bg, color, label } = cfg[tier];
  return (
    <div title={note ?? label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, background: bg, color, cursor: note ? 'help' : 'default', flexShrink: 0 }}>
      {icon}
    </div>
  );
}

function PlatformChip({ platform, active }: { platform: Platform; active: boolean }) {
  const { Icon, label } = PLATFORM_META[platform];
  return (
    <div title={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 5, background: active ? 'var(--accent-dim)' : 'transparent', color: active ? 'var(--accent)' : 'rgba(130,140,160,0.3)' }}>
      <Icon size={14} stroke={1.8} />
    </div>
  );
}

export default function ClientsPageClient() {
  const [filterPlatform, setFilterPlatform] = useState<Platform | 'all'>('all');
  const [filterProto, setFilterProto]       = useState<string>('all');
  const [expandedId, setExpandedId]         = useState<string | null>(null);

  const visibleClients = CLIENT_MATRIX.filter(c =>
    filterPlatform === 'all' || c.platforms.includes(filterPlatform as Platform)
  ).filter(c =>
    filterProto === 'all' || c.protocols[filterProto] === 'full' || c.protocols[filterProto] === 'partial'
  );

  const visibleProtocols = filterProto === 'all'
    ? MATRIX_PROTOCOLS
    : MATRIX_PROTOCOLS.filter(p => p === filterProto);

  return (
    <div style={{ padding: '20px 24px 40px' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-bright)', margin: 0, marginBottom: 4 }}>
          Client Compatibility
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
          Which VPN apps support which protocols, per platform. The same matrix drives the invite/onboarding
          app picker. Availability badges note regional App Store availability — informational only, never used to block a user.
        </p>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        {/* Platform filter */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platform</span>
          {(['all', ...ALL_PLATFORMS] as const).map(p => {
            const active = filterPlatform === p;
            if (p === 'all') return (
              <button key="all" onClick={() => setFilterPlatform('all')} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--text-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>All</button>
            );
            const { Icon, label } = PLATFORM_META[p];
            return (
              <button key={p} onClick={() => setFilterPlatform(p)} title={label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--text-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <Icon size={13} stroke={1.8} />{label}
              </button>
            );
          })}
        </div>

        {/* Protocol filter */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Protocol</span>
          <select
            value={filterProto}
            onChange={e => setFilterProto(e.target.value)}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-bright)', fontSize: 12, cursor: 'pointer', outline: 'none' }}
          >
            <option value="all">All protocols</option>
            {MATRIX_PROTOCOLS.map(pk => (
              <option key={pk} value={pk}>{PROTOCOL_BY_KEY[pk]?.name ?? pk}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {([['full','Supported'], ['partial','Partial / needs config'], ['no','Not supported'], ['unknown','Untested']] as const).map(([tier, label]) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <TierBadge tier={tier as SupportTier} />
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Cards ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleClients.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>
            No clients match the current filters.
          </div>
        )}
        {visibleClients.map(client => {
          const expanded = expandedId === client.id;
          return (
            <div key={client.id} style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
              {/* Card header */}
              <div
                onClick={() => setExpandedId(expanded ? null : client.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>{client.name}</span>
                    <a
                      href={client.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
                    >
                      <IconExternalLink size={13} stroke={1.8} />
                    </a>
                    {client.recommended && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'var(--green-dim)', borderRadius: 4, padding: '1px 6px' }}>★ Recommended</span>
                    )}
                    {client.availability?.regional && (
                      <span
                        title={`Regional App Store availability: ${client.availability.regional}`}
                        style={{
                          fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px',
                          color: client.availability.regional === 'available' ? 'var(--green)' : client.availability.regional === 'removed' ? 'var(--red)' : 'var(--amber)',
                          background: client.availability.regional === 'available' ? 'var(--green-dim)' : client.availability.regional === 'removed' ? 'var(--red-dim)' : 'var(--amber-dim)',
                        }}
                      >
                        Stores: {client.availability.regional}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {ALL_PLATFORMS.map(p => <PlatformChip key={p} platform={p} active={client.platforms.includes(p)} />)}
                  </div>
                </div>

                {/* Quick summary dots */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 280, justifyContent: 'flex-end' }}>
                  {MATRIX_PROTOCOLS.slice(0, 8).map(pk => (
                    <TierBadge key={pk} tier={client.protocols[pk] ?? 'unknown'} note={PROTOCOL_BY_KEY[pk]?.name} />
                  ))}
                </div>

                <div style={{ fontSize: 18, color: 'var(--text-faint)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</div>
              </div>

              {/* Expanded protocol table */}
              {expanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 18px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px', alignItems: 'center' }}>
                    {visibleProtocols.map(pk => {
                      const proto = PROTOCOL_BY_KEY[pk];
                      const tier  = client.protocols[pk] ?? 'unknown';
                      const note  = client.notes?.[pk];
                      return (
                        <Fragment key={pk}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-bright)', whiteSpace: 'nowrap' }}>{proto?.name ?? pk}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proto?.desc}</span>
                            {note && <span style={{ fontSize: 11, color: 'var(--amber)', flexShrink: 0 }}>— {note}</span>}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <TierBadge tier={tier} />
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer note ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 28, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-bright)' }}>Recommended for most users:</strong> Hiddify or sing-box (all platforms) — both support every protocol and import subscription URLs directly.
        <strong style={{ color: 'var(--text-bright)' }}> If an app is unavailable in your region:</strong> avoVPN (iOS, currently available, VLESS/VMess), AmneziaWG / WireGuard (config import), and Amnezia VPN are compatible alternatives — do not depend on any single app, since App Store availability changes.
      </div>
    </div>
  );
}
