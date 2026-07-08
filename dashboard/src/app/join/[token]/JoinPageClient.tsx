'use client';

import { useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { IconShield, IconCheck, IconAlertCircle, IconLoader2, IconCopy } from '@tabler/icons-react';
import { apiUrl } from '@/lib/api-path';

type Phase = 'form' | 'loading' | 'done' | 'error';

const page: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg)', padding: 24,
};
const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 16, padding: '40px 36px', maxWidth: 420, width: '100%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
};
const input: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '10px 12px', color: 'var(--text-bright)',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
  background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 14,
  cursor: 'pointer', marginTop: 16,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-dim)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em',
};

export function JoinPageClient({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase('loading');
    try {
      const res = await fetch(apiUrl('/api/invite/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: name.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setPhase('error'); return; }
      setSubUrl(data.subUrl);
      setPhase('done');
    } catch {
      setError('Network error — please try again.');
      setPhase('error');
    }
  }

  function copyUrl() {
    copyText(subUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div style={page}>
      <div style={card}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconShield size={22} color="var(--accent)" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-bright)', lineHeight: 1.2 }}>Your VPN is ready</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>Set up your personal access key below</div>
          </div>
        </div>

        {phase === 'form' && (
          <form onSubmit={handleSubmit}>
            <label style={label} htmlFor="name">Choose a username</label>
            <input
              id="name"
              style={input}
              placeholder="e.g. john"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="off"
              pattern="[a-z0-9_-]+"
              title="Letters, numbers, hyphens and underscores only"
              required
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>
              Letters, numbers, hyphens and underscores only — no spaces.
            </div>
            <button style={btn} type="submit">Get my VPN key →</button>
          </form>
        )}

        {phase === 'loading' && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)' }}>
            <IconLoader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 12, fontSize: 14 }}>Creating your key…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {phase === 'done' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 14px', background: 'var(--green-dim)', borderRadius: 10, border: '1px solid var(--green)' }}>
              <IconCheck size={20} color="var(--green)" />
              <span style={{ fontSize: 14, color: 'var(--green)', fontWeight: 600 }}>Key created successfully!</span>
            </div>
            {/* Universal sub URL */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Subscription URL <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— works with Hiddify, Amnezia, v2rayNG</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: 1, padding: '9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-bright)', wordBreak: 'break-all' }}>
                {subUrl}
              </div>
              <button onClick={copyUrl} style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: copied ? 'var(--green-dim)' : 'var(--surface-hover)', color: copied ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer', fontSize: 13 }}>
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </button>
            </div>

            {/* Format-specific downloads */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Or download a config file
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                { label: 'Clash / Mihomo', fmt: 'clash', ext: '.yaml' },
                { label: 'SingBox', fmt: 'singbox', ext: '.json' },
              ].map(({ label: lbl, fmt, ext }) => (
                <a
                  key={fmt}
                  href={`${subUrl}?format=${fmt}`}
                  download
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-hover)', color: 'var(--text-dim)', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  ↓ {lbl} {ext}
                </a>
              ))}
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text-dim)' }}>Hiddify / Amnezia:</strong> tap + → Import from URL.<br />
              <strong style={{ color: 'var(--text-dim)' }}>v2rayNG:</strong> tap ☰ → Import → URL.<br />
              <strong style={{ color: 'var(--text-dim)' }}>SingBox / Clash Verge:</strong> use the config file download above.
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: '14px 16px', background: 'var(--red-dim)', borderRadius: 10, border: '1px solid var(--red)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <IconAlertCircle size={18} color="var(--red)" />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>Could not activate key</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{error}</div>
            <button style={{ ...btn, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', marginTop: 14 }} onClick={() => { setPhase('form'); setError(''); }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
