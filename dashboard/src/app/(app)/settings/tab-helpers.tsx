'use client';

import React from 'react';
import { IconChevronDown } from '@tabler/icons-react';

// Shared sans/UI primitives for the redesigned Settings tabs.

export function SettingsCard({
  title, subtitle, action, children, pad = true,
}: {
  title?: string; subtitle?: string; action?: React.ReactNode;
  children: React.ReactNode; pad?: boolean;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            {title && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)' }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}
      <div style={{ padding: pad ? '18px 20px' : 0 }}>{children}</div>
    </div>
  );
}

export function Field({
  label, hint, children, span,
}: { label: string; hint?: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

const controlStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '9px 11px', color: 'var(--text-bright)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...controlStyle, ...(props.style || {}) }} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...controlStyle, resize: 'vertical', lineHeight: 1.5, ...(props.style || {}) }} />;
}

export function Select({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...controlStyle, appearance: 'none', paddingRight: 30, cursor: 'pointer' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <IconChevronDown size={15} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
    </div>
  );
}

export function Segmented({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, padding: '8px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
              border: 'none', borderLeft: i ? '1px solid var(--border)' : 'none',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)',
              transition: 'background 0.12s, color 0.12s',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

export function Toggle({
  on, onChange, onLabel, offLabel,
}: { on: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <button
        role="switch" aria-checked={on}
        onClick={() => onChange(!on)}
        style={{
          width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: on ? 'var(--green)' : 'var(--border)', position: 'relative', padding: 0,
          transition: 'background 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s',
        }} />
      </button>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? 'var(--green)' : 'var(--text-dim)' }}>{on ? onLabel : offLabel}</span>
    </div>
  );
}
