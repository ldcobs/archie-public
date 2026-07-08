'use client';
import type { IpInfo, ReputationResult } from '@/lib/types';

// ── Time helpers ──────────────────────────────────────────────────────────────

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

// ── IP Tag ────────────────────────────────────────────────────────────────────

// Group color palette — used for card borders and section headers
export const GROUP_COLORS: Record<string, string> = {
  'My VPN':    '#00d4ff',
  'Work':      '#f0e050',
  'Family':    '#bd93f9',
};
export function groupColor(group: string): string {
  if (!group) return 'rgba(180,195,215,0.25)';
  if (GROUP_COLORS[group]) return GROUP_COLORS[group];
  // Deterministic visible color from group name
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) & 0xffff;
  return `hsl(${(h % 260) + 160}, 60%, 58%)`; // 160-420 hue → avoids harsh red range
}

export function IpTag({ info, active, showIsp, mobile }: { info: IpInfo; active?: boolean; showIsp?: boolean; mobile?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, padding: '4px 8px',
        background: active ? 'var(--green-dim)' : 'var(--surface-hover)',
        border: `1px solid ${active ? 'rgba(57,211,83,.35)' : 'var(--border)'}`,
        borderRadius: 6,
      }}
    >
      <span style={{ color: 'var(--accent)' }}>{info.ip}</span>
      {info.flag && <span>{info.flag}</span>}
      {info.label && <span style={{ color: 'var(--muted)', fontSize: 10 }}>{info.label}</span>}
      {showIsp && info.isp && (
        <span
          style={{ color: 'var(--muted)', fontSize: 10, opacity: .75, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={info.isp}
        >
          {info.isp}
        </span>
      )}
      {mobile !== undefined && (
        <span style={{ fontSize: 8, padding: "0px 4px", borderRadius: 3, lineHeight: "14px", background: mobile ? "rgba(255,184,0,.15)" : "rgba(57,211,83,.1)", color: mobile ? "#ffb800" : "var(--green)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {mobile ? "cell" : "wifi"}
        </span>
      )}
    </span>
  );
}

// ── Reputation badge ──────────────────────────────────────────────────────────

export function RepBadge({ rep }: { rep: ReputationResult | null }) {
  if (!rep) return null;
  const cls = rep.score >= 80 ? { bg: 'rgba(255,68,68,.2)', color: 'var(--red)' }
            : rep.score >= 25 ? { bg: 'rgba(240,224,80,.15)', color: 'var(--yellow)' }
            : { bg: 'rgba(57,211,83,.15)', color: 'var(--green)' };
  const label = rep.score >= 80 ? 'HIGH' : rep.score >= 25 ? 'Susp.' : 'Clean';
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, padding: '1px 5px', borderRadius: 3,
      fontWeight: 700, marginLeft: 4, background: cls.bg, color: cls.color,
    }}
      title={`Score: ${rep.score}/100 | ${rep.categories.join(', ') || 'No categories'} | Reports: ${rep.total_reports} | ISP: ${rep.isp}`}
    >
      {rep.score}% {label}
      {rep.is_tor && <span style={{ marginLeft: 3, background: 'rgba(189,147,249,.2)', color: 'var(--purple)', padding: '1px 4px', borderRadius: 3 }}>TOR</span>}
    </span>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant = 'accent' | 'ok' | 'warn' | 'alert' | 'muted';
export function Badge({ children, variant = 'accent' }: { children: React.ReactNode; variant?: BadgeVariant }) {
  const styles: Record<BadgeVariant, React.CSSProperties> = {
    accent: { background: 'rgba(0,212,255,.1)', color: 'var(--accent)', border: '1px solid rgba(0,212,255,.2)' },
    ok:     { background: 'rgba(57,211,83,.1)',  color: 'var(--green)',  border: '1px solid rgba(57,211,83,.2)' },
    warn:   { background: 'rgba(240,224,80,.1)', color: 'var(--yellow)', border: '1px solid rgba(240,224,80,.2)' },
    alert:  { background: 'rgba(255,68,68,.1)',  color: 'var(--red)',    border: '1px solid rgba(255,68,68,.2)' },
    muted:  { background: 'rgba(255,255,255,.04)', color: 'var(--muted)', border: '1px solid var(--border)' },
  };
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontFamily: 'inherit', ...styles[variant] }}>
      {children}
    </span>
  );
}

// ── KPI helpers ───────────────────────────────────────────────────────────────

/** Smart compact number: 999→999  1234→1.2k  10000→10k  1500000→1.5M */
export function fmtKpi(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1e9)   return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'G';
  if (v >= 1e6)   return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 10000) return Math.round(v / 1000) + 'k';
  if (v >= 1000)  return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

type KpiVariant = 'accent' | 'green' | 'red' | 'amber' | 'purple' | 'muted';
type KpiDeltaDir = 'up' | 'down' | 'neutral';

const KPI_ACCENT: Record<KpiVariant, string> = {
  accent: 'var(--accent)',
  green:  'var(--green)',
  red:    'var(--red)',
  amber:  'var(--amber)',
  purple: 'var(--purple)',
  muted:  'var(--muted)',
};

const DELTA_COLOR: Record<KpiDeltaDir, string> = {
  up:      '#d63b3b',
  down:    '#1e8f52',
  neutral: 'var(--text-dim)',
};

