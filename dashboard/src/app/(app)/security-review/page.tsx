'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import useSWR from 'swr';
import type { Fail2banEntry, ThreatEntry, StatsResponse } from '@/lib/types';
import { apiUrl, BASE_PATH } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-client';

type PolicyMode = 'temp-ban' | 'permanent-deny';
type ThreatStatus = 'permanent' | 'temp' | 'detected';

interface SecurityResponse {
  threatWindow: '24h' | '7d';
  ssh_threats: ThreatEntry[];
  fail2ban_bans: Fail2banEntry[];
  protection_mode: PolicyMode;
}

interface SecurityThresholds {
  attemptThreshold: number;
  attemptWindowMinutes: number;
  tempBanDays: number;
  tempBanCountBeforeEscalation: number;
  repeatWindowDays: number;
  updated_at: string;
}

const fetcher = fetchJson;

type MapMarker = { left: number; top: number; size?: number };

const MAP_POSITIONS: Record<string, { left: number; top: number }> = {
  US: { left: 12.1, top: 43.2 },
  CA: { left: 13, top: 34 },
  BR: { left: 24, top: 70 },
  GB: { left: 44, top: 33 },
  BE: { left: 50.0, top: 39.2 },
  CN: { left: 81.8, top: 42.1 },
  DE: { left: 50.0, top: 39.2 },
  NL: { left: 47.3, top: 42.6 },
  RU: { left: 68, top: 27 },
  TR: { left: 56, top: 42 },
  SG: { left: 79, top: 58 },
  VN: { left: 84.0, top: 47.6 },
  JP: { left: 87, top: 43 },
};

function spreadMapMarkers(markers: Array<{ left: number; top: number }>): MapMarker[] {
  const spreadMarkers = markers.map((marker) => ({ ...marker, size: 12 }));
  const clusterRadius = 4.6;
  const separationDistance = 2.8;

  for (let i = 0; i < spreadMarkers.length; i += 1) {
    for (let j = i + 1; j < spreadMarkers.length; j += 1) {
      const first = spreadMarkers[i];
      const second = spreadMarkers[j];
      const deltaLeft = second.left - first.left;
      const deltaTop = second.top - first.top;
      const distance = Math.hypot(deltaLeft, deltaTop);

      if (distance === 0) {
        first.left -= separationDistance / 2;
        second.left += separationDistance / 2;
        first.size = 10;
        second.size = 10;
        continue;
      }

      if (distance < clusterRadius) {
        const push = (separationDistance - Math.min(distance, separationDistance)) / 2;
        const unitLeft = deltaLeft / distance;
        const unitTop = deltaTop / distance;

        first.left -= unitLeft * push;
        first.top -= unitTop * push;
        second.left += unitLeft * push;
        second.top += unitTop * push;
        first.size = 10;
        second.size = 10;
      }
    }
  }

  return spreadMarkers.map((marker) => ({
    left: Math.max(5, Math.min(95, marker.left)),
    top: Math.max(8, Math.min(92, marker.top)),
    size: marker.size,
  }));
}

function mono(size: number, weight = 700, color = 'var(--text-bright)'): CSSProperties {
  return {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: size,
    fontWeight: weight,
    color,
    letterSpacing: 0,
  };
}

function displayCaps(size: number, color = 'var(--text-bright)'): CSSProperties {
  return {
    fontFamily: 'var(--font-display), "Arial Narrow", sans-serif',
    fontSize: size,
    fontWeight: 600,
    color,
    textTransform: 'uppercase',
    letterSpacing: 1.9,
    lineHeight: 0.9,
  };
}

function labelStyle(color = 'var(--text-dim)'): CSSProperties {
  return {
    ...mono(11, 700, color),
    textTransform: 'uppercase',
    letterSpacing: 1.8,
  };
}

function statTone(status: ThreatStatus): CSSProperties {
  if (status === 'permanent') return { color: '#ff8853', background: 'rgba(255,103,82,0.12)', borderColor: 'rgba(255,103,82,0.36)' };
  if (status === 'temp') return { color: '#ffba45', background: 'rgba(255,186,69,0.12)', borderColor: 'rgba(255,186,69,0.28)' };
  return { color: '#77c6ff', background: 'rgba(74,161,255,0.10)', borderColor: 'rgba(74,161,255,0.22)' };
}

function riskTone(risk: number): string {
  if (risk >= 90) return '#ff5858';
  if (risk >= 80) return '#ff8a42';
  if (risk >= 55) return '#ffb94d';
  return '#4eb8ff';
}

function riskBars(risk: number) {
  const activeBars = Math.max(1, Math.round(risk / 20));
  const color = riskTone(risk);
  return (
    <div style={{ display: 'inline-flex', gap: 2, marginLeft: 8 }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <span
          key={index}
          style={{
            width: 7,
            height: 6,
            borderRadius: 2,
            background: index < activeBars ? color : 'rgba(76,108,150,0.28)',
          }}
        />
      ))}
    </div>
  );
}

