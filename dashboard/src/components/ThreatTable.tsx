'use client';
import type { ThreatEntry, Fail2banEntry } from '@/lib/types';
import { Panel, PanelHeader, Badge, RepBadge } from './ui';
import { apiUrl } from '@/lib/api-path';
import { useI18n } from '@/lib/i18n';

function BlockBtn({ ip, perm, onAction }: { ip: string; perm: boolean; onAction: () => void }) {
  const { t } = useI18n();
  async function toggle() {
    if (perm) {
      if (!confirm(t('threat.removeBlock', { ip }))) return;
      await fetch(apiUrl(`/api/block/${ip}`), { method: 'DELETE' });
    } else {
      if (!confirm(t('threat.addBlock', { ip }))) return;
      await fetch(apiUrl(`/api/block/${ip}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    }
    onAction();
  }
  return (
    <button
      onClick={toggle}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1,
        color: perm ? 'var(--green)' : 'var(--red)', padding: '2px 4px', borderRadius: 4,
      }}
      title={perm ? t('threat.removeBlockTitle', { ip }) : t('threat.addBlockTitle', { ip })}
    >
      {perm ? '✓' : '🚫'}
    </button>
  );
}

function IpCell({ ip, banned, perm, rep, onAction }: {
  ip: string; banned?: boolean; perm: boolean;
  rep: ThreatEntry['reputation']; onAction: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <span style={{ color: 'var(--red)', fontFamily: 'monospace' }}>{ip}</span>
        {banned && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,68,68,.2)', color: 'var(--red)', border: '1px solid rgba(255,68,68,.4)', fontWeight: 700 }}>{t('threat.banned')}</span>}
        <RepBadge rep={rep} />
      </div>
      <BlockBtn ip={ip} perm={perm} onAction={onAction} />
    </div>
  );
}

export function SshThreatTable({ threats, onAction }: { threats: ThreatEntry[]; onAction: () => void }) {
  const { t } = useI18n();
  const colStyle = (w: number): React.CSSProperties => ({ width: w, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--border)', fontSize: 11, alignItems: 'center' };

  return (
    <Panel>
      <PanelHeader title={t('threat.sshThreats')} badge={<Badge variant="alert">{threats.length} IPs</Badge>} />
      <div style={rowStyle}>
        <span style={{ ...colStyle(180), fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{t('threat.ip')}</span>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{t('threat.locationIsp')}</span>
        <span style={{ ...colStyle(80), fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{t('threat.type')}</span>
        <span style={{ ...colStyle(50), textAlign: 'right', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{t('threat.hits')}</span>
      </div>
      {threats.length === 0
        ? <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>{t('threat.noSshData')}</div>
        : threats.map(threat => (
          <div key={threat.ip} style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <div style={colStyle(180)}>
                <IpCell ip={threat.ip} banned={threat.banned} perm={threat.perm_blocked} rep={threat.reputation} onAction={onAction} />
              </div>
              <div style={{ flex: 1, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {threat.flag} {threat.city || threat.country || t('threat.unknown')}
                <br />
                <span style={{ fontSize: 10, opacity: .5 }}>{(threat.isp ?? '').substring(0, 28)}</span>
              </div>
              <div style={colStyle(80)}>
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,68,68,.1)', color: 'var(--red)', border: '1px solid rgba(255,68,68,.2)' }}>SSH</span>
              </div>
              <div style={{ ...colStyle(50), textAlign: 'right', color: 'var(--yellow)', fontWeight: 700 }}>{threat.count}</div>
            </div>
            {!!(threat.attempts && (threat.attempts.users.length || threat.attempts.offers.length)) && (
              <div style={{ padding: '0 18px 8px', fontSize: 10, color: 'var(--muted)', lineHeight: 1.7 }}>
                {threat.attempts.users.length > 0 && (
                  <>↳ {t('threat.triedUsers')}: <span style={{ color: 'var(--yellow)', fontFamily: 'monospace' }}>{threat.attempts.users.join(', ')}</span></>
                )}
                {threat.attempts.offers.length > 0 && (
                  <><br />↳ {t('threat.legacyCrypto')}: <span style={{ color: 'var(--red)', fontFamily: 'monospace' }}>{threat.attempts.offers.join(', ')}</span></>
                )}
              </div>
            )}
          </div>
        ))
      }
    </Panel>
  );
}

export function Fail2banTable({ bans, onAction }: { bans: Fail2banEntry[]; onAction: () => void }) {
  const { t } = useI18n();
  const colStyle = (w: number): React.CSSProperties => ({ width: w, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--border)', fontSize: 11, alignItems: 'center' };
  const ord = (n: number) => n === 1 ? t('threat.firstOffense') : n === 2 ? t('threat.secondOffense') : n === 3 ? t('threat.thirdOffense') : t('threat.nthOffense', { n: String(n) });

  return (
    <Panel>
      <PanelHeader title={t('threat.fail2ban')} badge={<Badge variant="alert">{bans.length} IPs</Badge>} />
      <div style={rowStyle}>
        {[t('threat.ip'), t('threat.locationIsp'), t('threat.offenses'), t('threat.statusNext')].map((h, i) => (
          <span key={h} style={{ ...(i === 0 ? colStyle(180) : i === 1 ? { flex: 1 } : i === 2 ? colStyle(100) : colStyle(140)), fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</span>
        ))}
      </div>
      {bans.length === 0
        ? <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>{t('threat.noBanData')}</div>
        : bans.map(b => {
          const bannedDate = new Date(b.banned_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
          const statusTxt  = b.active ? t('threat.activeSince', { date: bannedDate }) : t('threat.expiredOn', { date: bannedDate });
          const statusCls  = b.active ? { bg: 'rgba(255,68,68,.15)', color: 'var(--red)' } : { bg: 'rgba(74,85,104,.3)', color: 'var(--muted)' };
          return (
            <div key={b.ip} style={rowStyle}>
              <div style={colStyle(180)}>
                <IpCell ip={b.ip} perm={b.perm_blocked} rep={b.reputation} onAction={onAction} />
              </div>
              <div style={{ flex: 1, color: 'var(--muted)', overflow: 'hidden' }}>
                {b.flag} {b.city || b.country || t('threat.unknown')}
                <br />
                <span style={{ fontSize: 10, opacity: .5 }}>{(b.isp ?? '').substring(0, 28)}</span>
              </div>
              <div style={colStyle(100)}>
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(74,85,104,.3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  {ord(b.ban_count)}{b.ban_count >= 3 ? ' ⚠' : ''}
                </span>
              </div>
              <div style={{ ...colStyle(140), lineHeight: 1.6 }}>
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, ...statusCls }}>{statusTxt}</span>
                <br />
                <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('threat.ifCaughtAgain', { weeks: String(b.next_weeks) })}</span>
              </div>
            </div>
          );
        })
      }
    </Panel>
  );
}
