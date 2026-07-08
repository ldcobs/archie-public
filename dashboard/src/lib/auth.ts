import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { AuthRole, AuthUserRecord } from './auth-users';
import { getAuthUserByUsername, hasAnyAuthUsers } from './auth-users';

export const SESSION_COOKIE = 'archie_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'dev-only-change-me';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3';

const ROLE_LEVEL: Record<AuthRole, number> = {
  viewer: 10,
  operator: 20,
  admin: 30,
  owner: 40,
};

export function roleAtLeast(role: AuthRole, minimum: AuthRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum];
}

function base64urlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string): string {
  return createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

function stripBasePath(pathname: string): string {
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    const stripped = pathname.slice(BASE_PATH.length);
    return stripped || '/';
  }
  return pathname;
}

function verifySignedValue(token: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    return null;
  }
  return payload;
}

export function createSessionToken(user: AuthUserRecord): string {
  const payload = base64urlEncode(JSON.stringify({
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }));
  return `${payload}.${sign(payload)}`;
}

function readSessionUser(token: string | undefined): AuthUserRecord | null {
  if (!token) return null;
  const payload = verifySignedValue(token);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(base64urlDecode(payload)) as { username?: string; exp?: number };
    if (!parsed.username || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    const user = getAuthUserByUsername(parsed.username);
    if (!user || user.disabled) return null;
    return user;
  } catch {
    return null;
  }
}

export function getSessionUserFromRequest(req: NextRequest): AuthUserRecord | null {
  return readSessionUser(req.cookies.get(SESSION_COOKIE)?.value);
}

// Whether the session cookie is HTTPS-only. Defaults to "secure in production"
// (so domain/HTTPS deploys keep Secure cookies), but an IP-only / HTTP install
// sets AUTH_COOKIE_SECURE=false so the cookie isn't dropped over plain HTTP.
function cookieSecure(): boolean {
  if (process.env.AUTH_COOKIE_SECURE !== undefined) {
    return process.env.AUTH_COOKIE_SECURE === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: 0,
  });
  return response;
}

export function attachSessionCookie(response: NextResponse, user: AuthUserRecord): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(user),
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function requireApiRole(req: NextRequest, minimum: AuthRole = 'viewer'):
  | { user: AuthUserRecord }
  | { response: NextResponse } {
  if (!hasAnyAuthUsers()) {
    return {
      response: NextResponse.json({ error: 'Authentication setup required' }, { status: 503 }),
    };
  }

  const user = getSessionUserFromRequest(req);
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!roleAtLeast(user.role, minimum)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

export function authMiddleware(req: NextRequest): NextResponse {
  const pathname = stripBasePath(req.nextUrl.pathname);
  const isSetupMode = !hasAnyAuthUsers();
  const user = getSessionUserFromRequest(req);
  const isApi = pathname.startsWith('/api/');
  const isSetupPath = pathname === '/setup' || pathname === '/api/auth/setup';
  const isLoginPath = pathname === '/login' || pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/session';
  const isPublicTokenApi =
    /^\/api\/sub\/[^/]+$/.test(pathname) ||
    /^\/api\/wg-config\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/page\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/qr\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/redeem$/.test(pathname);
  const isPublicPage =
    /^\/invite\/[^/]+$/.test(pathname) ||
    /^\/join\/[^/]+$/.test(pathname);

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  if (isSetupMode) {
    if (isSetupPath) return NextResponse.next();
    if (isApi && !isSetupPath) {
      return NextResponse.json({ error: 'Authentication setup required' }, { status: 503 });
    }
    const url = req.nextUrl.clone();
    url.pathname = `${BASE_PATH}/setup`;
    return NextResponse.redirect(url);
  }

  if (isPublicTokenApi || isPublicPage) return NextResponse.next();

  if (isLoginPath) {
    if (user && pathname === '/login') {
      const url = req.nextUrl.clone();
      url.pathname = `${BASE_PATH}/`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = `${BASE_PATH}/login`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
