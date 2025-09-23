import { db } from '../auth/db';
import { randomUUID } from 'node:crypto';
import { nowMs } from '../../shared/time';

export type UUID = string;
export type FilterAction = 'publish' | 'reject' | 'moderation';
export type MatchType = 'substring' | 'regex';

export interface DbFilterRow {
  id: string;
  keyword: string;
  action: FilterAction;
  priority: number;
  match_type: MatchType;
  active: number; // 0/1
  notes: string | null;
  updated_at: number; // ms epoch
}

export interface FilterApiShape {
  id: UUID;
  keyword: string;
  action: FilterAction;
  priority: number;
  matchType?: MatchType;
  active?: boolean;
  notes?: string;
  updatedAt: string; // ISO
}

export type FilterInput = Omit<FilterApiShape, 'id' | 'updatedAt'>;

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS filters (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('publish','reject','moderation')),
      priority INTEGER NOT NULL,
      match_type TEXT NOT NULL CHECK(match_type IN ('substring','regex')) DEFAULT 'substring',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_filters_sort ON filters(priority DESC, updated_at DESC);
  `);

  // Partial unique index for active duplicates if supported (SQLite supports WHERE)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_filters_unique_active
      ON filters(keyword, match_type)
      WHERE active = 1;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      default_action TEXT NOT NULL CHECK(default_action IN ('publish','reject','moderation')) DEFAULT 'publish',
      updated_at INTEGER NOT NULL
    );
  `);
}

ensureSchema();

export function rowToApi(row: DbFilterRow): FilterApiShape {
  return {
    id: row.id,
    keyword: row.keyword,
    action: row.action,
    priority: row.priority,
    matchType: row.match_type,
    active: !!row.active,
    notes: row.notes ?? undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function listFilters(): FilterApiShape[] {
  const rows = db.prepare(`
    SELECT id, keyword, action, priority, match_type, active, notes, updated_at
    FROM filters
    ORDER BY priority DESC, updated_at DESC
  `).all() as DbFilterRow[];
  return rows.map(rowToApi);
}

export function getFilterById(id: string): FilterApiShape | undefined {
  const row = db.prepare(`
    SELECT id, keyword, action, priority, match_type, active, notes, updated_at
    FROM filters WHERE id = ?
  `).get(id) as DbFilterRow | undefined;
  return row && rowToApi(row);
}

export function hasActiveDuplicate(keyword: string, matchType: MatchType, excludeId?: string): boolean {
  const sql = excludeId
    ? `SELECT 1 FROM filters WHERE active = 1 AND keyword = ? AND match_type = ? AND id <> ? LIMIT 1`
    : `SELECT 1 FROM filters WHERE active = 1 AND keyword = ? AND match_type = ? LIMIT 1`;
  const row = excludeId
    ? db.prepare(sql).get(keyword, matchType, excludeId)
    : db.prepare(sql).get(keyword, matchType);
  return !!row;
}

export function insertFilter(input: Required<FilterInput>): FilterApiShape {
  const id = randomUUID();
  const updated_at = nowMs();
  const stmt = db.prepare(`
    INSERT INTO filters(id, keyword, action, priority, match_type, active, notes, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    input.keyword,
    input.action,
    input.priority,
    input.matchType ?? 'substring',
    input.active ? 1 : 0,
    input.notes ?? null,
    updated_at,
  );
  return getFilterById(id)!;
}

export function updateFilter(id: string, merged: Required<FilterInput>): FilterApiShape | undefined {
  const updated_at = nowMs();
  const stmt = db.prepare(`
    UPDATE filters
    SET keyword = ?, action = ?, priority = ?, match_type = ?, active = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `);
  const info = stmt.run(
    merged.keyword,
    merged.action,
    merged.priority,
    merged.matchType ?? 'substring',
    merged.active ? 1 : 0,
    merged.notes ?? null,
    updated_at,
    id,
  );
  if (info.changes === 0) return undefined;
  return getFilterById(id)!;
}

export function deleteFilter(id: string): boolean {
  const info = db.prepare(`DELETE FROM filters WHERE id = ?`).run(id);
  return info.changes > 0;
}

export type Settings = { defaultAction: FilterAction };

export function getSettings(): Settings {
  const row = db.prepare(`SELECT default_action, updated_at FROM settings WHERE id = 1`).get() as { default_action: FilterAction; updated_at: number } | undefined;
  if (!row) return { defaultAction: 'publish' };
  return { defaultAction: row.default_action };
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const existing = db.prepare(`SELECT default_action FROM settings WHERE id = 1`).get() as { default_action: FilterAction } | undefined;
  const next: Settings = { defaultAction: patch.defaultAction ?? existing?.default_action ?? 'publish' };
  const updated_at = nowMs();
  db.prepare(`
    INSERT INTO settings(id, default_action, updated_at) VALUES(1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET default_action = excluded.default_action, updated_at = excluded.updated_at
  `).run(next.defaultAction, updated_at);
  return next;
}
