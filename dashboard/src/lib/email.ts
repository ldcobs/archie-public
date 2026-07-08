// ── Email delivery (SMTP via nodemailer) ──────────────────────────────────────
// Sends invite links and test messages using the per-install SMTP config.
// Node runtime only (route handlers run in Node here). nodemailer is statically
// imported so the Next.js standalone build traces it into the runtime image —
// a dynamic require() is NOT traced and the module ends up missing at runtime.

import nodemailer from 'nodemailer';
import { loadSmtpConfig, isSmtpConfigured, type SmtpConfig } from './smtp-config';

export interface SendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

// Static import (not require) so Next.js standalone output traces nodemailer into
// the runtime image. Timeouts keep a slow/blocked relay from hanging the request —
// it returns a clear SMTP error instead.
function transport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

interface InviteEmailParams {
  to: string;
  link: string;
  brand?: string;
  displayName?: string;
  welcomeMessage?: string;
  supportContact?: string;
}

function inviteHtml(p: InviteEmailParams): string {
  const brand = escapeHtml(p.brand || 'Your VPN');
  const greeting = p.displayName ? `Hi ${escapeHtml(p.displayName)},` : 'Hello,';
  const welcome = p.welcomeMessage
    ? `<p style="margin:0 0 16px">${escapeHtml(p.welcomeMessage)}</p>`
    : '';
  const support = p.supportContact
    ? `<p style="color:#64748b;font-size:13px;margin:24px 0 0">Need help? Contact ${escapeHtml(p.supportContact)}.</p>`
    : '';
  const link = escapeHtml(p.link);
  return `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;color:#e2e8f0">
    <h1 style="font-size:20px;margin:0 0 20px">${brand}</h1>
    <p style="margin:0 0 8px">${greeting}</p>
    ${welcome}
    <p style="margin:0 0 24px">You've been invited to set up your VPN access. Tap the button below to get connected.</p>
    <a href="${link}" style="display:inline-block;background:#06b6d4;color:#0f172a;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">Set up my VPN</a>
    <p style="color:#64748b;font-size:13px;margin:24px 0 0;word-break:break-all">Or open this link:<br>${link}</p>
    ${support}
  </div></body></html>`;
}

function inviteText(p: InviteEmailParams): string {
  const lines = [
    p.displayName ? `Hi ${p.displayName},` : 'Hello,',
    p.welcomeMessage ?? '',
    "You've been invited to set up your VPN access. Open this link to get connected:",
    p.link,
    p.supportContact ? `\nNeed help? Contact ${p.supportContact}.` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

export async function sendInviteEmail(p: InviteEmailParams): Promise<SendResult> {
  const cfg = loadSmtpConfig();
  if (!isSmtpConfigured(cfg)) return { ok: false, error: 'SMTP is not configured.' };
  try {
    const tx = transport(cfg);
    const info = await tx.sendMail({
      from: cfg.from,
      to: p.to,
      subject: `${p.brand || 'VPN'} — your access invite`,
      text: inviteText(p),
      html: inviteHtml(p),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed.' };
  }
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  const cfg = loadSmtpConfig();
  if (!isSmtpConfigured(cfg)) return { ok: false, error: 'SMTP is not configured.' };
  try {
    const tx = transport(cfg);
    const info = await tx.sendMail({
      from: cfg.from,
      to,
      subject: 'Archie SMTP test',
      text: 'This is a test message confirming your Archie SMTP settings work.',
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed.' };
  }
}
