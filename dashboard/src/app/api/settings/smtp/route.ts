import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { redactedSmtpConfig, saveSmtpConfig } from '@/lib/smtp-config';
import { sendTestEmail } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Current SMTP settings (password redacted).
export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;
  return NextResponse.json({ smtp: redactedSmtpConfig() });
}

// Save SMTP settings, or send a test email when { action: 'test', to }.
export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const body = await req.json().catch(() => ({}));

  if (body.action === 'test') {
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!EMAIL_RE.test(to)) {
      return NextResponse.json({ ok: false, error: 'Enter a valid recipient address.' });
    }
    // A failed send is a normal application result, not an HTTP transport error.
    // Always 200 with { ok, error } so the real SMTP message reaches the client —
    // a 5xx here gets intercepted by the reverse proxy and replaced with an HTML
    // error page, which the client can't parse ("Network error").
    const res = await sendTestEmail(to);
    return NextResponse.json(res);
  }

  saveSmtpConfig({
    host: typeof body.host === 'string' ? body.host : undefined,
    from: typeof body.from === 'string' ? body.from : undefined,
    user: typeof body.user === 'string' ? body.user : undefined,
    pass: typeof body.pass === 'string' ? body.pass : undefined,
    port: Number.isFinite(Number(body.port)) ? Number(body.port) : undefined,
    secure: typeof body.secure === 'boolean' ? body.secure : undefined,
  });
  return NextResponse.json({ smtp: redactedSmtpConfig() });
}
