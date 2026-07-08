import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const DB_PATH = path.join(DATA_DIR, 'archie.db');

let _db: Database.Database | null = null;

function applyMigrations(db: Database.Database): void {
  // Add columns introduced after initial schema — safe to run repeatedly
  const migrations = [
    `ALTER TABLE user_meta ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE user_meta ADD COLUMN disabled_reason TEXT`,
    `ALTER TABLE user_meta ADD COLUMN unknown_device TEXT NOT NULL DEFAULT 'require_approval'`,
    `ALTER TABLE user_meta ADD COLUMN new_country TEXT NOT NULL DEFAULT 'require_approval'`,
    `ALTER TABLE user_meta ADD COLUMN new_isp TEXT NOT NULL DEFAULT 'warn'`,
    `ALTER TABLE user_meta ADD COLUMN overflow_action TEXT NOT NULL DEFAULT 'auto_reject'`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id           TEXT PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role         TEXT NOT NULL DEFAULT 'viewer',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      disabled     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS traffic_daily (
      email    TEXT NOT NULL,
      day      TEXT NOT NULL,
      upload   INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (email, day)
    );

    CREATE TABLE IF NOT EXISTS user_meta (
      uuid              TEXT PRIMARY KEY,
      display_name      TEXT NOT NULL DEFAULT '',
      group_name        TEXT NOT NULL DEFAULT 'Ungrouped',
      is_owner          INTEGER NOT NULL DEFAULT 0,
      expected_isps     TEXT NOT NULL DEFAULT '[]',
      notes             TEXT,
      created_at        TEXT NOT NULL,
      expires_at        TEXT,
      traffic_limit_gb  REAL,
      connection_limit  INTEGER,
      protocols         TEXT,
      last_sub_fetch    TEXT,
      sub_fetch_count   INTEGER,
      detected_client   TEXT,
      detected_client_raw TEXT
    );
  `);
}

function importAuthUsersFromJson(db: Database.Database): void {
  const jsonPath = path.join(DATA_DIR, 'auth_users.json');
  if (!fs.existsSync(jsonPath)) return;
  try {
    const users = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Array<{
      id: string; username: string; displayName: string; role: string;
      passwordHash: string; passwordSalt: string; createdAt: string; disabled?: boolean;
    }>;
    const ins = db.prepare(`
      INSERT OR IGNORE INTO auth_users
        (id, username, display_name, role, password_hash, password_salt, created_at, disabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const u of users) {
        ins.run(u.id, u.username, u.displayName ?? '', u.role,
          u.passwordHash, u.passwordSalt, u.createdAt, u.disabled ? 1 : 0);
      }
    })();
  } catch {}
}

function importUserMetaFromJson(db: Database.Database): void {
  const jsonPath = path.join(DATA_DIR, 'user_meta.json');
  if (!fs.existsSync(jsonPath)) return;
  try {
    const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, {
      uuid: string; displayName: string; group: string; isOwner?: boolean;
      expectedIsps?: string[]; notes?: string; createdAt: string;
      expiresAt?: string; trafficLimitGB?: number; connectionLimit?: number;
      protocols?: string[]; lastSubFetch?: string; subFetchCount?: number;
      detectedClient?: string; detectedClientRaw?: string;
    }>;
    const ins = db.prepare(`
      INSERT OR IGNORE INTO user_meta
        (uuid, display_name, group_name, is_owner, expected_isps, notes, created_at,
         expires_at, traffic_limit_gb, connection_limit, protocols,
         last_sub_fetch, sub_fetch_count, detected_client, detected_client_raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const m of Object.values(store)) {
        ins.run(
          m.uuid, m.displayName ?? '', m.group ?? 'Ungrouped', m.isOwner ? 1 : 0,
          JSON.stringify(m.expectedIsps ?? []), m.notes ?? null, m.createdAt,
          m.expiresAt ?? null, m.trafficLimitGB ?? null, m.connectionLimit ?? null,
          m.protocols ? JSON.stringify(m.protocols) : null,
          m.lastSubFetch ?? null, m.subFetchCount ?? null,
          m.detectedClient ?? null, m.detectedClientRaw ?? null,
        );
      }
    })();
  } catch {}
}

export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    applySchema(_db);
    applyMigrations(_db);
    // One-time idempotent import from legacy JSON files (INSERT OR IGNORE)
    importAuthUsersFromJson(_db);
    importUserMetaFromJson(_db);
  }
  return _db;
}
