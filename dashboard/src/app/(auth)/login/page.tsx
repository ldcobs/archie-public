'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api-path';

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0f18',
  border: '1px solid rgba(74,108,149,0.3)', borderRadius: 8,
  padding: '10px 40px 10px 12px', color: '#eef3f8',
  fontSize: 14, outline: 'none', marginBottom: 14, boxSizing: 'border-box',
};

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/auth/session'))
      .then((r) => r.json())
      .then((body) => {
        if (body?.authenticated) { window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3') + '/'); return; }
        if (body?.setupRequired) router.replace('/setup');
      })
      .catch(() => {});
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Login failed'); return; }
      window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3') + '/');
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#060b14', padding: 24 }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 420, background: 'rgba(8,14,25,0.98)', border: '1px solid rgba(67,99,142,0.34)', borderRadius: 16, padding: 28 }}>
        <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid rgba(67,99,142,0.18)' }}>
          <Image
            src={apiUrl('/assets/archie-header-transparent-dark.png')}
            alt="Archie VPN & Security Management"
            width={2072} height={536} priority
            style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }}
          />
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.4, textTransform: 'uppercase', color: '#00d4ff', marginBottom: 10 }}>Archie Access</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(214,225,239,0.78)', marginBottom: 18 }}>
          Sign in to access the VPN operations dashboard.
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,77,90,0.1)', border: '1px solid rgba(255,77,90,0.22)', color: '#ff7d86', fontSize: 12 }}>
            {error}
          </div>
        )}

        <label style={{ display: 'block', fontSize: 11, color: 'rgba(180,195,215,0.54)', marginBottom: 6 }}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={inputStyle} />

        <label style={{ display: 'block', fontSize: 11, color: 'rgba(180,195,215,0.54)', marginBottom: 6 }}>Password</label>
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(180,195,215,0.45)', padding: 4, lineHeight: 0,
              display: 'flex', alignItems: 'center',
            }}
          >
            {showPassword ? (
              /* Eye open — password visible, click to hide */
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              /* Eye closed — password hidden, click to show */
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </button>
        </div>

        <button type="submit" disabled={submitting} style={{ width: '100%', border: 'none', borderRadius: 8, padding: '11px 14px', background: submitting ? 'rgba(0,212,255,0.45)' : '#00d4ff', color: '#041019', fontSize: 13, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
