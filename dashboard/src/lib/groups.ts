import { getDb } from './db';

export interface GroupSummary {
  name: string;
  count: number;
}

/** All distinct groups with member counts, sorted by name. Includes groups that
 * only exist on invite tokens (created during invite generation, not yet redeemed)
 * so the invite dropdown and the Access Keys page show the SAME set of groups. */
export function listGroups(): GroupSummary[] {
  const rows = getDb().prepare(
    `SELECT COALESCE(NULLIF(group_name, ''), 'Ungrouped') AS name, COUNT(*) AS count
     FROM user_meta GROUP BY name ORDER BY name COLLATE NOCASE`,
  ).all() as GroupSummary[];

  const byName = new Map<string, GroupSummary>(rows.map(r => [r.name, r]));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listInviteTokens } = require('./invite-tokens') as typeof import('./invite-tokens');
    for (const t of listInviteTokens()) {
      const name = (t.group || 'Ungrouped').trim() || 'Ungrouped';
      if (!byName.has(name)) byName.set(name, { name, count: 0 });
    }
  } catch { /* invite store unavailable — fall back to key-derived groups */ }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Rename a group across every key that belongs to it. Returns rows changed. */
export function renameGroup(oldName: string, newName: string): number {
  const next = newName.trim() || 'Ungrouped';
  return getDb().prepare('UPDATE user_meta SET group_name = ? WHERE group_name = ?')
    .run(next, oldName).changes;
}

/** Delete a group by reassigning all its members to 'Ungrouped'. Returns rows changed. */
export function deleteGroup(name: string): number {
  if (name === 'Ungrouped') return 0; // can't delete the catch-all
  return getDb().prepare("UPDATE user_meta SET group_name = 'Ungrouped' WHERE group_name = ?")
    .run(name).changes;
}
