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

function PasswordField({ value, onChange, autoComplete, label }: {
  value: string; onChange: (v: string) => void;
  autoComplete: string; label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(180,195,215,0.54)', marginBottom: 6 }}>{label}</label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          style={{ ...inputStyle, marginBottom: 0 }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(180,195,215,0.5)', padding: '2px 4px', lineHeight: 0, display: 'flex',
          }}
        >
          {show ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
      </div>
    </>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/auth/session'))
      .then((r) => r.json())
      .then((body) => {
        // If already authenticated, go straight to dashboard
        if (body?.authenticated) { window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3') + '/'); return; }
        // If users exist but not authenticated, go to login
        if (body && body.setupRequired === false) router.replace('/login');
      })
      .catch(() => {});
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/auth/setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Setup failed'); return; }
      window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3') + '/');
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#060b14', padding: 24 }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 460, background: 'rgba(8,14,25,0.98)', border: '1px solid rgba(67,99,142,0.34)', borderRadius: 16, padding: 28 }}>
        <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid rgba(67,99,142,0.18)' }}>
          <Image
            src={apiUrl('/assets/archie-header-transparent-dark.png')}
            alt="Archie VPN & Security Management"
            width={2072} height={536} priority
            style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }}
          />
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.4, textTransform: 'uppercase', color: '#00d4ff', marginBottom: 10 }}>Initial Access Setup</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(214,225,239,0.78)', marginBottom: 18 }}>
          Create the first owner account. Once done, setup closes and all access goes through sign-in.
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,77,90,0.1)', border: '1px solid rgba(255,77,90,0.22)', color: '#ff7d86', fontSize: 12 }}>
            {error}
          </div>
        )}

        <label style={{ display: 'block', fontSize: 11, color: 'rgba(180,195,215,0.54)', marginBottom: 6 }}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={inputStyle} />

        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />

        <button type="submit" disabled={submitting} style={{ width: '100%', border: 'none', borderRadius: 8, padding: '11px 14px', background: submitting ? 'rgba(0,212,255,0.45)' : '#00d4ff', color: '#041019', fontSize: 13, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}>
          {submitting ? 'Creating owner…' : 'Create owner account'}
        </button>
      </form>
    </div>
  );
}
