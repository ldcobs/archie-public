'use client';
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BASE_PATH, apiUrl } from '@/lib/api-path';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-client';
import { useGlobalSSE } from '@/lib/use-sse';
import {
  IconLayoutDashboard,
  IconPlugConnected,
  IconKey,
  IconArrowsExchange,
  IconShieldLock,
  IconDevices,
  IconServer,
  IconSettings,
  IconChevronLeft,
  IconLogout,
  IconUser,
  IconRoute2,
  IconSun,
  IconMoon,
  IconDeviceMobile,
} from '@tabler/icons-react';

const NAV: { groupKey: string; items: { href: string; Icon: React.ComponentType<{ size?: number; stroke?: number; style?: React.CSSProperties }>; labelKey: string; soon?: boolean; threat?: boolean; pending?: boolean }[] }[] = [
  { groupKey: 'sidebar.groupOverview', items: [
    { href: '/',            Icon: IconLayoutDashboard, labelKey: 'sidebar.navDashboard' },
    { href: '/connections', Icon: IconPlugConnected,   labelKey: 'sidebar.navConnections' },
  ]},
  { groupKey: 'sidebar.groupVpn', items: [
    { href: '/vpn-users',   Icon: IconKey,             labelKey: 'sidebar.navVpnUsers' },
    { href: '/inbounds',    Icon: IconArrowsExchange,  labelKey: 'sidebar.navInbounds' },
    { href: '/gateways',    Icon: IconRoute2,          labelKey: 'sidebar.navGateways' },
  ]},
  { groupKey: 'sidebar.groupOps', items: [
    { href: '/security',    Icon: IconShieldLock,      labelKey: 'sidebar.navSecurity', threat: true },
    { href: '/devices',     Icon: IconDevices,         labelKey: 'sidebar.navDevices', pending: true },
    { href: '/server',      Icon: IconServer,          labelKey: 'sidebar.navServer' },
  ]},
  { groupKey: 'sidebar.groupConfig', items: [
    { href: '/settings',    Icon: IconSettings,        labelKey: 'sidebar.navSettings' },
    { href: '/clients',     Icon: IconDeviceMobile,    labelKey: 'sidebar.navClients' },
  ]},
];

