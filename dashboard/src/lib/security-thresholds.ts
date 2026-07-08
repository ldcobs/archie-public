import { readStateJson, writeStateJson } from './state-storage';

const THRESHOLDS_FILE = 'security_thresholds.json';

export interface SecurityThresholds {
  attemptThreshold: number;
  attemptWindowMinutes: number;
  tempBanDays: number;
  tempBanCountBeforeEscalation: number;
  repeatWindowDays: number;
  updated_at: string;
}

const DEFAULT_THRESHOLDS: SecurityThresholds = {
  attemptThreshold: 5,
  attemptWindowMinutes: 10,
  tempBanDays: 7,
  tempBanCountBeforeEscalation: 2,
  repeatWindowDays: 30,
  updated_at: '',
};

function coerceNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function getSecurityThresholds(): SecurityThresholds {
  try {
    const raw = readStateJson<Partial<SecurityThresholds>>(THRESHOLDS_FILE);
    if (!raw) return DEFAULT_THRESHOLDS;
    return {
      attemptThreshold: coerceNumber(raw.attemptThreshold, DEFAULT_THRESHOLDS.attemptThreshold, 1, 100),
      attemptWindowMinutes: coerceNumber(raw.attemptWindowMinutes, DEFAULT_THRESHOLDS.attemptWindowMinutes, 1, 240),
      tempBanDays: coerceNumber(raw.tempBanDays, DEFAULT_THRESHOLDS.tempBanDays, 1, 365),
      tempBanCountBeforeEscalation: coerceNumber(raw.tempBanCountBeforeEscalation, DEFAULT_THRESHOLDS.tempBanCountBeforeEscalation, 1, 20),
      repeatWindowDays: coerceNumber(raw.repeatWindowDays, DEFAULT_THRESHOLDS.repeatWindowDays, 1, 365),
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function setSecurityThresholds(input: Partial<SecurityThresholds>): SecurityThresholds {
  const current = getSecurityThresholds();
  const next: SecurityThresholds = {
    attemptThreshold: coerceNumber(input.attemptThreshold, current.attemptThreshold, 1, 100),
    attemptWindowMinutes: coerceNumber(input.attemptWindowMinutes, current.attemptWindowMinutes, 1, 240),
    tempBanDays: coerceNumber(input.tempBanDays, current.tempBanDays, 1, 365),
    tempBanCountBeforeEscalation: coerceNumber(input.tempBanCountBeforeEscalation, current.tempBanCountBeforeEscalation, 1, 20),
    repeatWindowDays: coerceNumber(input.repeatWindowDays, current.repeatWindowDays, 1, 365),
    updated_at: new Date().toISOString(),
  };

  writeStateJson(THRESHOLDS_FILE, next);
  return next;
}
