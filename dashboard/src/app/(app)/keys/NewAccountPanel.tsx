'use client';
import { useState } from 'react';
import { apiUrl } from '@/lib/api-path';
import { useI18n } from '@/lib/i18n';
import type { AuthRole } from '@/lib/auth-users';

const fs: React.CSSProperties = { width: '100%', background: '#0a0f18', border: '1px solid rgba(74,108,149,0.25)', borderRadius: 7, padding: '8px 10px', color: '#eef3f8', fontSize: 12, outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
function FL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(180,195,215,0.45)', marginBottom: 5, textTransform: 'uppercase' }}>{children}</div>;
}

export default function NewAccountPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AuthRole>('viewer');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!username || !password) { setError(t('keys.errCredRequired')); return; }
    setCreating(true); setError('');
    const r = await fetch(apiUrl('/api/auth/accounts'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName: displayName || username, role, password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error ?? 'Failed'); setCreating(false); }
    else onCreated();
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(74,108,149,0.2)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#00d4ff', textTransform: 'uppercase' }}>{t('keys.newLocalUser')}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(180,195,215,0.4)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
      </div>
      {error && <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,77,90,0.1)', color: '#ff7d86', fontSize: 12 }}>{error}</div>}

      <FL>{t('keys.fieldUsername')}</FL>
      <input value={username} onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="e.g. john" style={fs} />

      <FL>{t('keys.fieldDisplayNameOpt')}</FL>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. John Smith" style={fs} />

      <FL>{t('keys.fieldAccessRole')}</FL>
      <select value={role} onChange={e => setRole(e.target.value as AuthRole)} style={{ ...fs }}>
        <option value="viewer">{t('keys.roleViewer')}</option>
        <option value="operator">{t('keys.roleOperator')}</option>
        <option value="admin">{t('keys.roleAdmin')}</option>
        <option value="owner">{t('keys.roleOwner')}</option>
      </select>

      <div style={{ marginBottom: 12 }}>
        <FL>{t('keys.fieldPassword')}</FL>
        <div style={{ position: 'relative' }}>
          <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} style={{ ...fs, marginBottom: 0, paddingRight: 50 }} />
          <button type="button" onClick={() => setShowPw(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(180,195,215,0.4)', fontSize: 10, fontWeight: 700 }}>
            {showPw ? t('keys.hidePw') : t('keys.showPw')}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(255,179,71,0.06)', border: '1px solid rgba(255,179,71,0.15)', borderRadius: 7, fontSize: 11, color: 'rgba(255,179,71,0.7)', lineHeight: 1.5 }}>
        {t('keys.roleGuide')}
      </div>

      <button onClick={create} disabled={creating} style={{ width: '100%', background: creating ? 'rgba(0,212,255,0.4)' : '#00d4ff', color: '#041019', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 11, fontWeight: 800, cursor: creating ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        {creating ? t('keys.creating') : t('keys.createSystemUser')}
      </button>
    </div>
  );
}
