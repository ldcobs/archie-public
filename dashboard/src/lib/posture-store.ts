// Server-only persistence for security postures (per-key + per-group preset).
// Kept in a JSON state file alongside the other vpn-api state, so no DB migration.
import fs from 'fs';
import path from 'path';
import { writeJsonFileAtomic } from './state-storage';
import type { PostureStore, PosturePreset } from './posture';
import { PRESET_ORDER } from './posture';

const STATE_DIR     = process.env.STATE_DIR ?? '/app/vpn-api';
const POSTURE_FILE  = path.join(STATE_DIR, 'posture.json');

function isPreset(v: unknown): v is PosturePreset {
  return typeof v === 'string' && (PRESET_ORDER as string[]).includes(v);
}

export function loadPostureStore(): PostureStore {
  try {
    const raw = JSON.parse(fs.readFileSync(POSTURE_FILE, 'utf8'));
    return {
      groups: raw.groups && typeof raw.groups === 'object' ? raw.groups : {},
      keys:   raw.keys   && typeof raw.keys   === 'object' ? raw.keys   : {},
    };
  } catch {
    return { groups: {}, keys: {} };
  }
}

function save(store: PostureStore) {
  writeJsonFileAtomic(POSTURE_FILE, store);
}

export function setKeyPreset(email: string, preset: PosturePreset | null): PostureStore {
  const store = loadPostureStore();
  if (preset === null) delete store.keys[email];
  else if (isPreset(preset)) store.keys[email] = preset;
  save(store);
  return store;
}

// Set a group's default posture. `clearKeys` removes per-key overrides for the given
// emails so they all fall back to the new group default — i.e. "apply to the whole group".
export function setGroupPreset(group: string, preset: PosturePreset | null, clearKeys: string[] = []): PostureStore {
  const store = loadPostureStore();
  if (preset === null) delete store.groups[group];
  else if (isPreset(preset)) store.groups[group] = preset;
  for (const email of clearKeys) delete store.keys[email];
  save(store);
  return store;
}
