'use client';
import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { apiUrl } from '@/lib/api-path';
import type { IpInfo } from '@/lib/types';

export type DeviceStatus = 'approved' | 'pending' | 'blocked';

const COLORS: Record<DeviceStatus, { bg: string; border: string; text: string }> = {
  approved: { bg: 'var(--green-dim)',  border: 'var(--green)',   text: 'var(--green)' },
  pending:  { bg: 'var(--amber-dim)',  border: 'var(--amber)',   text: 'var(--amber)' },
  blocked:  { bg: 'var(--red-dim)',    border: 'var(--red)',     text: 'var(--red)' },
};

// Global: only one chip popover open at a time
const OPEN_EVENT = 'devicechip:open';

export function DeviceChip({
  ip, status, activeNow, email, onDone,
}: {
  ip: IpInfo;
  status: DeviceStatus;
  activeNow: boolean;
  email: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const chipId = useRef(`chip-${id}`);
  const c = COLORS[status];

  // Close when another chip opens
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== chipId.current) setOpen(false);
    };
    document.addEventListener(OPEN_EVENT, handler);
    return () => document.removeEventListener(OPEN_EVENT, handler);
  }, []);

  // Click-outside / scroll / resize to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 50);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: chipId.current }));
      const r = chipRef.current?.getBoundingClientRect();
      if (r) {
        const POP_H = 220; // approx popover height
        const openUp = r.bottom + POP_H > window.innerHeight && r.top > POP_H;
        setPos({
          top: openUp ? r.top - 6 : r.bottom + 6,
          left: Math.min(r.left, window.innerWidth - 252),
          openUp,
        });
      }
    }
    setOpen(o => !o);
  }

  async function act(action: 'approve' | 'reject' | 'unblock') {
    setBusy(true);
    try {
      if (action === 'unblock') {
        await fetch(apiUrl(`/api/devices/blocked?email=${encodeURIComponent(email)}&ip=${encodeURIComponent(ip.ip)}`), { method: 'DELETE' });
      } else {
        await fetch(apiUrl(`/api/devices/${encodeURIComponent(email)}/${encodeURIComponent(ip.ip)}/${action}`), { method: 'POST' });
      }
      onDone();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const label = ip.isp ? ip.isp.split(' ').slice(0, 2).join(' ') : (ip.country ?? '');

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Chip */}
      <span
        ref={chipRef}
        onClick={toggle}
        title={`${ip.ip} · ${ip.country ?? ''} · ${ip.isp ?? ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 5,
          background: open ? `${c.border}22` : c.bg,
          border: `1px solid ${c.border}`,
          fontSize: 10, fontFamily: 'monospace', color: c.text,
          boxShadow: activeNow ? `0 0 6px ${c.border}88` : 'none',
          whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.1s',
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.85 }}>
          {status === 'blocked' ? '✗' : status === 'pending' ? '?' : activeNow ? '●' : '○'}
        </span>
        {ip.flag && <span>{ip.flag}</span>}
        <span>{ip.ip}</span>
        {label && (
          <span style={{ fontSize: 9, opacity: 0.55, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </span>
        )}
      </span>

      {/* Popover — portaled & fixed so it can't be clipped by any overflow:hidden ancestor */}
      {open && pos && createPortal(
        <div ref={popRef} style={{
          position: 'fixed',
          top: pos.openUp ? undefined : pos.top,
          bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
          left: pos.left, zIndex: 9999,
          background: 'var(--surface)', border: `1px solid ${c.border}`,
          borderRadius: 8, padding: '10px 12px',
          minWidth: 200, maxWidth: 240,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          {/* IP header */}
          <div style={{ marginBottom: 8, paddingBottom: 7, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-bright)' }}>{ip.ip}</div>
            {ip.flag && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
              {ip.flag} {[ip.city, ip.country].filter(Boolean).join(', ')}
            </div>}
            {ip.isp && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{ip.isp}</div>}
            {(ip as { mobile?: boolean }).mobile !== undefined && (
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                  background: (ip as { mobile?: boolean }).mobile ? 'var(--amber-dim)' : 'var(--green-dim)',
                  color: (ip as { mobile?: boolean }).mobile ? 'var(--amber)' : 'var(--green)' }}>
                  {(ip as { mobile?: boolean }).mobile ? 'mobile' : 'wifi'}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {status === 'pending' && <>
              <ActionBtn label="✓  Approve" color="var(--green)" disabled={busy} onClick={() => act('approve')} />
              <ActionBtn label="✗  Reject"  color="var(--red)" disabled={busy} onClick={() => act('reject')} />
            </>}
            {status === 'blocked' && (
              <ActionBtn label="↩  Unblock" color="var(--amber)" disabled={busy} onClick={() => act('unblock')} />
            )}
            {status === 'approved' && (
              <ActionBtn label="✗  Remove"  color="var(--red)" disabled={busy} onClick={() => act('reject')} />
            )}
            <ActionBtn label="✕  Close" color="var(--text-faint)" disabled={busy} onClick={() => setOpen(false)} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ActionBtn({ label, color, disabled, onClick }: { label: string; color: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        background: 'none', border: `1px solid ${color}44`, borderRadius: 6,
        color, fontSize: 11, fontWeight: 600, padding: '6px 10px',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        textAlign: 'left', width: '100%', fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = `${color}15`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
    >{label}</button>
  );
}
