'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { IconShieldLock } from '@tabler/icons-react';
import { apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';

type ProtectionMode = 'temp-ban' | 'permanent-deny';

function modeTone(mode?: ProtectionMode) {
  if (mode === 'permanent-deny') {
    return {
      color: 'var(--red)',
      bg: 'var(--red-dim)',
      border: 'var(--red)',
      glow: '0 0 10px var(--red-dim)',
    };
  }
  return {
    color: 'var(--green)',
    bg: 'var(--green-dim)',
    border: 'var(--green)',
    glow: '0 0 10px var(--green-dim)',
  };
}

export default function Topbar() {
  const { t, lang, setLang } = useI18n();
  const { data } = useSWR<{ mode: ProtectionMode }>(
    apiUrl('/api/security-mode'),
    fetchJson,
    { refreshInterval: 20_000, dedupingInterval: 2_000, revalidateOnFocus: true },
  );

  const mode = data?.mode ?? 'temp-ban';
  const tone = modeTone(mode);
  const modeLabel = mode === 'permanent-deny' ? t('topbar.permanentDeny') : t('topbar.tempBan');

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 30,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '10px 18px',
      background: 'color-mix(in srgb, var(--surface) 84%, transparent)',
      borderBottom: '1px solid var(--border)',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Language switcher */}
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        {(['en', 'ru', 'es', 'pt'] as const).map(l => (
          <button key={l} onClick={() => setLang(l)} style={{
            background: lang === l ? 'var(--accent)' : 'transparent',
            color: lang === l ? 'var(--bg)' : 'var(--text-dim)',
            border: 'none', padding: '5px 9px', fontFamily: 'inherit',
            fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
          }}>{l.toUpperCase()}</button>
        ))}
      </div>

      <Link
        href="/settings"
        style={{
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 999,
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          boxShadow: tone.glow,
          color: 'var(--text-bright)',
          minWidth: 0,
        }}
      >
        <div style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-hover)',
          color: tone.color,
          flexShrink: 0,
        }}>
          <IconShieldLock size={14} stroke={1.9} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            lineHeight: 1.1,
          }}>
            {t('topbar.protectionMode')}
          </span>
          <span style={{
            fontSize: 11.5,
            fontWeight: 800,
            color: tone.color,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}>
            {modeLabel}
          </span>
        </div>
      </Link>
    </div>
  );
}