function ShieldIcon({ color = '#25c9ff', danger = false, size = 38 }: { color?: string; danger?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5 18.5 5v5.6c0 4.32-2.46 7.76-6.5 10.05C7.96 18.36 5.5 14.92 5.5 10.6V5L12 2.5Z" stroke={color} strokeWidth="1.6" />
      {danger ? (
        <path d="m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="m9.25 12.2 1.9 1.9 3.65-4.15" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function StatShieldIcon({ color = '#ffaf35', danger = false }: { color?: string; danger?: boolean }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path
        d="M22 4.5c4.7 3 9.7 4.4 14.4 5.1v10.3c0 9-4.9 15.6-14.4 20.1C12.5 35.5 7.6 28.9 7.6 19.9V9.6C12.3 8.9 17.3 7.5 22 4.5Z"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      {danger ? (
        <path
          d="m17.2 16.7 9.6 9.6m0-9.6-9.6 9.6"
          stroke={color}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M22 14.8c2.9 0 5.2 2.4 5.2 5.2 0 1.4-.5 2.6-1.4 3.5.1.6.4 1.2 1.1 1.8.5.4.6 1 .4 1.5-.2.5-.7.8-1.2.8h-8.1c-.6 0-1.1-.3-1.3-.8-.2-.5 0-1.1.4-1.5.7-.6 1-1.2 1-1.8-.8-.9-1.4-2.1-1.4-3.5 0-2.8 2.4-5.2 5.3-5.2Z"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M20.1 19.8a1.9 1.9 0 1 1 3.8 0v2.2h-3.8v-2.2Z" fill={color} />
          <path d="M22 22v3.7" stroke="#08111b" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function UsersIcon({ color = '#a56cff' }: { color?: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke={color} strokeWidth="1.6" />
      <path d="M3.5 19a4.5 4.5 0 0 1 9 0m1.5-1.5a3.5 3.5 0 0 1 6.5 1.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon({ color = '#22c9ff' }: { color?: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M5 17h14M9 7a1.75 1.75 0 1 0 0 .01M15 17a1.75 1.75 0 1 0 0 .01" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CogIcon({ color = 'var(--text-dim)' }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-.94-.32a7.2 7.2 0 0 0-.56-1.34l.5-.87a.8.8 0 0 0-.12-.97l-1.4-1.4a.8.8 0 0 0-.97-.12l-.87.5c-.43-.23-.88-.42-1.34-.56L14 4a.8.8 0 0 0-.77-.6h-2.46A.8.8 0 0 0 10 4l-.32.94c-.46.14-.91.33-1.34.56l-.87-.5a.8.8 0 0 0-.97.12l-1.4 1.4a.8.8 0 0 0-.12.97l.5.87c-.23.43-.42.88-.56 1.34L4 12a.8.8 0 0 0-.6.77v2.46A.8.8 0 0 0 4 16l.94.32c.14.46.33.91.56 1.34l-.5.87a.8.8 0 0 0 .12.97l1.4 1.4a.8.8 0 0 0 .97.12l.87-.5c.43.23.88.42 1.34.56L10 20a.8.8 0 0 0 .77.6h2.46A.8.8 0 0 0 14 20l.32-.94c.46-.14.91-.33 1.34-.56l.87.5a.8.8 0 0 0 .97-.12l1.4-1.4a.8.8 0 0 0 .12-.97l-.5-.87c.23-.43.42-.88.56-1.34L20 15.23a.8.8 0 0 0 .6-.77v-2.46A.8.8 0 0 0 20 12Z" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

function FlowArrow({ width = 28 }: { width?: number }) {
  const c = 'rgba(150,172,204,0.52)';
  return (
    <svg width={width} height={20} viewBox={`0 0 ${width} 20`} fill="none" aria-hidden="true">
      <path d={`M2 10H${width - 8}`} stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d={`M${width - 14} 4L${width - 8} 10L${width - 14} 16`} stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TargetIcon({ color = '#76c8ff', size = 26 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.5" stroke={color} strokeWidth="1.6" />
      <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PersonSimpleIcon({ color = '#ffb94b', size = 26 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.6" />
      <path d="M5 20a7 7 0 0 1 14 0" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PersonBannedIcon({ color = '#ff625a', size = 26 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke={color} strokeWidth="1.6" />
      <path d="M3 20a6 6 0 0 1 12 0" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="m15.5 10 4 4m0-4-4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon({ color = '#66c6ff', size = 22 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
      <path d="M12 7v6l4 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SelectionRing({ selected, color }: { selected: boolean; color: string }) {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: `1.5px solid ${selected ? color : 'var(--border-subtle)'}`,
        background: selected ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {selected ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px color-mix(in srgb, ${color} 55%, transparent)`,
          }}
        />
      ) : null}
    </div>
  );
}

function SmallStatCard({
  title,
  value,
  subtitle,
  accent,
  border,
  icon,
  muted = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: string;
  border: string;
  icon: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 16,
        border: `1px solid ${border}`,
        background: 'var(--surface)',
        boxShadow: 'inset 0 1px 0 rgba(148,186,235,0.05), inset 0 -1px 0 rgba(6,10,18,0.78)',
        padding: '13px 16px 11px',
        minHeight: 108,
        overflow: 'hidden',
        opacity: muted ? 0.46 : 1,
        filter: muted ? 'saturate(0.55)' : 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(180deg, rgba(120,170,220,0.012) 0, rgba(120,170,220,0.012) 1px, transparent 1px, transparent 5px)',
          opacity: 0.22,
          pointerEvents: 'none',
        }}
      />
      {muted ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(6,10,18,0.18) 0%, rgba(6,10,18,0.34) 100%)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <div style={{ ...labelStyle('var(--text-dim)'), letterSpacing: 2.4, fontSize: 13 }}>{title}</div>
          <div style={{ ...mono(34, 800, accent), marginTop: 13, letterSpacing: -1, lineHeight: 0.92 }}>{value}</div>
          <div style={{ ...mono(11, 700, 'var(--text-dim)'), marginTop: 15 }}>{subtitle}</div>
        </div>
        <div
          style={{
            alignSelf: 'center',
            marginTop: 4,
            marginRight: 4,
            opacity: 0.98,
            transform: 'scale(1.22)',
            transformOrigin: 'center',
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function AttackSourcesMapWithMarkers({ markers }: { markers: MapMarker[] }) {
  const { theme } = useTheme();
  const mapAsset = `${BASE_PATH}/assets/attack-map-background-clean.png`;
  const isLight = theme === 'light';
  return (
    <div style={{ position: 'relative', height: 186, borderRadius: 10, overflow: 'hidden' }}>
      {/* Map image layer — filter applied only here so markers are unaffected */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${mapAsset})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          backgroundColor: isLight ? '#dce6f0' : '#07111c',
          filter: isLight ? 'invert(1) hue-rotate(180deg)' : 'none',
        }}
      />
      {/* Markers — positioned above the filtered layer, colours unaffected */}
      {markers.map((marker, index) => (
        <div
          key={`${marker.left}-${marker.top}-${index}`}
          style={{
            position: 'absolute',
            left: `${marker.left}%`,
            top: `${marker.top}%`,
            width: marker.size ?? 12,
            height: marker.size ?? 12,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#ff665b',
            boxShadow: '0 0 0 2px rgba(255,93,82,0.10), 0 0 10px rgba(255,93,82,0.55), 0 0 18px rgba(255,93,82,0.18)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: marker.size && marker.size <= 10 ? 2.5 : 3,
              borderRadius: '50%',
              background: '#fff1ea',
            }}
          />
        </div>
      ))}
    </div>
  );
}

const RECENT_ATTACKERS_VISIBLE_ROWS = 8;
const RECENT_ATTACKERS_GRID = '1.4fr 1.1fr 1.4fr 0.55fr 0.65fr 0.85fr 1.05fr';

function RecentAttackersTable({
  rows,
}: {
  rows: Array<{
    flag: string;
    ip: string;
    countryCity: string;
    isp: string;
    attempts: number;
    risk: number;
    status: ThreatStatus;
    nextAction: string;
  }>;
}) {
  const { t } = useI18n();
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: RECENT_ATTACKERS_GRID,
          gap: 10,
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={labelStyle()}>{t('security.ipAddress')}</div>
        <div style={{ ...labelStyle(), paddingLeft: 12 }}>{t('security.countryCity')}</div>
        <div style={labelStyle()}>ISP</div>
        <div style={labelStyle()}>{t('security.hits')}</div>
        <div style={{ ...labelStyle(), textAlign: 'right' }}>{t('security.risk')}</div>
        <div style={{ ...labelStyle(), textAlign: 'center' }}>{t('security.status')}</div>
        <div style={labelStyle()}>{t('security.nextAction')}</div>
      </div>

      {rows.map((row) => {
        const tone = statTone(row.status);
        return (
          <div
            key={row.ip}
            style={{
              display: 'grid',
              gridTemplateColumns: RECENT_ATTACKERS_GRID,
              gap: 10,
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, paddingRight: 12 }}>
              <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{row.flag}</span>
              <span style={{ ...mono(13, 800, 'var(--text-bright)'), whiteSpace: 'nowrap' }}>{row.ip}</span>
            </div>
            <div
              style={{
                ...mono(12, 700, 'var(--text-dim)'),
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                paddingLeft: 12,
              }}
            >
              {row.countryCity}
            </div>
            <div style={{ ...mono(12, 700, 'var(--text-dim)'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.isp}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span style={{ ...mono(13, 800, 'var(--text-bright)'), minWidth: 18 }}>{row.attempts}</span>
              {riskBars(row.risk)}
            </div>
            <div style={{ ...mono(13, 800, riskTone(row.risk)), textAlign: 'right' }}>{row.risk}%</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 84,
                  padding: '4px 8px',
                  borderRadius: 7,
                  border: `1px solid ${tone.borderColor}`,
                  background: tone.background,
                  ...mono(10, 800, tone.color),
                  textTransform: 'uppercase',
                }}
              >
                {row.status === 'permanent' ? t('security.permanentDeny') : row.status === 'temp' ? t('security.tempBan') : t('security.detected')}
              </span>
            </div>
            <div style={{ ...mono(12, 700, 'var(--text-dim)'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.nextAction}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ThresholdField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ ...mono(12, 700, 'var(--text-dim)') }}>{label}</span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 10,
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-hover)',
          padding: '10px 12px',
        }}
      >
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            ...mono(15, 800, 'var(--text-bright)'),
          }}
        />
        <span style={{ ...mono(11, 700, 'var(--text-faint)'), textTransform: 'uppercase' }}>{suffix}</span>
      </div>
    </label>
  );
}

function SecuritySettingsModal({
  values,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  values: {
    attemptThreshold: string;
    attemptWindowMinutes: string;
    tempBanDays: string;
    tempBanCountBeforeEscalation: string;
    repeatWindowDays: string;
  };
  saving: boolean;
  onChange: (field: 'attemptThreshold' | 'attemptWindowMinutes' | 'tempBanDays' | 'tempBanCountBeforeEscalation' | 'repeatWindowDays', value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(2, 8, 16, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(560px, calc(100vw - 40px))',
          borderRadius: 16,
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.42)',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={labelStyle('var(--text-bright)')}>{t('security.thresholdSettings')}</div>
          <div style={{ ...mono(12, 700, 'var(--text-dim)'), marginTop: 8, lineHeight: 1.55 }}>
            {lang === 'ru'
              ? 'Измените пороги и временные окна для обнаружения, временного бана и повторных нарушений.'
              : lang === 'es'
              ? 'Ajusta los umbrales y ventanas de tiempo para detección, bloqueos temporales y revisión de reincidentes.'
              : lang === 'pt'
              ? 'Ajuste os limites e janelas de tempo para detecção, bloqueios temporários e revisão de reincidentes.'
              : 'Adjust the thresholds and time windows for detection, temporary bans, and repeat-offender review.'}
          </div>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ThresholdField
              label={lang === 'ru' ? 'Попытки до срабатывания' : lang === 'es' ? 'Intentos antes de actuar' : lang === 'pt' ? 'Tentativas antes de agir' : 'Attempts before action'}
              value={values.attemptThreshold}
              suffix={lang === 'ru' ? 'попыток' : lang === 'es' ? 'intentos' : lang === 'pt' ? 'tentativas' : 'attempts'}
              onChange={(value) => onChange('attemptThreshold', value)}
            />
            <ThresholdField
              label={lang === 'ru' ? 'Окно подсчета' : lang === 'es' ? 'Ventana de intentos' : lang === 'pt' ? 'Janela de tentativas' : 'Attempt window'}
              value={values.attemptWindowMinutes}
              suffix={lang === 'ru' ? 'мин' : 'minutos'}
              onChange={(value) => onChange('attemptWindowMinutes', value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ThresholdField
              label={lang === 'ru' ? 'Длительность временного бана' : lang === 'es' ? 'Duración del bloqueo temporal' : lang === 'pt' ? 'Duração do bloqueio temporário' : 'Temporary ban duration'}
              value={values.tempBanDays}
              suffix={lang === 'ru' ? 'дней' : lang === 'es' ? 'días' : lang === 'pt' ? 'dias' : 'days'}
              onChange={(value) => onChange('tempBanDays', value)}
            />
            <ThresholdField
              label={lang === 'ru' ? 'Количество временных банов' : lang === 'es' ? 'Bloqueos temporales antes de escalar' : lang === 'pt' ? 'Bloqueios temporários antes de escalar' : 'Temp-ban count before escalation'}
              value={values.tempBanCountBeforeEscalation}
              suffix={lang === 'ru' ? 'раз' : lang === 'es' ? 'ciclos' : lang === 'pt' ? 'ciclos' : 'cycles'}
              onChange={(value) => onChange('tempBanCountBeforeEscalation', value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ThresholdField
              label={lang === 'ru' ? 'Окно повторного нарушения' : lang === 'es' ? 'Ventana de reincidencia' : lang === 'pt' ? 'Janela de reincidência' : 'Repeat-offense window'}
              value={values.repeatWindowDays}
              suffix={lang === 'ru' ? 'дней' : lang === 'es' ? 'días' : lang === 'pt' ? 'dias' : 'days'}
              onChange={(value) => onChange('repeatWindowDays', value)}
            />
          </div>

          <div
            style={{
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-hover)',
              padding: '12px 14px',
            }}
          >
            <div style={{ ...mono(12, 700, 'var(--text-bright)') }}>
              {lang === 'ru'
                ? `Сработает при ${values.attemptThreshold || '0'} попытках за ${values.attemptWindowMinutes || '0'} минут, затем временный бан на ${values.tempBanDays || '0'} дней.`
                : lang === 'es'
                ? `Activa a los ${values.attemptThreshold || '0'} intentos en ${values.attemptWindowMinutes || '0'} minutos, luego aplica un bloqueo temporal de ${values.tempBanDays || '0'} días.`
                : lang === 'pt'
                ? `Dispara a ${values.attemptThreshold || '0'} tentativas em ${values.attemptWindowMinutes || '0'} minutos, depois aplica um bloqueio temporário de ${values.tempBanDays || '0'} dias.`
                : `Triggers at ${values.attemptThreshold || '0'} attempts in ${values.attemptWindowMinutes || '0'} minutes, then applies a ${values.tempBanDays || '0'}-day temporary ban.`}
            </div>
            <div style={{ ...mono(11, 700, 'var(--text-dim)'), marginTop: 8, lineHeight: 1.5 }}>
              {lang === 'ru'
                ? `В режиме temp-ban IP переходит на следующий этап после ${values.tempBanCountBeforeEscalation || '0'} временных банов в пределах ${values.repeatWindowDays || '0'} дней. В режиме permanent-deny эскалация происходит сразу после достижения порога.`
                : lang === 'es'
                ? `En modo temp-ban, la IP pasa a la siguiente etapa tras ${values.tempBanCountBeforeEscalation || '0'} bloqueos temporales en ${values.repeatWindowDays || '0'} días. En modo permanent-deny, la escalada ocurre inmediatamente al alcanzar el umbral.`
                : lang === 'pt'
                ? `No modo temp-ban, o IP avança para a próxima etapa após ${values.tempBanCountBeforeEscalation || '0'} bloqueios temporários em ${values.repeatWindowDays || '0'} dias. No modo permanent-deny, a escalada ocorre imediatamente ao atingir o limiar.`
                : `In temp-ban mode, the IP moves to the next stage after ${values.tempBanCountBeforeEscalation || '0'} temporary bans within ${values.repeatWindowDays || '0'} days. In permanent-deny mode, escalation happens immediately after the threshold is reached.`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '0 18px 18px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              padding: '9px 12px',
              background: 'var(--surface)',
              cursor: 'pointer',
              ...mono(11, 700, 'var(--text-dim)'),
            }}
          >
            {t('modal.close')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{
              borderRadius: 8,
              border: '1px solid rgba(34,203,255,0.34)',
              padding: '9px 12px',
              background: 'rgba(10,41,58,0.92)',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.65 : 1,
              ...mono(11, 800, 'var(--accent)'),
            }}
          >
            {saving ? t('keys.saving') : t('modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SecurityShell() {
  const { t, lang, setLang } = useI18n();
  const [policyMode, setPolicyMode] = useState<PolicyMode>('temp-ban');
  const [showAllAttackers, setShowAllAttackers] = useState(false);
  const [showThresholdSettings, setShowThresholdSettings] = useState(false);
  const [isSavingPolicyMode, setIsSavingPolicyMode] = useState(false);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState({
    attemptThreshold: '',
    attemptWindowMinutes: '',
    tempBanDays: '',
    tempBanCountBeforeEscalation: '',
    repeatWindowDays: '',
  });
  const securityUrl = apiUrl('/api/security?threatWindow=7d');
  const statsUrl = apiUrl('/api/stats');
  const thresholdsUrl = apiUrl('/api/security-thresholds');
  const { data, mutate } = useSWR<SecurityResponse>(securityUrl, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
  const { data: statsData } = useSWR<StatsResponse>(statsUrl, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
  const { data: thresholdSettings, mutate: mutateThresholds } = useSWR<SecurityThresholds>(thresholdsUrl, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });

  async function savePolicyMode(nextMode: PolicyMode) {
    setPolicyMode(nextMode);
    setIsSavingPolicyMode(true);
    try {
      const response = await fetch(apiUrl('/api/security-mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      if (!response.ok) throw new Error(`Could not save protection mode: ${response.status}`);
      const saved = await response.json() as { mode: PolicyMode };
      await mutate((current) => (
        current ? { ...current, protection_mode: saved.mode } : current
      ), false);
    } catch (error) {
      console.error('[security-review] failed to save protection mode', error);
      setPolicyMode(data?.protection_mode ?? 'temp-ban');
    } finally {
      setIsSavingPolicyMode(false);
    }
  }

  function openThresholdSettings() {
    setThresholdDraft({
      attemptThreshold: String(thresholdSettings?.attemptThreshold ?? 5),
      attemptWindowMinutes: String(thresholdSettings?.attemptWindowMinutes ?? 10),
      tempBanDays: String(thresholdSettings?.tempBanDays ?? 7),
      tempBanCountBeforeEscalation: String(thresholdSettings?.tempBanCountBeforeEscalation ?? 2),
      repeatWindowDays: String(thresholdSettings?.repeatWindowDays ?? 30),
    });
    setShowThresholdSettings(true);
  }

  async function saveThresholdSettings() {
    setIsSavingThresholds(true);
    try {
      const response = await fetch(thresholdsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptThreshold: thresholdDraft.attemptThreshold,
          attemptWindowMinutes: thresholdDraft.attemptWindowMinutes,
          tempBanDays: thresholdDraft.tempBanDays,
          tempBanCountBeforeEscalation: thresholdDraft.tempBanCountBeforeEscalation,
          repeatWindowDays: thresholdDraft.repeatWindowDays,
        }),
      });
      if (!response.ok) throw new Error(`Could not save threshold settings: ${response.status}`);
      const saved = await response.json() as SecurityThresholds;
      await mutateThresholds(saved, false);
      setShowThresholdSettings(false);
    } catch (error) {
      console.error('[security-review] failed to save threshold settings', error);
    } finally {
      setIsSavingThresholds(false);
    }
  }

  const effectivePolicyMode = isSavingPolicyMode ? policyMode : (data?.protection_mode ?? policyMode);
  const effectiveThresholds = thresholdSettings ?? {
    attemptThreshold: 5,
    attemptWindowMinutes: 10,
    tempBanDays: 7,
    tempBanCountBeforeEscalation: 2,
    repeatWindowDays: 30,
    updated_at: '',
  };
  const tempActive = effectivePolicyMode === 'temp-ban';
  const fail2banBans = data?.fail2ban_bans ?? [];
  const sshThreats = useMemo(() => data?.ssh_threats ?? [], [data?.ssh_threats]);
  const permanentDenies = statsData?.perm_blocks?.length ?? 0;
  const activeTempBans = fail2banBans.filter((row) => row.active && !row.perm_blocked).length;
  const reviewTempBans = activeTempBans;
  const reviewPermanentDenies = permanentDenies;
  const totalBanned = reviewTempBans + reviewPermanentDenies;
  const tempPct = totalBanned > 0 ? Math.round((reviewTempBans / totalBanned) * 100) : 0;
  const permanentPct = totalBanned > 0 ? 100 - tempPct : 0;
  const tempSweep = Math.max(0, Math.min(100, tempPct));
  const tempBansMuted = effectivePolicyMode === 'permanent-deny' && reviewTempBans === 0;
  const tempBanSubtitle = tempBansMuted
    ? (lang === 'ru' ? 'Отключено в режиме permanent deny' : lang === 'es' ? 'Deshabilitado en modo permanent deny' : lang === 'pt' ? 'Desabilitado no modo permanent deny' : 'Disabled in permanent-deny mode')
    : t('security.refresh30s');
  const countryBreakdown = useMemo(() => {
    const total = sshThreats.reduce((sum, row) => sum + row.count, 0);
    const byCountry = new Map<string, { cc: string; flag: string; label: string; attacks: number }>();
    for (const row of sshThreats) {
      const key = row.cc || row.country || 'other';
      const label = row.country || 'Unknown';
      const existing = byCountry.get(key) ?? { cc: row.cc || '', flag: row.flag || '', label, attacks: 0 };
      existing.attacks += row.count;
      byCountry.set(key, existing);
    }
    const sorted = [...byCountry.values()].sort((a, b) => b.attacks - a.attacks);
    const topFive = sorted.slice(0, 5).map((row, index) => ({
      rank: index + 1,
      flag: row.flag,
      label: row.label,
      attacks: row.attacks,
      percent: total > 0 ? Math.round((row.attacks / total) * 100) : 0,
      tone: index === 0 ? '#ff655f' : index === 1 ? '#ff8750' : index === 2 ? '#ffad46' : index === 3 ? '#ffc04a' : '#ffc84a',
      cc: row.cc,
    }));
    const otherAttacks = sorted.slice(5).reduce((sum, row) => sum + row.attacks, 0);
    const rows = otherAttacks > 0
      ? [...topFive, { rank: 0, flag: '', label: lang === 'ru' ? 'Прочие' : lang === 'es' ? 'Otros' : lang === 'pt' ? 'Outros' : 'Other', attacks: otherAttacks, percent: total > 0 ? Math.round((otherAttacks / total) * 100) : 0, tone: 'rgba(189,204,226,0.72)', cc: '' }]
      : topFive;
    return { rows, total };
  }, [lang, sshThreats]);
  const mapMarkers = useMemo(
    () => spreadMapMarkers(
      countryBreakdown.rows
        .filter((row) => row.rank > 0)
        .slice(0, 5)
        .map((row) => MAP_POSITIONS[row.cc] ?? { left: 50, top: 50 })
    ),
    [countryBreakdown.rows]
  );
  const recentAttackers = useMemo(() => {
    return sshThreats.map((row) => {
      const status: ThreatStatus = row.perm_blocked ? 'permanent' : row.banned ? 'temp' : 'detected';
      const reputationScore = row.reputation?.score ?? 0;
      // In the review table, risk should reflect both raw attempt volume and the current enforcement stage.
      const enforcementBias = status === 'permanent' ? 34 : status === 'temp' ? 18 : 0;
      const volumeScore = row.count * 6;
      const risk = reputationScore > 0
        ? reputationScore
        : Math.min(100, Math.max(25, volumeScore + enforcementBias));
      const countryCity = [row.city, row.country].filter(Boolean).join(', ') || row.country || 'Unknown';
      const nextAction =
        status === 'permanent' ? t('security.permanentlyBlocked')
        : status === 'temp' ? t('security.tempBan')
        : risk >= 55 ? t('security.nearThreshold')
        : t('security.monitoring');
      return {
        flag: row.flag || '🌐',
        ip: row.ip,
        countryCity,
        isp: row.isp || 'Unknown',
        attempts: row.count,
        risk,
        status,
        nextAction,
      };
    });
  }, [sshThreats, t]);
  const hasOverflowAttackers = recentAttackers.length > RECENT_ATTACKERS_VISIBLE_ROWS;
  const visibleRecentAttackers = hasOverflowAttackers
    ? recentAttackers.slice(0, RECENT_ATTACKERS_VISIBLE_ROWS)
    : recentAttackers;

  const noteText =
    lang === 'ru' ? 'Примечание: Все пороги и политики полностью настраиваются. Изменения применяются в реальном времени.'
    : lang === 'es' ? 'Nota: Todos los umbrales y políticas son configurables. Los cambios se aplican en tiempo real.'
    : lang === 'pt' ? 'Nota: Todos os limites e políticas são configuráveis. As alterações são aplicadas em tempo real.'
    : 'Note: All thresholds and policies are fully configurable. Changes are applied in real-time.';

  return (
    <div style={{ padding: '22px 26px' }}>
        <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>● {t('security.operationsTitle')}</span>
            <div style={{ marginTop: 4, ...mono(11, 500, 'var(--text-faint)') }}>{t('security.enforcementSub')}</div>
          </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: 7, overflow: 'hidden' }}>
                {(['en', 'ru', 'es', 'pt'] as const).map((choice) => (
                  <button
                    key={choice}
                    onClick={() => setLang(choice)}
                    style={{
                      border: 'none',
                      background: lang === choice ? '#09d6ff' : 'transparent',
                      padding: '7px 10px',
                      cursor: 'pointer',
                      ...mono(11, 800, lang === choice ? '#000' : 'var(--text-dim)'),
                      textTransform: 'uppercase',
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              <a
                href={apiUrl('/devices')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: '1px solid rgba(255,84,84,0.28)',
                  background: 'rgba(23,10,14,0.72)',
                  padding: '8px 13px',
                  textDecoration: 'none',
                  ...mono(12, 700, 'rgba(255,138,138,0.9)'),
                }}
              >
                {t('blocked.title')}
              </a>
              <button
                type="button"
                onClick={openThresholdSettings}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface)',
                  padding: '8px 13px',
                  cursor: 'pointer',
                }}
              >
                <CogIcon />
                <span style={{ ...mono(12, 700, 'var(--text-dim)') }}>{t('sidebar.navSettings')}</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
            <SmallStatCard title={t('security.activeTempBans')} value={String(reviewTempBans)} subtitle={tempBanSubtitle} accent="#ffbb43" border="rgba(255,173,56,0.7)" icon={<StatShieldIcon color="#f19a2f" />} muted={tempBansMuted} />
            <SmallStatCard title={t('security.permanentDenies')} value={String(reviewPermanentDenies)} subtitle={t('security.neverExpires')} accent="#ff625a" border="rgba(255,84,84,0.68)" icon={<StatShieldIcon color="#ff5f59" danger />} />
            <SmallStatCard title={t('security.repeatOffenders')} value="9" subtitle={t('security.last30d')} accent="#b47dff" border="rgba(145,88,255,0.56)" icon={<UsersIcon color="#9d69ff" />} />
            <SmallStatCard title={t('security.thresholdProfile')} value={`${effectiveThresholds.attemptThreshold} / ${effectiveThresholds.attemptWindowMinutes} min`} subtitle={lang === 'ru' ? `Повтор в течение ${effectiveThresholds.repeatWindowDays} дней` : lang === 'es' ? `Repite en ${effectiveThresholds.repeatWindowDays} días` : lang === 'pt' ? `Repete em ${effectiveThresholds.repeatWindowDays} dias` : `Repeat within ${effectiveThresholds.repeatWindowDays} days`} accent="#22d2ff" border="rgba(27,178,255,0.64)" icon={<SlidersIcon color="#17b9ff" />} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 2.15fr', gap: 12, marginTop: 12 }}>
            <section style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ padding: '14px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={labelStyle('var(--text-bright)')}>{t('security.attackSources')}</div>
                  <div style={{ ...mono(12, 700, 'var(--text-dim)') }}>({t('security.last7d')})</div>
                </div>
              </div>
              <div style={{ padding: '0 14px' }}>
                <AttackSourcesMapWithMarkers markers={mapMarkers} />
              </div>
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 62px 48px', gap: 8, paddingBottom: 6 }}>
                  <div />
                  <div style={labelStyle()}>{t('security.topCountries')}</div>
                  <div style={{ ...labelStyle(), textAlign: 'right' }}>{t('security.attacks')}</div>
                  <div />
                </div>
                {countryBreakdown.rows.map((row) => (
                  <div
                    key={`${row.rank}-${row.label}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '26px 1fr 62px 48px',
                      gap: 8,
                      alignItems: 'center',
                      padding: '7px 0',
                      borderBottom: row.label === 'Other' ? '1px solid var(--border-subtle)' : '1px solid rgba(255,255,255,0.035)',
                    }}
                  >
                    <div style={{ ...mono(12, 700, row.rank === 0 ? 'var(--text-dim)' : 'var(--text-bright)') }}>{row.rank || ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {row.flag ? <span style={{ fontSize: 14 }}>{row.flag}</span> : null}
                      <span style={{ ...mono(12, 700, row.label === 'Other' ? 'var(--text-dim)' : 'var(--text-bright)'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
                    </div>
                    <div style={{ ...mono(12, 800, row.tone), textAlign: 'right' }}>{row.attacks}</div>
                    <div style={{ ...mono(12, 700, 'var(--text-dim)'), textAlign: 'right' }}>{row.percent}%</div>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, paddingTop: 9 }}>
                  <div style={{ ...mono(12, 700, 'var(--text-dim)') }}>Total</div>
                  <div style={{ ...mono(12, 800, 'var(--text-bright)') }}>{countryBreakdown.total.toLocaleString()}</div>
                </div>
              </div>
            </section>

            <section style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 10px' }}>
                <div style={labelStyle('var(--text-bright)')}>{t('security.recentAttackers')}</div>
                {hasOverflowAttackers ? (
                  <button
                    type="button"
                    onClick={() => setShowAllAttackers(true)}
                    style={{
                      borderRadius: 7,
                      border: '1px solid var(--border-subtle)',
                      padding: '7px 10px',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      ...mono(11, 700, 'var(--text-dim)'),
                    }}
                  >
                    {lang === 'ru' ? `Все (${recentAttackers.length})` : lang === 'es' ? `Ver todos (${recentAttackers.length})` : lang === 'pt' ? `Ver todos (${recentAttackers.length})` : `View all (${recentAttackers.length})`}
                  </button>
                ) : (
                  <div style={{ ...mono(11, 700, 'var(--text-faint)') }}>
                    {lang === 'ru' ? `Показано: ${visibleRecentAttackers.length}` : lang === 'es' ? `Mostrando ${visibleRecentAttackers.length}` : lang === 'pt' ? `Mostrando ${visibleRecentAttackers.length}` : `Showing ${visibleRecentAttackers.length}`}
                  </div>
                )}
              </div>
              <RecentAttackersTable rows={visibleRecentAttackers} />
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.65fr 0.9fr', gap: 12, marginTop: 12 }}>
            <section style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={labelStyle('var(--text-bright)')}>{t('security.protectionMode')}</div>
                  <div style={{ ...mono(11, 700, 'var(--text-faint)'), textTransform: 'uppercase', letterSpacing: 1.6 }}>
                    {lang === 'ru' ? '— выберите строгость защиты' : lang === 'es' ? '— elija el nivel de protección' : lang === 'pt' ? '— escolha o nível de proteção' : '— choose how strict you want to be'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12 }}>
                <button
                  type="button"
                  onClick={() => void savePolicyMode('temp-ban')}
                  style={{
                    borderRadius: 14,
                    border: '1px solid rgba(37,180,255,0.7)',
                    background: effectivePolicyMode === 'temp-ban'
                      ? 'var(--accent-dim)'
                      : 'var(--surface-hover)',
                    padding: '14px 16px',
                    textAlign: 'left',
                    boxShadow: effectivePolicyMode === 'temp-ban' ? 'inset 0 0 0 1px rgba(0,208,255,0.22)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: effectivePolicyMode === 'temp-ban' ? 1 : 0.38 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
                      <div style={{ ...mono(13, 800, '#67cfff'), textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('security.protectTemp')}</div>
                      <span style={{ flexShrink: 0, borderRadius: 10, padding: '4px 12px', background: 'rgba(53,214,97,0.08)', border: '1px solid rgba(53,214,97,0.18)', ...mono(10, 800, '#57e476'), textTransform: 'uppercase' }}>{t('security.recommended')}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, alignSelf: 'center', flexShrink: 0, minHeight: 64 }}>
                        <ShieldIcon color="#25c9ff" />
                        <SelectionRing selected={effectivePolicyMode === 'temp-ban'} color="#52cfff" />
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ ...mono(12, 700, effectivePolicyMode === 'temp-ban' ? 'var(--text-bright)' : 'var(--text-dim)'), lineHeight: 1.55 }}>
                          {lang === 'ru' ? `Блокирует на ${effectiveThresholds.tempBanDays} дней после ${effectiveThresholds.attemptThreshold} попыток за ${effectiveThresholds.attemptWindowMinutes} минут.` : lang === 'es' ? `Bloquea por ${effectiveThresholds.tempBanDays} días tras ${effectiveThresholds.attemptThreshold} intentos en ${effectiveThresholds.attemptWindowMinutes} minutos.` : lang === 'pt' ? `Bloqueia por ${effectiveThresholds.tempBanDays} dias após ${effectiveThresholds.attemptThreshold} tentativas em ${effectiveThresholds.attemptWindowMinutes} minutos.` : `Blocks for ${effectiveThresholds.tempBanDays} days after ${effectiveThresholds.attemptThreshold} attempts in ${effectiveThresholds.attemptWindowMinutes} minutes.`}
                        </div>
                        <div style={{ ...mono(12, 700, 'var(--text-dim)'), lineHeight: 1.55 }}>
                          {lang === 'ru' ? `Эскалация после ${effectiveThresholds.tempBanCountBeforeEscalation} банов за ${effectiveThresholds.repeatWindowDays} дней.` : lang === 'es' ? `Escala tras ${effectiveThresholds.tempBanCountBeforeEscalation} bloqueos en ${effectiveThresholds.repeatWindowDays} días.` : lang === 'pt' ? `Escala após ${effectiveThresholds.tempBanCountBeforeEscalation} bloqueios em ${effectiveThresholds.repeatWindowDays} dias.` : `Escalates after ${effectiveThresholds.tempBanCountBeforeEscalation} bans in ${effectiveThresholds.repeatWindowDays} days.`}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void savePolicyMode('permanent-deny')}
                  style={{
                    borderRadius: 14,
                    border: '1px solid rgba(255,84,84,0.7)',
                    background: effectivePolicyMode === 'permanent-deny'
                      ? 'var(--red-dim)'
                      : 'var(--surface-hover)',
                    padding: '14px 16px',
                    textAlign: 'left',
                    boxShadow: effectivePolicyMode === 'permanent-deny' ? 'inset 0 0 0 1px rgba(255,84,84,0.22)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: effectivePolicyMode === 'permanent-deny' ? 1 : 0.38 }}>
                    <div style={{ display: 'flex', alignItems: 'center', minHeight: 22 }}>
                      <div style={{ ...mono(13, 800, '#ff6c63'), textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('security.protectPermanent')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, alignSelf: 'center', flexShrink: 0, minHeight: 64 }}>
                        <ShieldIcon color="#ff5f59" danger />
                        <SelectionRing selected={effectivePolicyMode === 'permanent-deny'} color="#ff7068" />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                        <div style={{ ...mono(12, 700, effectivePolicyMode === 'permanent-deny' ? 'var(--text-bright)' : 'var(--text-dim)'), lineHeight: 1.55 }}>
                          {lang === 'ru' ? `Блокирует навсегда после ${effectiveThresholds.attemptThreshold} попыток за ${effectiveThresholds.attemptWindowMinutes} минут.` : lang === 'es' ? `Bloquea permanentemente tras ${effectiveThresholds.attemptThreshold} intentos en ${effectiveThresholds.attemptWindowMinutes} minutos.` : lang === 'pt' ? `Bloqueia permanentemente após ${effectiveThresholds.attemptThreshold} tentativas em ${effectiveThresholds.attemptWindowMinutes} minutos.` : `Blocks permanently after ${effectiveThresholds.attemptThreshold} attempts in ${effectiveThresholds.attemptWindowMinutes} minutes.`}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </section>

            <section style={{ borderRadius: 12, border: '1px solid rgba(82,112,146,0.30)', overflow: 'hidden', background: 'var(--surface)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={labelStyle('var(--text-bright)')}>{t('security.currentBanDistribution')}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 22, alignItems: 'center', padding: '18px 16px 20px' }}>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <div
                    style={{
                      width: 150,
                      height: 150,
                      borderRadius: '50%',
                      background: totalBanned > 0
                        ? `conic-gradient(from 180deg, #ffb233 0 ${tempSweep}%, #ff5d54 ${tempSweep}% 100%)`
                        : 'conic-gradient(from 180deg, rgba(101,124,156,0.28) 0 100%)',
                      display: 'grid',
                      placeItems: 'center',
                      boxShadow: '0 0 0 1px var(--border-subtle)',
                    }}
                    >
                      <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'var(--surface)', display: 'grid', placeItems: 'center', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center' }}>
                        <div style={{ ...mono(34, 800, 'var(--text-bright)'), lineHeight: 0.95 }}>{totalBanned}</div>
                        <div style={{ ...mono(10, 700, 'var(--text-dim)'), letterSpacing: 0.6, textTransform: 'uppercase' }}>{t('security.totalBanned')}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingLeft: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffb233', marginTop: 7, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ ...mono(13, 700, 'var(--text-bright)') }}>{lang === 'ru' ? `Временные (${effectiveThresholds.tempBanDays} дней)` : lang === 'es' ? `Temporales (${effectiveThresholds.tempBanDays} días)` : lang === 'pt' ? `Temporários (${effectiveThresholds.tempBanDays} dias)` : `Temporary (${effectiveThresholds.tempBanDays}-day)`}</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ ...mono(14, 800, 'var(--text-bright)') }}>{reviewTempBans}</span>
                        <span style={{ ...mono(13, 700, 'var(--text-dim)') }}>({tempPct}%)</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5d54', marginTop: 7, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ ...mono(13, 700, 'var(--text-bright)') }}>{t('security.permanent')}</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ ...mono(14, 800, 'var(--text-bright)') }}>{reviewPermanentDenies}</span>
                        <span style={{ ...mono(13, 700, 'var(--text-dim)') }}>({permanentPct}%)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.82fr', gap: 12, marginTop: 12 }}>
            <section style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={labelStyle('var(--text-bright)')}>{t('security.escalationRule')}</div>
                  <div style={{ ...mono(11, 700, 'var(--text-faint)'), textTransform: 'uppercase', letterSpacing: 1.5 }}>
                    {lang === 'ru' ? `— если пойман снова в течение ${effectiveThresholds.repeatWindowDays} дней` : lang === 'es' ? `— si vuelve a ser detectado en ${effectiveThresholds.repeatWindowDays} días` : lang === 'pt' ? `— se detectado novamente em ${effectiveThresholds.repeatWindowDays} dias` : `— if caught again within ${effectiveThresholds.repeatWindowDays} days`}
                  </div>
                </div>
              </div>

              {/* Two-row grid: row 1 = callout above connector col, row 2 = boxes + arrows */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 28px 1fr 144px 1fr',
                gridTemplateRows: 'auto auto',
                columnGap: 10,
                rowGap: 0,
                padding: '14px 16px 16px',
              }}>

                {/* Row 1 — only the callout, centred in connector column */}
                <div style={{ gridColumn: 4, gridRow: 1, display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
                  <div style={{
                    padding: '6px 12px', borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--surface-hover)', textAlign: 'center',
                  }}>
                    <div style={{ ...mono(11, 800, 'var(--text-bright)'), textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {lang === 'ru' ? 'Если пойман снова' : lang === 'es' ? 'Si vuelve a atacar' : lang === 'pt' ? 'Se atacar novamente' : 'If Caught Again'}
                    </div>
                    <div style={{ ...mono(11, 700, 'var(--text-dim)'), whiteSpace: 'nowrap' }}>
                      {lang === 'ru' ? `(в течение ${effectiveThresholds.repeatWindowDays} дней)` : lang === 'es' ? `(en ${effectiveThresholds.repeatWindowDays} días)` : lang === 'pt' ? `(em ${effectiveThresholds.repeatWindowDays} dias)` : `(within ${effectiveThresholds.repeatWindowDays} days)`}
                    </div>
                  </div>
                </div>

                {/* Row 2 — Box 1: Detection */}
                <div style={{
                  gridColumn: 1,
                  gridRow: 2,
                  borderRadius: 12,
                  border: '1px solid rgba(102,190,230,0.72)',
                  padding: '12px 14px',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  position: 'relative',
                  boxShadow: '0 8px 24px rgba(16,96,140,0.06), inset 0 1px 0 rgba(140,210,255,0.03)'
                }}>
                  <div style={{ height: 4, borderRadius: 8, margin: '-12px -14px 8px', background: 'linear-gradient(90deg, rgba(58,211,255,0.22), rgba(102,207,255,0.14))' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TargetIcon color="#76c8ff" size={28} />
                    <div style={{ ...mono(13, 800, '#76c8ff'), textTransform: 'uppercase' }}>{lang === 'ru' ? '1 Обнаружение' : lang === 'es' ? '1 Detección' : lang === 'pt' ? '1 Detecção' : '1 Detection'}</div>
                  </div>
                  <div style={{ ...mono(12, 700, 'var(--text-dim)'), lineHeight: 1.55 }}>
                    {lang === 'ru' ? 'Подозрительная активность SSH обнаружена и попытки подсчитаны.' : lang === 'es' ? 'Actividad SSH sospechosa detectada y los intentos contados.' : lang === 'pt' ? 'Atividade SSH suspeita detectada e as tentativas contadas.' : 'Suspicious activity detected and attempts counted'}
                  </div>
                </div>

                {/* Row 2 — Arrow 1 */}
                <div style={{ gridColumn: 2, gridRow: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FlowArrow />
                </div>

                {/* Row 2 — Box 2: Temp Ban */}
                <div
                  style={{
                    gridColumn: 3,
                    gridRow: 2,
                    borderRadius: 12,
                    border: tempActive ? '1px solid rgba(255,181,68,0.52)' : '1px solid var(--border-subtle)',
                    padding: '12px 14px',
                    background: tempActive ? 'var(--amber-dim)' : 'var(--surface-hover)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    opacity: tempActive ? 1 : 0.42,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PersonSimpleIcon color="#ffb94b" size={28} />
                    <div style={{ ...mono(13, 800, '#ffb94b'), textTransform: 'uppercase' }}>{lang === 'ru' ? `2 Врем. бан (${effectiveThresholds.tempBanDays} дней)` : lang === 'es' ? `2 Bloqueo temp. (${effectiveThresholds.tempBanDays} días)` : lang === 'pt' ? `2 Bloqueio temp. (${effectiveThresholds.tempBanDays} dias)` : `2 Temp Ban (${effectiveThresholds.tempBanDays} Days)`}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <ShieldIcon color="#ffb94b" size={28} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ ...mono(11, 700, 'var(--text-dim)') }}>{lang === 'ru' ? 'Порог срабатывания' : lang === 'es' ? 'Activado en' : lang === 'pt' ? 'Ativado em' : 'Triggered at'}</div>
                      <div style={{ ...mono(12, 700, 'var(--text-bright)') }}>{effectiveThresholds.attemptThreshold} {lang === 'ru' ? 'попыток' : lang === 'es' ? 'intentos' : lang === 'pt' ? 'tentativas' : 'attempts'} / {effectiveThresholds.attemptWindowMinutes} min</div>
                      <div style={{ ...mono(12, 700, 'var(--text-bright)') }}>{lang === 'ru' ? `Автобан на ${effectiveThresholds.tempBanDays} дней` : lang === 'es' ? `Bloqueo auto. por ${effectiveThresholds.tempBanDays} días` : lang === 'pt' ? `Bloqueio auto. por ${effectiveThresholds.tempBanDays} dias` : `Auto-ban for ${effectiveThresholds.tempBanDays} days`}</div>
                    </div>
                  </div>
                </div>

                {/* Row 2 — Connector: vertical tick from callout + wide arrow */}
                <div style={{ gridColumn: 4, gridRow: 2, display: 'flex', alignItems: 'center', position: 'relative' }}>
                  {/* Vertical line from callout bottom to arrow midline */}
                  <div style={{
                    position: 'absolute',
                    left: '50%', transform: 'translateX(-50%)',
                    top: 0, bottom: '50%',
                    width: 1.5, background: 'rgba(150,172,204,0.52)',
                  }} />
                  <FlowArrow width={144} />
                </div>

                {/* Row 2 — Box 3: Permanent Deny */}
                <div
                  style={{
                    gridColumn: 5, gridRow: 2,
                    borderRadius: 12,
                    border: `1px solid ${effectivePolicyMode === 'permanent-deny' ? 'rgba(255,95,86,0.58)' : 'var(--border-subtle)'}`,
                    padding: '12px 14px',
                    background: effectivePolicyMode === 'permanent-deny' ? 'var(--red-dim)' : 'var(--surface-hover)',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                    <PersonBannedIcon color="#ff625a" size={28} />
                    <ShieldIcon color="#ff625a" danger size={28} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...mono(13, 800, '#ff625a'), textTransform: 'uppercase', marginBottom: 8 }}>{t('security.permanentDeny')}</div>
                    <div style={{ ...mono(12, 700, 'var(--text-dim)'), lineHeight: 1.55 }}>
                      {lang === 'ru' ? 'IP добавлен в постоянный deny-лист.' : lang === 'es' ? 'IP agregado a la lista de denegación permanente.' : lang === 'pt' ? 'IP adicionado à lista de negação permanente.' : 'IP added to permanent deny list.'}
                    </div>
                    <div style={{ ...mono(12, 700, 'var(--text-dim)'), lineHeight: 1.55, marginTop: 3 }}>{lang === 'ru' ? 'Не истекает.' : lang === 'es' ? 'Nunca expira.' : lang === 'pt' ? 'Nunca expira.' : 'Never expires.'}</div>
                  </div>
                </div>

              </div>
            </section>

            <section style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ ...displayCaps(13, 'var(--text-bright)'), letterSpacing: 1.6 }}>{t('security.thresholdSettings')}</div>
              </div>

              <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 360 }}>
                  <div style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', padding: 12, background: 'var(--surface-hover)' }}>
                    {/* Row: Attempts */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-hover)', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        <div style={{ width: 34, display: 'grid', placeItems: 'center' }}>
                          <PersonSimpleIcon color="#5ec0ff" size={22} />
                        </div>
                        <div style={{ ...mono(13, 700, 'var(--text-bright)'), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('security.attemptThreshold')}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                        <span style={{ ...mono(13, 800, 'var(--text-bright)') }}>{effectiveThresholds.attemptThreshold}</span>
                        <span style={{ ...mono(13, 700, 'var(--text-dim)') }}>{lang === 'ru' ? `за ${effectiveThresholds.attemptWindowMinutes} мин` : lang === 'es' ? `por ${effectiveThresholds.attemptWindowMinutes} minutos` : lang === 'pt' ? `por ${effectiveThresholds.attemptWindowMinutes} minutos` : `per ${effectiveThresholds.attemptWindowMinutes} minutes`}</span>
                      </div>
                    </div>

                    {/* Row: Repeat window */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-hover)', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        <div style={{ width: 34, display: 'grid', placeItems: 'center' }}>
                          <ClockIcon color="#5ec0ff" size={22} />
                        </div>
                        <div style={{ ...mono(13, 700, 'var(--text-bright)'), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('security.repeatWindow')}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                        <span style={{ ...mono(13, 800, 'var(--text-bright)') }}>{effectiveThresholds.repeatWindowDays}</span>
                        <span style={{ ...mono(13, 700, 'var(--text-dim)') }}>{lang === 'ru' ? 'дней' : lang === 'es' ? 'días' : lang === 'pt' ? 'dias' : 'days'}</span>
                      </div>
                    </div>

                    {/* Row: Escalation */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-hover)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        <div style={{ width: 34, display: 'grid', placeItems: 'center' }}>
                          <ShieldIcon color="#5ec0ff" size={22} />
                        </div>
                        <div style={{ ...mono(13, 700, 'var(--text-bright)'), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('security.escalation')}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                        <span style={{ ...mono(13, 700, 'var(--text-dim)') }}>{effectivePolicyMode === 'permanent-deny' ? (lang === 'ru' ? 'Сразу' : lang === 'es' ? 'Inmediatamente' : lang === 'pt' ? 'Imediatamente' : 'Immediately') : (lang === 'ru' ? `Review после ${effectiveThresholds.tempBanCountBeforeEscalation}` : lang === 'es' ? `Revisión tras ${effectiveThresholds.tempBanCountBeforeEscalation}` : lang === 'pt' ? `Revisão após ${effectiveThresholds.tempBanCountBeforeEscalation}` : `Review after ${effectiveThresholds.tempBanCountBeforeEscalation}`)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div style={{ marginTop: 12, borderRadius: 10, border: '1px solid var(--border-subtle)', padding: '12px 16px', background: 'var(--surface)' }}>
            <span style={{ ...mono(12, 700, '#57b9ff') }}>ⓘ </span>
            <span style={{ ...mono(12, 700, 'var(--text-dim)') }}>{noteText}</span>
          </div>
      {showAllAttackers ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'rgba(2, 8, 16, 0.76)',
            backdropFilter: 'blur(7px)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 24,
            overflowY: 'auto',
          }}
          onClick={() => setShowAllAttackers(false)}
        >
          <div
            style={{
              width: 'min(1380px, calc(100vw - 48px))',
              maxHeight: 'calc(100vh - 48px)',
              borderRadius: 14,
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
              background: 'var(--surface)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.42)',
              display: 'flex',
              flexDirection: 'column',
              margin: 'auto 0',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '16px 18px 14px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={labelStyle('var(--text-bright)')}>{t('security.recentAttackers')}</div>
                <div style={{ ...mono(11, 700, 'var(--text-faint)'), marginTop: 6 }}>
                  {lang === 'ru' ? `Показано все ${recentAttackers.length}` : lang === 'es' ? `Mostrando todos (${recentAttackers.length})` : lang === 'pt' ? `Mostrando todos (${recentAttackers.length})` : `Showing all ${recentAttackers.length}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAllAttackers(false)}
                style={{
                  borderRadius: 7,
                  border: '1px solid var(--border-subtle)',
                  padding: '7px 10px',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  ...mono(11, 700, 'var(--text-dim)'),
                }}
              >
                {t('modal.close')}
              </button>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                scrollbarGutter: 'stable',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <RecentAttackersTable rows={recentAttackers} />
            </div>
          </div>
        </div>
      ) : null}
      {showThresholdSettings ? (
        <SecuritySettingsModal
          values={thresholdDraft}
          saving={isSavingThresholds}
          onChange={(field, value) => setThresholdDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => {
            if (!isSavingThresholds) setShowThresholdSettings(false);
          }}
          onSave={() => void saveThresholdSettings()}
        />
      ) : null}
    </div>
  );
}

export default function SecurityPage() {
  return <SecurityShell />;
}
