import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { queueFirewallCommand } from '@/lib/firewall';

const IP_RE = /^\d+\.\d+\.\d+\.\d+$/;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ip: string }> }
) {
  const auth = requireApiRole(_req, 'operator');
  if ('response' in auth) return auth.response;

  const { ip } = await params;
  if (!IP_RE.test(ip)) return NextResponse.json({ error: 'Invalid IP' }, { status: 400 });
  if (queueFirewallCommand('block', ip)) {
    return NextResponse.json({ blocked: ip, note: 'UFW rule applied within 60 seconds' });
  }
  return NextResponse.json({ error: 'Could not queue firewall command' }, { status: 500 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ip: string }> }
) {
  const auth = requireApiRole(_req, 'operator');
  if ('response' in auth) return auth.response;

  const { ip } = await params;
  if (!IP_RE.test(ip)) return NextResponse.json({ error: 'Invalid IP' }, { status: 400 });
  if (queueFirewallCommand('unblock', ip)) {
    return NextResponse.json({ unblocked: ip, note: 'UFW rule removed within 60 seconds' });
  }
  return NextResponse.json({ error: 'Could not queue firewall command' }, { status: 500 });
}
