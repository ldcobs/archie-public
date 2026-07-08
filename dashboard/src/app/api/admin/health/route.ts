import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import fs from 'fs';

export interface HealthWarning {
  code: string;
  severity: 'error' | 'warn';
  message: string;
  fix?: string;
}

export interface HealthReport {
  ok: boolean;
  warnings: HealthWarning[];
  checkedAt: string;
}

function checkEnv(): HealthWarning[] {
  const warnings: HealthWarning[] = [];

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === 'dev-only-change-me') {
    warnings.push({
      code: 'AUTH_SECRET_DEFAULT',
      severity: 'error',
      message: 'AUTH_SECRET is the dev default — admin sessions can be forged.',
      fix: 'Set AUTH_SECRET to a random 32-byte hex string in .env',
    });
  }

  if (!process.env.NEXT_PUBLIC_SERVER_DOMAIN) {
    warnings.push({
      code: 'SERVER_DOMAIN_UNSET',
      severity: 'warn',
      message: 'SERVER_DOMAIN is not set — generated VPN configs will have no server address.',
      fix: 'Set NEXT_PUBLIC_SERVER_DOMAIN in .env',
    });
  }

  if (!process.env.NEXT_PUBLIC_PUBLIC_BASE_URL) {
    warnings.push({
      code: 'PUBLIC_BASE_URL_UNSET',
      severity: 'warn',
      message: 'NEXT_PUBLIC_PUBLIC_BASE_URL is not set — invite links will be incomplete.',
      fix: 'Set NEXT_PUBLIC_PUBLIC_BASE_URL to https://your-domain:8443/v3 in .env',
    });
  }

  if (!process.env.NEXT_PUBLIC_VLESS_PBK) {
    warnings.push({
      code: 'VLESS_KEYS_DEFAULT',
      severity: 'error',
      message: 'VLESS Reality keypair is not set — the installer generates a unique one per install; do not run without it.',
      fix: 'Generate a new keypair with `xray x25519` and set NEXT_PUBLIC_VLESS_PBK / NEXT_PUBLIC_VLESS_SID',
    });
  }

  // Reality decoy health. A dead/unsuitable decoy is the single nastiest VLESS
  // failure: the client connects and the handshake completes, but zero traffic
  // passes and NOTHING logs an error — it just looks like "no internet". These
  // decoys are known to have stopped working; surface it so nobody debugs blind.
  const deadDecoys = new Set(['www.microsoft.com', 'microsoft.com']);
  const sni = process.env.NEXT_PUBLIC_VLESS_SNI;
  if (sni && deadDecoys.has(sni.toLowerCase())) {
    warnings.push({
      code: 'VLESS_SNI_DEAD_DECOY',
      severity: 'error',
      message: `VLESS Reality decoy "${sni}" no longer works — clients connect but get no internet, with no error anywhere. It's the SNI.`,
      fix: 'Set NEXT_PUBLIC_VLESS_SNI / VLESS_SNI to a working decoy (e.g. www.cloudflare.com) and rebuild the dashboard. You do NOT need to reissue keys — the same key works, just re-share its link so it carries the new sni=.',
    });
  }

  return warnings;
}

function checkStateDir(): HealthWarning[] {
  const warnings: HealthWarning[] = [];
  const stateDir = process.env.STATE_DIR ?? '/app/vpn-api';

  try {
    fs.accessSync(stateDir, fs.constants.W_OK);
  } catch {
    warnings.push({
      code: 'STATE_DIR_NOT_WRITABLE',
      severity: 'error',
      message: `STATE_DIR (${stateDir}) is not writable — settings and state changes will not persist.`,
      fix: `Ensure the container has write access to ${stateDir}`,
    });
  }

  return warnings;
}

async function checkVpnApi(): Promise<HealthWarning[]> {
  const warnings: HealthWarning[] = [];
  const base = process.env.VPN_API_INTERNAL_URL ?? 'http://vpn-api-v3:5900';
  const token = process.env.VPN_API_V3_TOKEN ?? '';

  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/vpn-api/status`, { headers, signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      warnings.push({
        code: 'VPN_API_UNHEALTHY',
        severity: 'error',
        message: `vpn-api-v3 responded with HTTP ${res.status} — live key sync and block enforcement may be broken.`,
        fix: 'Check that the vpn-api-v3 container is running and VPN_API_INTERNAL_URL is correct',
      });
    }
  } catch {
    warnings.push({
      code: 'VPN_API_UNREACHABLE',
      severity: 'error',
      message: `vpn-api-v3 is unreachable at ${base} — live key sync and block enforcement will not work.`,
      fix: 'Check that the vpn-api-v3 container is running and VPN_API_INTERNAL_URL is correct',
    });
  }

  return warnings;
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const [envWarnings, stateDirWarnings, vpnApiWarnings] = await Promise.all([
    Promise.resolve(checkEnv()),
    Promise.resolve(checkStateDir()),
    checkVpnApi(),
  ]);

  const warnings = [...envWarnings, ...stateDirWarnings, ...vpnApiWarnings];
  const report: HealthReport = {
    ok: warnings.every(w => w.severity !== 'error'),
    warnings,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
