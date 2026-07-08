import { NextRequest, NextResponse } from 'next/server';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/v3';
const SESSION_COOKIE = 'archie_session';

// Auth paths that don't require a session cookie
const AUTH_PATHS = new Set(['/login', '/setup']);

// Public API paths — no cookie needed
function isPublicApi(pathname: string) {
  return pathname.startsWith('/api/auth/') ||
    /^\/api\/sub\/[^/]+$/.test(pathname) ||
    /^\/api\/wg-config\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/page\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/qr\/[^/]+$/.test(pathname) ||
    /^\/api\/invite\/redeem$/.test(pathname);
}

// Public end-user pages — reachable without an admin session
function isPublicPage(pathname: string) {
  return /^\/invite\/[^/]+$/.test(pathname) ||
    /^\/join\/[^/]+$/.test(pathname);
}

function stripBase(pathname: string) {
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    return pathname.slice(BASE_PATH.length) || '/';
  }
  return pathname;
}

export function middleware(req: NextRequest) {
  const path = stripBase(req.nextUrl.pathname);

  // Static assets — always pass
  if (path.startsWith('/_next') || path === '/favicon.ico') {
    return NextResponse.next();
  }

  // Public API — always pass
  if (isPublicApi(path)) return NextResponse.next();

  // Public end-user pages (invite / join) — always pass
  if (isPublicPage(path)) return NextResponse.next();

  const hasCookie = !!req.cookies.get(SESSION_COOKIE)?.value;

  // Auth pages — always serve; the login page's useEffect redirects if already authenticated
  if (AUTH_PATHS.has(path)) {
    return NextResponse.next();
  }

  // Protected pages/APIs: redirect or 401 if no cookie
  if (!hasCookie) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)',
  ],
};