export default function Sidebar() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { threatCount, pendingDeviceCount, securityMode: protectionMode } = useGlobalSSE();
  const [collapsed, setCollapsed] = useState(false);
  const [sessionUser, setSessionUser] = useState<{ displayName?: string; username?: string; role?: string } | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const w = collapsed ? 48 : 190;

  useEffect(() => {
    fetchJson<{ user?: { displayName?: string; username?: string; role?: string } }>(apiUrl('/api/auth/session'))
      .then(d => setSessionUser(d?.user ?? null))
      .catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST' }).catch(() => {});
    router.replace('/login');
    router.refresh();
  }, [router]);


  return (
    <aside style={{
      width: w, minWidth: w,
      background: 'var(--surface-sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
      flexShrink: 0,
      transition: 'width 0.2s ease, min-width 0.2s ease',
      overflow: 'hidden', zIndex: 40,
    }}>

      {/* Logo — click to toggle collapse */}
      <div
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        style={{
          height: 76, display: 'flex', alignItems: 'center',
          padding: collapsed ? '0 4px' : '0 5px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0, overflow: 'hidden',
          cursor: 'pointer',
        }}>
        {collapsed ? (
          <Image
            src={`${BASE_PATH}/assets/ArchieIcon-transparent.png`}
            alt="Archie" width={40} height={40}
            style={{ width: 40, height: 40, objectFit: 'contain' }}
          />
        ) : (
          <Image
            src={`${BASE_PATH}/assets/archie-header-transparent-${theme}.png`}
            alt="Archie VPN & Security Management"
            width={2072} height={536} priority
            style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }}
          />
        )}
      </div>

      {/* Protection mode chip — above nav */}
      {protectionMode && (
        <Link href="/settings" style={{ textDecoration: 'none', padding: '4px 5px', display: 'block', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 7,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '6px 0' : '5px 8px',
            borderRadius: 7,
            background: protectionMode === 'permanent-deny'
              ? (theme === 'dark' ? 'rgba(255,77,90,0.08)' : 'var(--red-dim)')
              : (theme === 'dark' ? 'rgba(34,230,107,0.06)' : 'var(--green-dim)'),
            border: protectionMode === 'permanent-deny'
              ? `1px solid ${theme === 'dark' ? 'rgba(255,77,90,0.22)' : 'var(--red)'}`
              : `1px solid ${theme === 'dark' ? 'rgba(34,230,107,0.18)' : 'var(--green)'}`,
          }}>
            <IconShieldLock size={14} stroke={1.8} style={{ flexShrink: 0, color: protectionMode === 'permanent-deny' ? 'var(--red)' : 'var(--green)' }} />
            {!collapsed && (
              <span style={{ fontSize: 10, fontWeight: 700, color: protectionMode === 'permanent-deny' ? 'var(--red)' : 'var(--green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {protectionMode === 'permanent-deny' ? t('topbar.permanentDeny') : t('topbar.tempBan')}
              </span>
            )}
          </div>
        </Link>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 5px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV.map(({ groupKey, items }) => (
          <div key={groupKey}>
            {!collapsed && (
              <div style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: 2,
                color: 'var(--text-dim)',
                padding: '10px 8px 3px', textTransform: 'uppercase',
              }}>{t(groupKey)}</div>
            )}
            {items.map(({ href, Icon, labelKey, soon, threat, pending }) => {
              const active = pathname === href;
              const showThreat = threat && threatCount > 0;
              const showPending = pending && pendingDeviceCount > 0;
              return (
                <Link key={href} href={soon ? '#' : href} style={{ textDecoration: 'none' }}>
                  <div style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center',
                    gap: 9,
                    padding: collapsed ? '9px 0' : '7px 8px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 7,
                    cursor: soon ? 'default' : 'pointer',
                    color: active ? 'var(--accent)' : 'var(--text-dim)',
                    background: active
                      ? (theme === 'dark' ? 'rgba(0,212,255,0.08)' : 'var(--accent-dim)')
                      : 'transparent',
                    border: active
                      ? `1px solid ${theme === 'dark' ? 'rgba(0,212,255,0.18)' : 'var(--accent)'}`
                      : '1px solid transparent',
                    whiteSpace: 'nowrap',
                    transition: 'background 0.12s',
                  }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = theme === 'dark' ? 'rgba(0,212,255,0.05)' : 'var(--surface-hover)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <Icon size={18} stroke={1.6} style={{ flexShrink: 0 }} />
                    {/* collapsed dot badges */}
                    {showThreat && collapsed && (
                      <span style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 7, height: 7, borderRadius: '50%',
                        background: 'var(--red)', boxShadow: '0 0 6px var(--red)',
                        animation: 'pulse 2s ease-in-out infinite',
                      }} />
                    )}
                    {showPending && collapsed && (
                      <span style={{
                        position: 'absolute', top: 4, right: showThreat ? 12 : 4,
                        width: 7, height: 7, borderRadius: '50%',
                        background: 'var(--amber)', boxShadow: '0 0 6px var(--amber)',
                        animation: 'pulse 2s ease-in-out infinite',
                      }} />
                    )}
                    {!collapsed && (
                      <>
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{t(labelKey)}</span>
                        {showThreat ? (
                          <span style={{
                            marginLeft: 'auto', fontSize: 8.5, fontWeight: 800,
                            color: 'var(--red)', background: 'var(--red-dim)',
                            padding: '1px 6px', borderRadius: 3,
                            animation: 'pulse 2s ease-in-out infinite',
                          }}>{threatCount}</span>
                        ) : showPending ? (
                          <span style={{
                            marginLeft: 'auto', fontSize: 8.5, fontWeight: 800,
                            color: 'var(--amber)', background: 'var(--amber-dim)',
                            padding: '1px 6px', borderRadius: 3,
                            animation: 'pulse 2s ease-in-out infinite',
                          }}>{pendingDeviceCount}</span>
                        ) : soon ? (
                          <span style={{
                            marginLeft: 'auto', fontSize: 8, fontWeight: 800,
                            color: 'var(--text-faint)',
                            background: 'var(--surface-hover)',
                            padding: '1px 5px', borderRadius: 3, letterSpacing: 0.8,
                          }}>{t('sidebar.soon')}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Session user + logout */}
      <div style={{ padding: '6px 5px 4px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {collapsed ? (
          <button
            onClick={logout}
            title={t('sidebar.signOut')}
            style={{
              width: '100%', height: 32,
              background: 'var(--red-dim)',
              border: '1px solid var(--red)',
              borderRadius: 7, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--red)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--red)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--red-dim)')}
          >
            <IconLogout size={15} stroke={1.8} />
          </button>
        ) : sessionUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 7px 5px' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: 'var(--accent-dim)', border: '1px solid var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <IconUser size={13} stroke={1.8} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sessionUser.displayName || sessionUser.username}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--accent)' }}>
                {sessionUser.role}
              </div>
            </div>
            <button
              onClick={logout}
              title={t('sidebar.signOut')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--red)', padding: 4, borderRadius: 5, flexShrink: 0,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fff'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--red)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
            >
              <IconLogout size={14} stroke={1.8} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Bottom bar: theme toggle + collapse */}
      <div style={{ padding: 5, borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 4 }}>
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            width: 32, height: 32, flexShrink: 0,
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            color: theme === 'dark' ? 'var(--amber)' : 'var(--accent)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-active)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
        >
          {theme === 'dark'
            ? <IconSun size={15} stroke={1.8} />
            : <IconMoon size={15} stroke={1.8} />}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          style={{
            flex: 1, height: 32,
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 7, padding: collapsed ? 0 : '0 9px',
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-active)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
        >
          <IconChevronLeft
            size={14} stroke={2}
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
          />
          {!collapsed && <span>{t('sidebar.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}
