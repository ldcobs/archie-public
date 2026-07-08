import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { getDb } from './db';

export type AuthRole = 'viewer' | 'operator' | 'admin' | 'owner';

export interface AuthUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  disabled?: boolean;
}

interface DbRow {
  id: string; username: string; display_name: string; role: string;
  password_hash: string; password_salt: string; created_at: string; disabled: number;
}

function rowToRecord(row: DbRow): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as AuthRole,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
    disabled: row.disabled === 1 ? true : undefined,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, user: AuthUserRecord): boolean {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(hashPassword(password, user.passwordSalt), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function loadAuthUsers(): AuthUserRecord[] {
  return (getDb().prepare('SELECT * FROM auth_users').all() as DbRow[]).map(rowToRecord);
}

export function saveAuthUsers(users: AuthUserRecord[]): boolean {
  const db = getDb();
  const ins = db.prepare(`
    INSERT INTO auth_users (id, username, display_name, role, password_hash, password_salt, created_at, disabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM auth_users').run();
    for (const u of users) {
      ins.run(u.id, u.username, u.displayName, u.role,
        u.passwordHash, u.passwordSalt, u.createdAt, u.disabled ? 1 : 0);
    }
  })();
  return true;
}

export function hasAnyAuthUsers(): boolean {
  return getDb().prepare('SELECT 1 FROM auth_users WHERE disabled = 0 LIMIT 1').get() != null;
}

export function getAuthUserByUsername(username: string): AuthUserRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM auth_users WHERE username = ?')
    .get(normalizeUsername(username)) as DbRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function createAuthUser(input: {
  username: string;
  displayName?: string;
  password: string;
  role: AuthRole;
}): { user: AuthUserRecord } | { error: string } {
  const username = normalizeUsername(input.username);
  const displayName = input.displayName?.trim() || username;

  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    return { error: 'Invalid username — use 3-32 lowercase letters, numbers, dot, underscore, or hyphen' };
  }
  if (input.password.length < 10) {
    return { error: 'Password must be at least 10 characters' };
  }

  const passwordSalt = randomBytes(16).toString('hex');
  const user: AuthUserRecord = {
    id: randomUUID(),
    username,
    displayName,
    role: input.role,
    passwordSalt,
    passwordHash: hashPassword(input.password, passwordSalt),
    createdAt: new Date().toISOString(),
  };

  try {
    getDb().prepare(`
      INSERT INTO auth_users (id, username, display_name, role, password_hash, password_salt, created_at, disabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, user.username, user.displayName, user.role,
      user.passwordHash, user.passwordSalt, user.createdAt, 0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return { error: 'Username already exists' };
    return { error: 'Could not save auth user store' };
  }

  return { user };
}
