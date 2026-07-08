import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createInviteToken, listInviteSummaries, recordInviteDelivery } from '@/lib/invite-tokens';
import { sendInviteEmail } from '@/lib/email';
import { isSmtpConfigured } from '@/lib/smtp-config';
import { inviteBaseUrl } from '@/lib/invite-url';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;
  return NextResponse.json({ invites: listInviteSummaries() });
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const token = createInviteToken({
    group: (body.group ?? 'Ungrouped').trim() || 'Ungrouped',
    displayName: str(body.displayName),
    email: str(body.email),
    client: str(body.client),
    profile: str(body.profile),
    posture: str(body.posture),
    securityPolicy: str(body.securityPolicy),
    trafficLimitGB: num(body.trafficLimitGB),
    devicePolicy: str(body.devicePolicy),
    brand: str(body.brand),
    logo: str(body.logo),
    supportContact: str(body.supportContact),
    welcomeMessage: str(body.welcomeMessage),
    expiresInDays: num(body.expiresInDays),
    sentVia: body.sentVia === 'email' ? 'email' : 'link',
    boundEmail: str(body.boundEmail),
    createdBy: auth.user.username,
  });

  // Deliver the invite by email when the operator chose that channel. The link
  // points at the public onboarding page for this token. Failures don't fail the
  // request — the token is valid and the operator can still copy the link — but
  // the outcome is recorded on the token and returned for the UI to surface.
  let email: { attempted: boolean; sent: boolean; error?: string } | undefined;
  if (token.sentVia === 'email') {
    const recipient = str(body.email) ?? str(body.boundEmail);
    if (!recipient || !EMAIL_RE.test(recipient)) {
      email = { attempted: true, sent: false, error: 'A valid recipient email address is required.' };
      recordInviteDelivery(token.token, false, email.error);
    } else if (!isSmtpConfigured()) {
      email = { attempted: true, sent: false, error: 'SMTP is not configured. Set it up in Settings.' };
      recordInviteDelivery(token.token, false, email.error);
    } else {
      const link = `${inviteBaseUrl(req)}/invite/${token.token}`;
      const res = await sendInviteEmail({
        to: recipient,
        link,
        brand: token.brand,
        displayName: token.displayName,
        welcomeMessage: token.welcomeMessage,
        supportContact: token.supportContact,
      });
      email = { attempted: true, sent: res.ok, error: res.error };
      recordInviteDelivery(token.token, res.ok, res.error);
    }
  }

  return NextResponse.json({ token, email }, { status: 201 });
}
