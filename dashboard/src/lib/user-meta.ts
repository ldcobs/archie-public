import type { UserMeta, UserMetaStore } from './types';
import { getDb } from './db';

interface DbRow {
  uuid: string; display_name: string; group_name: string; is_owner: number;
  expected_isps: string; notes: string | null; created_at: string;
  expires_at: string | null; traffic_limit_gb: number | null; connection_limit: number | null;
  protocols: string | null; last_sub_fetch: string | null; sub_fetch_count: number | null;
  detected_client: string | null; detected_client_raw: string | null;
  disabled: number | null; disabled_reason: string | null;
  unknown_device: string | null; new_country: string | null;
  new_isp: string | null; overflow_action: string | null;
}

function rowToMeta(row: DbRow): UserMeta {
  return {
    uuid: row.uuid,
    displayName: row.display_name,
    group: row.group_name,
    isOwner: row.is_owner === 1,
    expectedIsps: JSON.parse(row.expected_isps) as string[],
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    trafficLimitGB: row.traffic_limit_gb ?? undefined,
    connectionLimit: row.connection_limit ?? undefined,
    protocols: row.protocols ? (JSON.parse(row.protocols) as string[]) : undefined,
    lastSubFetch: row.last_sub_fetch ?? undefined,
    subFetchCount: row.sub_fetch_count ?? undefined,
    detectedClient: row.detected_client ?? undefined,
    detectedClientRaw: row.detected_client_raw ?? undefined,
    disabled: row.disabled === 1 ? true : undefined,
    disabledReason: (row.disabled_reason as UserMeta['disabledReason']) ?? undefined,
    unknownDevice:  (row.unknown_device  as UserMeta['unknownDevice'])  ?? undefined,
    newCountry:     (row.new_country     as UserMeta['newCountry'])     ?? undefined,
    newIsp:         (row.new_isp         as UserMeta['newIsp'])         ?? undefined,
    overflowAction: (row.overflow_action as UserMeta['overflowAction']) ?? undefined,
  };
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO user_meta
    (uuid, display_name, group_name, is_owner, expected_isps, notes, created_at,
     expires_at, traffic_limit_gb, connection_limit, protocols,
     last_sub_fetch, sub_fetch_count, detected_client, detected_client_raw,
     disabled, disabled_reason,
     unknown_device, new_country, new_isp, overflow_action)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function bindMeta(m: UserMeta): unknown[] {
  return [
    m.uuid, m.displayName, m.group, m.isOwner ? 1 : 0,
    JSON.stringify(m.expectedIsps ?? []), m.notes ?? null, m.createdAt,
    m.expiresAt ?? null, m.trafficLimitGB ?? null, m.connectionLimit ?? null,
    m.protocols ? JSON.stringify(m.protocols) : null,
    m.lastSubFetch ?? null, m.subFetchCount ?? null,
    m.detectedClient ?? null, m.detectedClientRaw ?? null,
    m.disabled ? 1 : 0, m.disabledReason ?? null,
    m.unknownDevice  ?? null, m.newCountry     ?? null,
    m.newIsp         ?? null, m.overflowAction ?? null,
  ];
}

export function loadMeta(): UserMetaStore {
  const rows = getDb().prepare('SELECT * FROM user_meta').all() as DbRow[];
  return Object.fromEntries(rows.map(r => [r.uuid, rowToMeta(r)]));
}

export function saveMeta(store: UserMetaStore): boolean {
  const db = getDb();
  const ins = db.prepare(UPSERT_SQL);
  db.transaction(() => {
    db.prepare('DELETE FROM user_meta').run();
    for (const m of Object.values(store)) ins.run(...bindMeta(m));
  })();
  return true;
}

export function getMetaByUuid(uuid: string): UserMeta | null {
  const row = getDb().prepare('SELECT * FROM user_meta WHERE uuid = ?').get(uuid) as DbRow | undefined;
  return row ? rowToMeta(row) : null;
}

export function upsertMeta(uuid: string, patch: Partial<Omit<UserMeta, 'uuid'>>): UserMeta {
  const existing = getMetaByUuid(uuid);
  const updated: UserMeta = {
    uuid,
    displayName:      patch.displayName     ?? existing?.displayName     ?? uuid.slice(0, 8),
    group:            patch.group           ?? existing?.group           ?? 'Ungrouped',
    isOwner:          patch.isOwner         ?? existing?.isOwner         ?? false,
    expectedIsps:     patch.expectedIsps    ?? existing?.expectedIsps    ?? [],
    notes:            patch.notes           ?? existing?.notes,
    createdAt:        existing?.createdAt   ?? new Date().toISOString(),
    expiresAt:        patch.expiresAt       !== undefined ? patch.expiresAt       : existing?.expiresAt,
    trafficLimitGB:   patch.trafficLimitGB  !== undefined ? patch.trafficLimitGB  : existing?.trafficLimitGB,
    connectionLimit:  patch.connectionLimit !== undefined ? patch.connectionLimit : existing?.connectionLimit,
    protocols:        patch.protocols       !== undefined ? patch.protocols       : existing?.protocols,
    disabled:         patch.disabled        !== undefined ? patch.disabled        : existing?.disabled,
    disabledReason:   patch.disabledReason  !== undefined ? patch.disabledReason  : existing?.disabledReason,
    unknownDevice:    patch.unknownDevice   !== undefined ? patch.unknownDevice   : existing?.unknownDevice,
    newCountry:       patch.newCountry      !== undefined ? patch.newCountry      : existing?.newCountry,
    newIsp:           patch.newIsp          !== undefined ? patch.newIsp          : existing?.newIsp,
    overflowAction:   patch.overflowAction  !== undefined ? patch.overflowAction  : existing?.overflowAction,
    lastSubFetch:     existing?.lastSubFetch,
    subFetchCount:    existing?.subFetchCount,
    detectedClient:   existing?.detectedClient,
    detectedClientRaw: existing?.detectedClientRaw,
  };
  getDb().prepare(UPSERT_SQL).run(...bindMeta(updated));
  return updated;
}

export function patchMeta(uuid: string, patch: Partial<Omit<UserMeta, 'uuid' | 'createdAt'>>): void {
  const existing = getMetaByUuid(uuid);
  if (!existing) return;
  getDb().prepare(UPSERT_SQL).run(...bindMeta({ ...existing, ...patch }));
}

export function deleteMeta(uuid: string): boolean {
  return getDb().prepare('DELETE FROM user_meta WHERE uuid = ?').run(uuid).changes > 0;
}

// Move a meta row to a new UUID (key rotation), preserving every field incl. createdAt.
export function renameMetaUuid(oldUuid: string, newUuid: string): boolean {
  return getDb().prepare('UPDATE user_meta SET uuid = ? WHERE uuid = ?').run(newUuid, oldUuid).changes > 0;
}

