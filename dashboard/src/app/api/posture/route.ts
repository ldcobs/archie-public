import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { loadPostureStore, setKeyPreset, setGroupPreset } from '@/lib/posture-store';

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;
  return NextResponse.json(loadPostureStore());
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const preset = body.preset === null ? null : body.preset;

  if (typeof body.email === 'string') return NextResponse.json(setKeyPreset(body.email, preset));
  if (typeof body.group === 'string') {
    const clearKeys = Array.isArray(body.clearKeys) ? body.clearKeys.filter((k: unknown) => typeof k === 'string') : [];
    return NextResponse.json(setGroupPreset(body.group, preset, clearKeys));
  }
  return NextResponse.json({ error: 'email or group required' }, { status: 400 });
}