function DeltaArrow({ dir }: { dir: KpiDeltaDir }) {
  const c = DELTA_COLOR[dir];
  if (dir === 'up') return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <line x1="7" y1="25" x2="25" y2="7" stroke={c} strokeWidth="5" strokeLinecap="round"/>
      <polyline points="13,7 25,7 25,19" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (dir === 'down') return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <line x1="7" y1="7" x2="25" y2="25" stroke={c} strokeWidth="5" strokeLinecap="round"/>
      <polyline points="13,25 25,25 25,13" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  return (
    <svg width="26" height="14" viewBox="0 0 32 14" fill="none" style={{ flexShrink: 0 }}>
      <line x1="4" y1="7" x2="28" y2="7" stroke={c} strokeWidth="3.5" strokeLinecap="round"/>
    </svg>
  );
}

export function KpiCard({
  label, value, sub, variant = 'accent', delta, deltaDir = 'neutral', style,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  variant?: KpiVariant;
  delta?: React.ReactNode;
  deltaDir?: KpiDeltaDir;
  style?: React.CSSProperties;
}) {
  const accentColor = KPI_ACCENT[variant];
  const deltaColor  = DELTA_COLOR[deltaDir];
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderTop: `2px solid ${accentColor}`,
      borderRadius: 'var(--r-xl)',
      padding: 'var(--sp-4)',
      minHeight: 96,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      ...style,
    }}>
      {/* Labels */}
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>{sub}</div>}
      </div>

      {/* Number row — value left, arrow+delta inline pushed right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <div style={{ fontSize: 'clamp(18px, 2.2vw, 30px)', fontWeight: 700, color: 'var(--text-bright)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {value}
        </div>
        {delta !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <DeltaArrow dir={deltaDir} />
            <span style={{ fontSize: 13, fontWeight: 700, color: deltaColor, lineHeight: 1 }}>{delta}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Area / line chart ─────────────────────────────────────────────────────────

export type ChartSeries = { id: string; label: string; color: string; data: { h: number; n: number }[] };

function smoothLine(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length === 1 ? `M ${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i];
    const mx = (p[0] + c[0]) / 2;
    d += ` C ${mx} ${p[1]}, ${mx} ${c[1]}, ${c[0]} ${c[1]}`;
  }
  return d;
}

export function MultiLineChart({
  series, h = 100, legend = true,
}: {
  series: ChartSeries[];
  h?: number;
  legend?: boolean;
}) {
  const W = 600;
  const PT = 8, PR = 4, PB = 18, PL = 30;
  const cw = W - PL - PR, ch = h - PT - PB;

  const allN = series.flatMap(s => s.data.map(d => d.n));
  const maxN = Math.max(...allN, 1);

  const xOf = (hAgo: number) => PL + ((23 - hAgo) / 23) * cw;
  const yOf = (n: number)    => PT + ch - (n / maxN) * ch;

  const gridVals = [0, 0.5, 1].map(f => Math.round(f * maxN));
  const tickHours = [23, 18, 12, 6, 0];

  return (
    <div>
      {legend && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
          {series.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 16, height: 2, borderRadius: 2, background: s.color }} />
              <span style={{ fontSize: 8, color: 'var(--axis-text)', fontWeight: 600 }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
        <defs>
          {series.map(s => (
            <linearGradient key={s.id} id={`ag-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={s.color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.00} />
            </linearGradient>
          ))}
        </defs>

        {gridVals.map((v, i) => {
          const y = yOf(v);
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--grid-line)" strokeWidth={0.5} />
              <text x={PL - 3} y={y + 3} textAnchor="end" fontSize={7} fill="var(--axis-text)">
                {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
              </text>
            </g>
          );
        })}

        {tickHours.map(hAgo => (
          <text key={hAgo} x={xOf(hAgo)} y={h - 2} textAnchor="middle" fontSize={7} fill="var(--axis-text-2)">
            {hAgo === 0 ? 'now' : `${hAgo}h`}
          </text>
        ))}

        {series.map(s => {
          const pts = [...s.data].sort((a, b) => b.h - a.h).map(d => [xOf(d.h), yOf(d.n)] as [number, number]);
          if (pts.length < 2) return null;
          const line = smoothLine(pts);
          const area = `${line} L ${pts[pts.length - 1][0]} ${PT + ch} L ${pts[0][0]} ${PT + ch} Z`;
          return (
            <g key={s.id}>
              <path d={area} fill={`url(#ag-${s.id})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={1.2} strokeLinejoin="round" />
              <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={s.color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 18px', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </span>
      {badge}
    </div>
  );
}

// ── Section title ─────────────────────────────────────────────────────────────

export function SectionTitle({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      style={{ fontSize: 10, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2, margin: '22px 0 10px', cursor: onClick ? 'pointer' : undefined, userSelect: 'none' }}
      onClick={onClick}
    >
      ● {children}
    </div>
  );
}

// ── Btn ───────────────────────────────────────────────────────────────────────

export function Btn({
  children, onClick, variant = 'default', disabled, style, small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  style?: React.CSSProperties;
  small?: boolean;
}) {
  const base: React.CSSProperties = {
    fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? .45 : 1,
    borderRadius: 6, border: 'none', transition: 'opacity .2s',
    fontSize: small ? 10 : 11, padding: small ? '3px 8px' : '7px 16px', fontWeight: 600,
  };
  const variants: Record<string, React.CSSProperties> = {
    default: { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' },
    primary: { background: 'var(--accent)', color: '#000' },
    danger:  { background: 'var(--red)', color: '#fff' },
    ghost:   { background: 'none', border: 'none', color: 'var(--muted)', padding: '4px 6px' },
  };
  return (
    <button style={{ ...base, ...variants[variant], ...style }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
