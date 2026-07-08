'use client';
import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import type { StatsResponse, UserStat, ServerHealth } from '@/lib/types';
import { UserCard } from './UserCard';
import { NewUserModal, DeleteUserModal, MetaEditModal } from './Modals';
import { SectionTitle, groupColor } from './ui';
import { BASE_PATH, apiUrl, securityPageUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-client';

const fetcher = fetchJson;
interface FastStatus { users: { email: string; online: boolean }[]; ts: number }
type ThreatWindow = '24h' | '7d';

// ── UTC clock ─────────────────────────────────────────────────────────────────
function UtcClock() {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-dim)' }}>
      {tick.toUTCString().slice(17, 25)} UTC
    </span>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IconActivity = ({ c }: { c: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconKey = ({ c }: { c: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="3.5" />
    <path d="M10.5 12.5L21 2m-4 4 2 2m-5-1 2 2" />
  </svg>
);
const IconGlobe = ({ c }: { c: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const IconNetwork = ({ c }: { c: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
    <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" /><line x1="5" y1="19" x2="19" y2="19" />
  </svg>
);
const IconShield = ({ c }: { c: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ── Mini sparkline ────────────────────────────────────────────────────────────
function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function Sparkline({ data, color, gid }: { data: number[]; color: string; gid: string }) {
  if (!data.length) return null;
  const W = 200; const H = 44;
  const max = Math.max(...data, 1);
  // 10% top inset, 15% bottom inset — line floats within the viewBox
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H * 0.1 + (H * 0.75) * (1 - v / max),
  }));
  const line = catmullRomPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          {/* style= instead of presentation attrs — CSS vars don't work in SVG attrs */}
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.14 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.01 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth="0.6" strokeLinejoin="round" />
    </svg>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, context, contextColor, accent, icon, sparkData, gid, trend }: {
  label: string; value: string | number; context: string; contextColor?: string;
  accent: string; icon: React.ReactNode; sparkData?: number[]; gid: string;
  trend?: { pct: number | null; label: string };
}) {
  const { theme } = useTheme();
  const hasSpark = !!sparkData && sparkData.length > 1 && sparkData.some((v, i) => i > 0 && v !== sparkData[0]);
  const cardStyle = theme === 'light'
    ? { background: 'var(--surface)', border: '1px solid var(--border)' }
    : { background: 'rgba(5,12,22,0.9)', border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)` };
  return (
    <div style={{
      borderRadius: 12,
      ...cardStyle,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* label + icon */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 14px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: accent }}>{label}</div>
        <div style={{ opacity: 0.7 }}>{icon}</div>
      </div>

      {/* value */}
      <div style={{ padding: '6px 14px 0', fontSize: 'clamp(26px,2.4vw,36px)', fontWeight: 800, lineHeight: 1, color: accent, letterSpacing: -1 }}>
        {value}
      </div>

      {/* context */}
      <div style={{ padding: '5px 14px 0', fontSize: 11, color: contextColor ?? 'var(--text-dim)', flex: 1 }}>
        {context}
      </div>

      {/* trend (connections card only) */}
      {trend && (
        <div style={{ padding: '3px 14px 0', fontSize: 11, color: trend.pct === null ? 'var(--text-dim)' : trend.pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {trend.pct === null
            ? trend.label
            : `${trend.pct >= 0 ? '↑' : '↓'} ${Math.abs(trend.pct).toFixed(1)}% ${trend.label}`}
        </div>
      )}

      {/* sparkline — only when a real series exists */}
      {hasSpark && (
        <div style={{ padding: '4px 10px 10px', marginTop: 'auto' }}>
          <Sparkline data={sparkData!} color={accent} gid={gid} />
        </div>
      )}
    </div>
  );
}

// ── Connections chart ─────────────────────────────────────────────────────────
function ConnectionsChart({ buckets }: { buckets: { h: number; n: number }[] }) {
  const W = 420; const H = 195; const pad = { t: 10, b: 28, l: 22, r: 6 };
  const iW = W - pad.l - pad.r; const iH = H - pad.t - pad.b;
  const rawMax = Math.max(...buckets.map(b => b.n), 1);
  const now = new Date();

  // Nice round Y-axis max and step
  const step = rawMax <= 500 ? 100 : rawMax <= 2000 ? 500 : rawMax <= 10000 ? 1000 : 5000;
  const niceMax = Math.ceil(rawMax / step) * step;
  const fmtY = (v: number) => v >= 1000 ? `${v / 1000}K` : String(v);
  const numTicks = Math.min(Math.round(niceMax / step), 5);
  const yTicks = Array.from({ length: numTicks + 1 }, (_, i) => {
    const v = i * step;
    return { v, y: pad.t + iH - (v / niceMax) * iH, label: fmtY(v) };
  });

  const pts = buckets.map((b, i) => ({
    x: pad.l + (i / 23) * iW,
    y: pad.t + iH - (b.n / niceMax) * iH * 0.92,
    label: (() => {
      const d = new Date(now.getTime() - (23 - i) * 3600000);
      return `${d.getUTCHours().toString().padStart(2, '0')}:00`;
    })(),
  }));

  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const areaD = `${lineD} L ${last.x.toFixed(1)},${(pad.t + iH).toFixed(1)} L ${pts[0].x.toFixed(1)},${(pad.t + iH).toFixed(1)} Z`;
  const xLabels = [0, 4, 8, 12, 16, 20, 23].map(i => pts[i]).filter(Boolean);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="cgArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="60%"  stopColor="var(--accent)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.00" />
        </linearGradient>
      </defs>
      {yTicks.map(t => (
        <g key={t.v}>
          <line x1={pad.l} y1={t.y} x2={W - pad.r} y2={t.y} stroke="var(--grid-line)" strokeWidth="1" />
          <text x={pad.l - 3} y={t.y + 4} textAnchor="end" fontSize="9" fill="var(--axis-text)">{t.label}</text>
        </g>
      ))}
      <path d={areaD} fill="url(#cgArea)" />
      <path d={lineD} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {xLabels.map(p => (
        <text key={p.label} x={p.x} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--axis-text)">{p.label}</text>
      ))}
    </svg>
  );
}

// ── Attack map ────────────────────────────────────────────────────────────────
const CC: Record<string, [number, number]> = {
  AF:[33,65],AL:[41,20],AM:[40,45],AO:[-12,18],AR:[-34,-64],AT:[47,14],AU:[-25,133],AZ:[40,48],
  BA:[44,17],BD:[24,90],BE:[50,4],BG:[43,25],BH:[26,51],BR:[-10,-55],BY:[53,28],CA:[56,-96],
  CD:[-4,24],CF:[7,21],CG:[-1,15],CH:[47,8],CI:[8,-6],CL:[-30,-71],CM:[6,12],CN:[35,105],
  CO:[4,-72],CU:[22,-80],CZ:[50,15],DE:[51,10],DK:[56,10],DZ:[28,3],EC:[-2,-78],EE:[59,26],
  EG:[27,30],ES:[40,-4],ET:[8,38],FI:[64,26],FR:[46,2],GB:[54,-2],GE:[42,44],GH:[8,-1],
  GR:[39,22],GT:[15,-90],HN:[15,-87],HR:[45,16],HU:[47,20],ID:[-5,120],IE:[53,-8],IL:[31,35],
  IN:[21,78],IQ:[33,44],IR:[33,53],IT:[42,12],JM:[18,-77],JO:[31,36],JP:[36,138],KE:[1,38],
  KG:[41,75],KH:[12,105],KP:[40,127],KR:[37,128],KW:[29,48],KZ:[48,68],LA:[18,103],LB:[34,36],
  LR:[6,-9],LT:[56,24],LV:[57,25],LY:[27,17],MA:[32,-6],MD:[47,29],MK:[41,22],ML:[17,-4],
  MM:[22,96],MN:[46,105],MR:[20,-12],MX:[23,-102],MY:[4,109],MZ:[-18,35],NG:[10,8],NI:[13,-85],
  NL:[52,5],NO:[64,10],NP:[28,84],NZ:[-41,174],OM:[22,58],PA:[9,-80],PE:[-10,-76],PH:[13,122],
  PK:[30,70],PL:[52,20],PT:[39,-8],PY:[-23,-58],QA:[25,51],RO:[46,25],RS:[44,21],RU:[60,100],
  SA:[24,45],SD:[15,30],SE:[62,15],SG:[1,104],SI:[46,15],SK:[49,19],SO:[6,48],SY:[35,38],
  TD:[15,19],TG:[8,1],TH:[15,101],TJ:[39,71],TM:[39,59],TN:[34,9],TR:[39,35],TZ:[-6,35],
  UA:[49,32],UG:[1,32],US:[38,-97],UY:[-33,-56],UZ:[41,64],VE:[8,-66],VN:[16,108],YE:[15,48],
  ZA:[-29,25],ZM:[-15,30],ZW:[-20,30],HK:[22,114],TW:[23,121],
};

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function AttackMap({ threats }: { threats: { ip: string; count: number; cc?: string; flag?: string; city?: string; country?: string }[] }) {
  const { theme } = useTheme();
  const mapAsset = `${BASE_PATH}/assets/attack-map-background.png`;
  const projected = threats.map((t) => {
    const co = CC[t.cc ?? ''];
    if (!co) return null;
    const [lat, lon] = co;
    return {
      ...t,
      x: 5 + ((lon + 180) / 360) * 90,
      y: 20 + ((90 - lat) / 180) * 60,
    };
  }).filter(Boolean) as Array<{ ip: string; count: number; cc?: string; city?: string; country?: string; x: number; y: number }>;

  const grouped = new Map<string, typeof projected>();
  for (const threat of projected) {
    const key = `${threat.cc ?? 'xx'}:${threat.city ?? threat.country ?? threat.ip}`;
    grouped.set(key, [...(grouped.get(key) ?? []), threat]);
  }

  const markers = Array.from(grouped.values()).flatMap((group) => {
    const offsets = group.length === 1
      ? [[0, 0]]
      : group.length === 2
        ? [[-0.9, 0.7], [0.9, -0.7]]
        : [[-1.1, 0.8], [0, -0.9], [1.1, 0.8]];
    return group.map((threat, index) => ({
      ...threat,
      x: threat.x + (offsets[index]?.[0] ?? 0),
      y: threat.y + (offsets[index]?.[1] ?? 0),
    }));
  });

  const bakedMasks = [
    { left: '17.7%', top: '39.6%' },
    { left: '52.0%', top: '37.2%' },
    { left: '81.2%', top: '42.1%' },
  ];

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      aspectRatio: '1002 / 516',
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: 'var(--surface)',
    }}>
      {/* Map image layer — filtered separately so markers above it stay unaffected */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${mapAsset})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: 'contain',
        filter: theme === 'light' ? 'grayscale(1) invert(1)' : undefined,
      }} />
      {bakedMasks.map((mask, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: mask.left,
          top: mask.top,
          width: 58,
          height: 58,
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, var(--surface) 0%, color-mix(in srgb, var(--surface) 92%, transparent) 38%, transparent 76%)',
          pointerEvents: 'none',
        }} />
      ))}
      {markers.map((marker) => (
        <div
          key={marker.ip}
          title={`${marker.city ?? marker.country ?? marker.cc ?? marker.ip} · ${marker.count} hit${marker.count > 1 ? 's' : ''}`}
          style={{
            position: 'absolute',
            left: `${marker.x}%`,
            top: `${marker.y}%`,
            width: 12,
            height: 12,
            borderRadius: '999px',
            background: 'var(--red)',
            boxShadow: '0 0 10px var(--red), 0 0 24px var(--red-dim), 0 0 42px var(--red-dim)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            position: 'absolute',
            inset: -16,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--red-dim) 0%, transparent 72%)',
          }} />
          <div style={{
            position: 'absolute',
            inset: 3,
            borderRadius: '50%',
            background: '#fff',
          }} />
        </div>
      ))}
    </div>
  );
}

function FilterMenu<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10,
          padding: '8px 14px',
          border: '1px solid var(--border)',
          borderRadius: 9,
          color: 'var(--text-dim)',
          background: 'var(--surface)',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {current.label} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          minWidth: 164,
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
          zIndex: 30,
        }}>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid var(--border-subtle)',
                background: option.value === value ? 'var(--surface-hover)' : 'transparent',
                color: option.value === value ? 'var(--text-bright)' : 'var(--text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Middle section ────────────────────────────────────────────────────────────
function MiddleSection({
  data,
  threatWindow,
  onThreatWindowChange,
}: {
  data: StatsResponse;
  threatWindow: ThreatWindow;
  onThreatWindowChange: (next: ThreatWindow) => void;
}) {
  const { t } = useI18n();
  const buckets = data.conns_hourly ?? [];
  const total = buckets.reduce((s, b) => s + b.n, 0);
  const threats = data.ssh_threats ?? [];
  const totalAttempts = threats.reduce((s, t) => s + t.count, 0);
  const countries = new Set(threats.map(t => t.cc).filter(Boolean)).size;
  const highRisk = threats.filter(t => (t.reputation?.score ?? 0) >= 80).length;
  const chartMeta = {
    title: t('analytics.connectionsOverTime').toUpperCase(),
    subtitle: t('security.last24h'),
    footerLabel: t('analytics.totalConnections').toUpperCase(),
    footerSuffix: '',
  };

  const panel = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
  const pHead = (title: string, sub?: string, right?: React.ReactNode) => (
    <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.2, color: 'var(--text-bright)' }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28, alignItems: 'stretch' }}>

      {/* ── connections over time ── */}
      {panel(<>
        {pHead(chartMeta.title, chartMeta.subtitle)}
        <div style={{ padding: '12px 8px 4px' }}>
          <ConnectionsChart buckets={buckets.length === 24 ? buckets : Array.from({ length: 24 }, (_, h) => ({ h, n: 0 }))} />
        </div>
        <div style={{
          margin: '12px 18px 16px',
          padding: '18px 22px',
          borderTop: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: '62px 1fr auto',
          gap: 16,
          alignItems: 'center',
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: 'var(--accent-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="3" width="13" height="11" rx="1.5" stroke="var(--accent)" strokeWidth="1.1" />
              <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="var(--accent)" strokeWidth="1.1" />
              <line x1="5" y1="1.5" x2="5" y2="4.5" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" />
              <line x1="11" y1="1.5" x2="11" y2="4.5" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' as const, color: 'var(--text-dim)', fontWeight: 700 }}>{chartMeta.footerLabel}</div>
            <div style={{ marginTop: 8, fontSize: 26, fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1 }}>{total.toLocaleString()}</div>
          </div>
          {data.conns_trend_pct !== null && data.conns_trend_pct !== undefined && (
            <div style={{ textAlign: 'right', alignSelf: 'center', paddingLeft: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: (data.conns_trend_pct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', lineHeight: 1 }}>
                {(data.conns_trend_pct ?? 0) >= 0 ? '+' : ''}{data.conns_trend_pct}%
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>{t('analytics.previous24h')}</div>
            </div>
          )}
        </div>
      </>)}

      {/* ── attack map ── */}
      {panel(<>
        {pHead(
          t('analytics.attackMap').toUpperCase(),
          t('analytics.attackMapSub'),
          <FilterMenu
            value={threatWindow}
            onChange={onThreatWindowChange}
            options={[
              { value: '24h', label: t('security.last24h') },
              { value: '7d', label: t('security.last7d') },
            ]}
          />,
        )}
        <div style={{ padding: '16px 18px 0' }}>
          <AttackMap threats={threats} />
        </div>
        <div style={{
          margin: '12px 18px 16px',
          padding: '18px 22px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface-hover)',
          display: 'grid',
          gridTemplateColumns: '62px 1fr 1fr',
          gap: 20,
          alignItems: 'center',
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: 'var(--red-dim)',
            border: '1px solid var(--red)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--red)', boxShadow: '0 0 12px var(--red)' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, color: 'var(--text-bright)' }}>
              <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{totalAttempts}</span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.9, textTransform: 'uppercase' as const }}>{t('analytics.attacks').toUpperCase()}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>{threats.length} unique IPs · {threatWindow === '24h' ? t('analytics.period24h') : t('analytics.period7d')}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, color: 'var(--text-bright)' }}>
              <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{countries}</span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.9, textTransform: 'uppercase' as const }}>{t('analytics.countries').toUpperCase()}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--red)', fontWeight: 800 }}>{highRisk} {t('security.highRisk').toUpperCase()}</div>
          </div>
        </div>
      </>)}

      {/* ── recent attacks ── */}
      {panel(<>
        {pHead(t('analytics.recentAttacks').toUpperCase(), `${threatWindow === '24h' ? t('analytics.period24h') : t('analytics.period7d')} · most recent first`,
          <a
            href={securityPageUrl()}
            style={{ fontSize: 10, color: 'var(--text-dim)', textDecoration: 'none', padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {t('security.viewAll')}
          </a>
        )}
        <div style={{ overflowY: 'auto', maxHeight: 325 }}>
          {threats.length === 0
            ? <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>{t('analytics.noAttacksRecorded')}</div>
            : threats.map(threat => (
              <div key={threat.ip} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: 'var(--red-dim)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconShield c="var(--red)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-bright)', fontFamily: 'monospace' }}>{threat.ip}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{t('analytics.failedSshLogin')}</span>
                    <span style={{ color: 'var(--text-faint)' }}>·</span>
                    <span>{threat.flag} {threat.city || threat.country || t('threat.unknown')}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 90 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{threat.count > 1 ? `${threat.count} ${t('analytics.attempts')}` : `1 ${t('analytics.attempt')}`}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>{relativeTime(threat.last_seen)}</div>
                  {(threat.perm_blocked || threat.banned) && (
                    <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 4, fontWeight: 700 }}>
                      {threat.perm_blocked ? t('analytics.blocked').toUpperCase() : 'BANNED'}
                    </div>
                  )}
                </div>
              </div>
            ))
          }
        </div>
      </>)}
    </div>
  );
}

function HealthOverview({ h, t }: { h: ServerHealth; t: (k: string) => string }) {
  const severityColor = (value: number, thresholds: [number, number, number], colors = ['var(--green)', 'var(--yellow)', 'var(--amber)', 'var(--red)']) => {
    if (value >= thresholds[2]) return colors[3];
    if (value >= thresholds[1]) return colors[2];
    if (value >= thresholds[0]) return colors[1];
    return colors[0];
  };
  const loadColor = severityColor(h.load_1, [0.75, 1.25, 2]);
  const memColor = severityColor(h.mem_pct, [55, 70, 85]);
  const diskColor = severityColor(h.disk_pct, [55, 70, 85], ['var(--accent)', 'var(--green)', 'var(--amber)', 'var(--red)']);
  const statusColor = h.xray_running === false ? 'var(--red)' : 'var(--green)';
  const cpuPct = Math.max(6, Math.min(100, (h.load_1 / 2) * 100));
  const cpuStateLabel = h.load_1 < 0.75 ? t('health.normal') : h.load_1 < 1.25 ? t('health.elevated') : h.load_1 < 2 ? t('health.high') : t('health.critical');
  const svc = (label: string, ok: boolean | null, color: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 6,
      background: ok === null ? 'var(--surface-hover)' : ok ? `${color}1a` : 'var(--red-dim)',
      border: `1px solid ${ok === null ? 'var(--border)' : ok ? color : 'var(--red)'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: ok === null ? 'var(--text-faint)' : ok ? color : 'var(--red)', boxShadow: ok ? `0 0 5px ${color}` : 'none' }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: ok === null ? 'var(--text-dim)' : ok ? color : 'var(--red)', letterSpacing: 0.5 }}>{label}</span>
    </div>
  );
  const metric = (label: string, value: React.ReactNode, sub?: React.ReactNode, bar?: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{sub}</div>}
      {bar}
    </div>
  );
  const pbar = (pct: number, color: string) => (
    <div style={{ height: 3, borderRadius: 999, background: 'var(--surface-hover)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 999 }} />
    </div>
  );

  return (
    <div style={{
      marginBottom: 20,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 18px',
    }}>
      {/* Row 1 — status + services */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>
            {h.xray_running === false ? t('header.degraded') : t('warning.operational')}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>
            ↑ {h.uptime}
          </span>
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
        {svc('Xray', h.xray_running, 'var(--green)')}
        {svc('Hysteria2', h.hysteria2_running, 'var(--green)')}
        {svc('WireGuard', h.wg_running, 'var(--green)')}
        {svc('nginx', h.nginx_running, 'var(--green)')}
      </div>

      {/* Row 2 — metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1.3fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
        {metric(t('health.loadAverage'),
          <span style={{ color: loadColor }}>{h.load_1.toFixed(2)} <span style={{ fontSize: 10, opacity: 0.55 }}>1m</span></span>,
          `${h.load_5.toFixed(2)} 5m · ${h.load_15.toFixed(2)} 15m`,
          pbar(cpuPct, loadColor)
        )}
        {metric(t('health.cpuState'),
          <span style={{ color: loadColor }}>{cpuStateLabel} <span style={{ fontSize: 11 }}>{cpuPct.toFixed(0)}%</span></span>
        )}
        {metric(t('health.memoryUsage'),
          <span style={{ color: memColor }}>{h.mem_pct}%</span>,
          `${h.mem_used_mb} / ${h.mem_total_mb} MB`,
          pbar(h.mem_pct, memColor)
        )}
        {metric(t('health.diskUsage'),
          <span style={{ color: diskColor }}>{h.disk_pct}%</span>,
          `${h.disk_used_gb} / ${h.disk_total_gb} GB`,
          pbar(h.disk_pct, diskColor)
        )}
        {metric('NET ↓ RX',
          <span style={{ color: 'var(--accent)' }}>{h.net_rx_gb != null ? `${h.net_rx_gb} GB` : '—'}</span>,
          'since boot'
        )}
        {metric('NET ↑ TX',
          <span style={{ color: 'var(--purple)' }}>{h.net_tx_gb != null ? `${h.net_tx_gb} GB` : '—'}</span>,
          'since boot'
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t, lang, setLang } = useI18n();
  const [threatWindow, setThreatWindow] = useState<ThreatWindow>('7d');
  const statsUrl = apiUrl(`/api/stats?threatWindow=${threatWindow}`);
  const { data, error, mutate, isLoading } = useSWR<StatsResponse>(statsUrl, fetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
    refreshWhenHidden: true,
    dedupingInterval: 1_000,
  });
  const { data: fastStatus } = useSWR<FastStatus>(
    apiUrl('/api/status'),
    (url: string) => fetch(`${url}?_t=${Date.now()}`).then(r => r.json()),
    { refreshInterval: 3_000, revalidateOnFocus: true, refreshWhenHidden: true, dedupingInterval: 1_000 },
  );

  const mergedActive = (data?.active ?? []).map(u => {
    const fast = fastStatus?.users?.find(f => f.email === u.email);
    if (!fast) return u;
    if (fast.online) return { ...u, online: true, status: 'online' as const };
    if (u.status === 'online') return { ...u, online: false, status: 'recent' as const };
    return { ...u, online: false, status: u.status };
  });

  const [middleOpen,  setMiddleOpen]  = useState(true);
  const [keysOpen,    setKeysOpen]    = useState(true);
  const [healthOpen,  setHealthOpen]  = useState(false);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [delTarget,   setDelTarget]   = useState<string | null>(null);
  const [editTarget,  setEditTarget]  = useState<UserStat | null>(null);

  // §4.1 — Keys section controls
  const [userSearch,      setUserSearch]      = useState('');
  const [userGroupFilter, setUserGroupFilter] = useState('');
  const [userSort,        setUserSort]        = useState<'status' | 'name' | 'traffic' | 'last_seen'>('last_seen');
  const [viewMode,        setViewMode]        = useState<'grid' | 'compact' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('archie:user_view_mode');
      if (v === 'grid' || v === 'compact' || v === 'list') return v;
    }
    return 'grid';
  });
  // Per-key collapse overrides. Absent = default (online auto-expanded, everyone
  // else collapsed). Present = the user's explicit choice for that key.
  const [collapseOverrides, setCollapseOverrides] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('archie:user_collapse_overrides') ?? '{}'); } catch { /* */ }
    }
    return {};
  });

  function setViewModeAndSave(m: 'grid' | 'compact' | 'list') {
    setViewMode(m);
    localStorage.setItem('archie:user_view_mode', m);
  }
  // Default expansion: the 3 most-recently-active keys (online first, then by
  // last_seen). Always shows real cards, never empty, never all-open. A per-key
  // override (saved below) wins over this default.
  const autoExpandEmails = new Set(
    [...mergedActive]
      .sort((a, b) => {
        const ao = a.status === 'online' ? 1 : 0;
        const bo = b.status === 'online' ? 1 : 0;
        if (ao !== bo) return bo - ao;
        return (b.last_seen ?? '').localeCompare(a.last_seen ?? '');
      })
      .slice(0, 3)
      .map(u => u.email),
  );
  const isCollapsed = (email: string) =>
    email in collapseOverrides ? collapseOverrides[email] : !autoExpandEmails.has(email);
  function toggleCollapsed(email: string, currentlyCollapsed: boolean) {
    setCollapseOverrides(prev => {
      const next = { ...prev, [email]: !currentlyCollapsed };
      localStorage.setItem('archie:user_collapse_overrides', JSON.stringify(next));
      return next;
    });
  }

  const refresh = () => mutate();

  if (isLoading) return (
    <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-dim)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
      {t('loading')}
    </div>
  );
  if (error || !data) return <div style={{ padding: 32, color: 'var(--red)', fontSize: 13 }}>{t('error.loading')}: {String(error)}</div>;

  const activeCount   = mergedActive.filter(u => u.status === 'online' || u.status === 'recent').length;
  const totalAttacks  = (data.ssh_threats ?? []).reduce((s, th) => s + th.count, 0);
  const attackerCount = (data.ssh_threats ?? []).length;
  const uniqueCtx     = (data.stats?.unique_ips_24h ?? 0) <= 3 ? t('kpi.lowDiversity') : (data.stats?.unique_ips_24h ?? 0) <= 8 ? t('kpi.modDiversity') : t('kpi.highDiversity');
  const groups        = data.groups ?? [];
  const sparkConns    = (data.conns_hourly       ?? []).map(b => b.n);
  const sparkIps      = (data.unique_ips_hourly  ?? []).map(b => b.n);
  const sparkSsh      = (data.ssh_hourly         ?? []).map(b => b.n);
  const deviceWarnings = mergedActive.filter(u => (u.devices?.pending_count ?? 0) > 0 || u.deviceEstimate?.ispConflict);

  const sshAccent = attackerCount > 0 ? 'var(--red)' : 'var(--green)';

  return (
    <div style={{ padding: '22px 26px' }}>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, paddingTop: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>● Dashboard</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UtcClock />

          {/* Language toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginLeft: 4 }}>
            {(['en', 'ru', 'es', 'pt'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)} style={{
                background: lang === l ? 'var(--accent)' : 'transparent',
                color: lang === l ? 'var(--bg)' : 'var(--text-dim)',
                border: 'none', padding: '5px 9px', fontFamily: 'inherit',
                fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' as const,
              }}>{l.toUpperCase()}</button>
            ))}
          </div>

          <a href={securityPageUrl()} style={{ border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: 6, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
            {t('nav.security')}
          </a>

          {/* New key */}
          <button onClick={() => setNewUserOpen(true)} style={{ background: 'var(--accent)', color: 'var(--bg)', padding: '6px 14px', borderRadius: 6, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none' }}>
            {t('header.newKey')}
          </button>

        </div>
      </header>

      {/* ── Warning banner ── */}
      {deviceWarnings.length > 0 && (
        <a href={`${BASE_PATH}/devices`} style={{ textDecoration: 'none', display: 'block', marginBottom: 20 }}>
          <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span style={{ flex: 1 }}>
              {deviceWarnings.map((u, i) => (
                <span key={u.email}>{i > 0 && ' · '}
                  <strong style={{ color: 'var(--text-bright)' }}>{u.meta?.displayName ?? u.email}</strong>
                  {u.deviceEstimate?.ispConflict ? ` ${t('user.activeFromIsps', { count: String(u.deviceEstimate.conflictIsps.length) })}` : ` ${t('user.unapprovedBlockedDevice')}`}
                </span>
              ))}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </a>
      )}

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 28 }}>
        <KpiCard
          label={t('stats.activeNow')} value={activeCount}
          context={activeCount === 0 ? t('kpi.noActiveSessions') : `${activeCount} ${activeCount === 1 ? t('kpi.sessionActive') : t('kpi.sessionsActive')}`}
          contextColor={activeCount > 0 ? 'var(--green)' : undefined}
          accent="var(--green)" icon={<IconActivity c="var(--green)" />}
          gid="sgActiveNow"
        />
        <KpiCard
          label={t('stats.totalKeys')} value={(data.users ?? []).length}
          context={t('kpi.keysStored')}
          accent="var(--accent)" icon={<IconKey c="var(--accent)" />}
          gid="sgTotalKeys"
        />
        <KpiCard
          label={t('stats.conns24h')} value={(data.stats?.conns_24h ?? 0).toLocaleString()}
          context={t('kpi.connTotal')}
          accent="var(--accent)" icon={<IconGlobe c="var(--accent)" />}
          sparkData={sparkConns} gid="sgConns24h"
          trend={{ pct: data.conns_trend_pct ?? null, label: t('kpi.vsPrev24h') }}
        />
        <KpiCard
          label={t('stats.uniqueIps')} value={data.stats?.unique_ips_24h ?? 0}
          context={uniqueCtx}
          accent="var(--purple)" icon={<IconNetwork c="var(--purple)" />}
          sparkData={sparkIps} gid="sgUniqueIps"
        />
        <KpiCard
          label={t('stats.sshAttacks')} value={attackerCount > 0 ? totalAttacks : 0}
          context={attackerCount === 0 ? t('kpi.noAttacks') : `${t('kpi.sshWindow')} · ${attackerCount} ${t('kpi.attackerIps')}`}
          contextColor={attackerCount > 0 ? 'var(--red)' : undefined}
          accent={sshAccent} icon={<IconShield c={sshAccent} />}
          sparkData={sparkSsh} gid="sgSshAttacks"
        />
      </div>

      {/* ── Server health (collapsible) ── */}
      <SectionTitle onClick={() => setHealthOpen(o => !o)}>
        {t('section.serverHealth')} {healthOpen ? '▼' : '▶'}
      </SectionTitle>
      {healthOpen && data.server_health && (
        <HealthOverview h={data.server_health} t={t} />
      )}

      {/* ── Analytics (collapsible) ── */}
      <SectionTitle onClick={() => setMiddleOpen(o => !o)}>
        {t('section.analytics')} {middleOpen ? '▼' : '▶'}
      </SectionTitle>
      {middleOpen && (
        <MiddleSection
          data={data}
          threatWindow={threatWindow}
          onThreatWindowChange={setThreatWindow}
        />
      )}

      {/* ── Keys (collapsible) ── */}
      <SectionTitle onClick={() => setKeysOpen(o => !o)}>
        {t('section.keys')} {keysOpen ? '▼' : '▶'}
      </SectionTitle>
      {keysOpen && (() => {
        // Filter + sort
        const sortedUsers = [...mergedActive]
          .filter(u => {
            if (userSearch) {
              const q = userSearch.toLowerCase();
              if (!u.email.includes(q) && !(u.meta?.displayName ?? '').toLowerCase().includes(q)) return false;
            }
            if (userGroupFilter && (u.meta?.group ?? 'Ungrouped') !== userGroupFilter) return false;
            return true;
          })
          .sort((a, b) => {
            // Recency sort (default): currently-online first, then most-recently-seen.
            // Pure recency — owner is NOT pinned so the lead reflects real activity.
            if (userSort === 'last_seen') {
              const ao = a.status === 'online' ? 1 : 0;
              const bo = b.status === 'online' ? 1 : 0;
              if (ao !== bo) return bo - ao;
              return (b.last_seen ?? '').localeCompare(a.last_seen ?? '');
            }
            // Other sorts keep the owner pinned to the top.
            if (a.meta?.isOwner && !b.meta?.isOwner) return -1;
            if (!a.meta?.isOwner && b.meta?.isOwner) return 1;
            if (userSort === 'name') return (a.meta?.displayName ?? a.email).localeCompare(b.meta?.displayName ?? b.email);
            if (userSort === 'traffic') return (b.traffic?.total ?? 0) - (a.traffic?.total ?? 0);
            const order = { online: 0, recent: 1, offline: 2 };
            return order[a.status] - order[b.status];
          });

        const autoMode = mergedActive.length <= 8 ? 'grid' : mergedActive.length <= 25 ? 'compact' : 'list';
        const effectiveMode = viewMode;
        const gridCols = effectiveMode === 'grid' ? 'repeat(3,minmax(320px,1fr))' : effectiveMode === 'compact' ? 'repeat(auto-fill,minmax(280px,1fr))' : '1fr';

        return (
          <>
            {/* Control bar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder="Search name or email…"
                style={{ flex: 1, minWidth: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', color: 'var(--text-bright)', fontSize: 11, outline: 'none' }}
              />
              {groups.length > 0 && (
                <select value={userGroupFilter} onChange={e => setUserGroupFilter(e.target.value)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', color: userGroupFilter ? 'var(--text-bright)' : 'var(--text-faint)', fontSize: 11, outline: 'none' }}>
                  <option value="">All groups</option>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
              <select value={userSort} onChange={e => setUserSort(e.target.value as typeof userSort)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', color: 'var(--text-bright)', fontSize: 11, outline: 'none' }}>
                <option value="status">Status</option>
                <option value="name">Name</option>
                <option value="traffic">Traffic</option>
                <option value="last_seen">Last seen</option>
              </select>
              {/* View mode toggle */}
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                {(['grid', 'compact', 'list'] as const).map(m => (
                  <button key={m} onClick={() => setViewModeAndSave(m)} title={m === 'grid' ? 'Grid (3 col)' : m === 'compact' ? 'Compact (multi-col)' : 'List (strips)'}
                    style={{ background: viewMode === m ? 'var(--accent-dim)' : 'transparent', border: 'none', cursor: 'pointer', padding: '5px 9px', color: viewMode === m ? 'var(--accent)' : 'var(--text-dim)', fontSize: 11, fontFamily: 'inherit', fontWeight: 700 }}>
                    {m === 'grid' ? '▦' : m === 'compact' ? '⊞' : '≡'}
                  </button>
                ))}
              </div>
              {mergedActive.length !== sortedUsers.length && (
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{sortedUsers.length}/{mergedActive.length}</span>
              )}
              {viewMode !== autoMode && (
                <button onClick={() => setViewModeAndSave(autoMode)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'inherit', padding: 0 }}>
                  auto
                </button>
              )}
            </div>

            {/* Cards */}
            {viewMode === 'list' ? (
              // List mode: group headers + strips
              (() => {
                const byGroup = sortedUsers.reduce<Record<string, typeof sortedUsers>>((acc, u) => {
                  const g = u.meta?.group || 'Ungrouped';
                  (acc[g] ??= []).push(u);
                  return acc;
                }, {});
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
                    {Object.entries(byGroup).map(([grp, users]) => {
                      const gc = groupColor(grp === 'Ungrouped' ? '' : grp);
                      return (
                        <div key={grp}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, paddingBottom: 5, borderBottom: `2px solid ${gc}4d` }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: gc, flexShrink: 0, display: 'inline-block' }} />
                            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: gc, textTransform: 'uppercase' }}>{grp}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 400, letterSpacing: 0 }}>· {users.length} {users.length === 1 ? 'user' : 'users'}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                              {users.filter(u => u.status === 'online').length > 0 && <span style={{ color: 'var(--green)' }}>● {users.filter(u => u.status === 'online').length} online</span>}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {users.map(u => (
                              <UserCard key={u.email} u={u} onRefresh={refresh} onEdit={setEditTarget} onDelete={setDelTarget} collapsed={true} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 16, alignItems: 'start', marginBottom: 8 }}>
                {sortedUsers.map(u => {
                  const collapsed = isCollapsed(u.email);
                  return (
                    <UserCard
                      key={u.email}
                      u={u}
                      onRefresh={refresh}
                      onEdit={setEditTarget}
                      onDelete={setDelTarget}
                      collapsed={collapsed}
                      onToggleCollapse={() => toggleCollapsed(u.email, collapsed)}
                    />
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Legend — two distinct axes ── */}
      <div style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Connectivity: is the client connected right now */}
        <div style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--text-dim)' }}>{t('legend.connectivity')}</span>
          {[[t('user.online'),'var(--green)'],[t('user.recent'),'var(--yellow)'],[t('user.offline'),'var(--text-faint)']].map(([l,c]) => (
            <span key={l} style={{ marginLeft: 8 }}><span style={{ color: c }}>●</span> {l}</span>
          ))}
          <span style={{ marginLeft: 8, fontStyle: 'italic', opacity: 0.8 }}>— {t('legend.onlineMeans')}</span>
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        {/* Key state: is the key usable at all */}
        <div style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--text-dim)' }}>{t('legend.keyState')}</span>
          {[[t('user.active'),'var(--green)'],[t('user.keyDisabled'),'var(--text-faint)'],[t('user.keyExpiredShort'),'var(--red)']].map(([l,c]) => (
            <span key={l} style={{ marginLeft: 8 }}><span style={{ color: c }}>●</span> {l}</span>
          ))}
          <span style={{ marginLeft: 8, fontStyle: 'italic', opacity: 0.8 }}>— {t('legend.activeMeans')}</span>
        </div>
      </div>

      {/* ── Modals ── */}
      {newUserOpen && <NewUserModal groups={groups} onClose={() => setNewUserOpen(false)} onCreated={refresh} />}
      {delTarget   && <DeleteUserModal email={delTarget} onClose={() => setDelTarget(null)} onDeleted={refresh} />}
      {editTarget  && <MetaEditModal u={editTarget} groups={groups} onClose={() => setEditTarget(null)} onSaved={refresh} />}
    </div>
  );
}
