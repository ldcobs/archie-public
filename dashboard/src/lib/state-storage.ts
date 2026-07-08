import fs from 'fs';
import path from 'path';

const PRIMARY_STATE_DIR = process.env.STATE_DIR ?? '/app/vpn-api';
const DEV_DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function canAccess(target: string, mode: number): boolean {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

export function resolveStateFilePath(name: string) {
  try {
    ensureDir(PRIMARY_STATE_DIR);
    fs.accessSync(PRIMARY_STATE_DIR, fs.constants.W_OK);
    return path.join(PRIMARY_STATE_DIR, name);
  } catch {
    ensureDir(DEV_DATA_DIR);
    return path.join(DEV_DATA_DIR, name);
  }
}

export function readStateJson<T>(name: string): T | null {
  const primaryPath = path.join(PRIMARY_STATE_DIR, name);
  const devPath = path.join(DEV_DATA_DIR, name);
  const target = canAccess(primaryPath, fs.constants.R_OK)
    ? primaryPath
    : canAccess(devPath, fs.constants.R_OK)
      ? devPath
      : null;

  if (!target) return null;
  return JSON.parse(fs.readFileSync(target, 'utf8')) as T;
}

export function writeStateJson(name: string, value: unknown) {
  const target = resolveStateFilePath(name);
  writeJsonFileAtomic(target, value);
  return target;
}

export function writeTextFileAtomic(target: string, payload: string) {
  ensureDir(path.dirname(target));
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.writeFileSync(tmp, payload);
  try {
    // Atomic path: rename the tmp over the target. Works for ordinary files.
    fs.renameSync(tmp, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A single-file bind mount (e.g. config.json mounted into the container) cannot
    // be replaced by rename() — the mount point is busy (EBUSY) or the tmp file is on
    // a different filesystem than the mounted target (EXDEV). Fall back to an in-place
    // overwrite, which keeps the target inode the bind mount depends on. Slightly less
    // crash-safe than rename, but callers (writeCfg) keep a .bak before this runs.
    if (code === 'EBUSY' || code === 'EXDEV') {
      try {
        fs.writeFileSync(target, payload);
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* best-effort tmp cleanup */ }
      }
    } else {
      try { fs.unlinkSync(tmp); } catch { /* best-effort tmp cleanup */ }
      throw err;
    }
  }
}

export function writeJsonFileAtomic(target: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  writeTextFileAtomic(target, payload);
}

export function appendLineAtomic(target: string, line: string) {
  let current = '';
  try {
    current = fs.readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  writeTextFileAtomic(target, current + line);
}
