import { db } from '../auth/db';
import { randomUUID } from 'node:crypto';

export type UUID = string;

export interface DbModerationRow {
  id: string;
  text_he: string;
  media: string | null;
  created_at: number; // ms epoch UTC
  filter_id: string;
}

export interface ModerationItem {
  id: UUID;
  textHe: string;
  media?: string;
  createdAt: string; // ISO
  filterId: UUID;
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_items (
      id TEXT PRIMARY KEY,
      text_he TEXT NOT NULL,
      media TEXT NULL,
      created_at INTEGER NOT NULL,
      filter_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_moderation_items_created ON moderation_items(created_at DESC);
  `);
}

ensureSchema();

function rowToApi(row: DbModerationRow): ModerationItem {
  return {
    id: row.id,
    textHe: row.text_he,
    media: row.media ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    filterId: row.filter_id,
  };
}

export function insertModerationItem(textHe: string, filterId: string, media?: string): ModerationItem {
  const id = randomUUID();
  const created_at = Date.now();
  const stmt = db.prepare(`
    INSERT INTO moderation_items(id, text_he, media, created_at, filter_id)
    VALUES(?, ?, ?, ?, ?)
  `);
  stmt.run(id, textHe, media ?? null, created_at, filterId);
  return getModerationById(id)!;
}

export function getModerationById(id: string): ModerationItem | undefined {
  const row = db.prepare(`
    SELECT id, text_he, media, created_at, filter_id
    FROM moderation_items WHERE id = ?
  `).get(id) as DbModerationRow | undefined;
  return row && rowToApi(row);
}

export function deleteModerationById(id: string): boolean {
  const info = db.prepare(`DELETE FROM moderation_items WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function listModeration(limit = 50, offset = 0): ModerationItem[] {
  limit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  offset = Math.max(0, Math.floor(Number(offset) || 0));
  const rows = db.prepare(`
    SELECT id, text_he, media, created_at, filter_id
    FROM moderation_items
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as DbModerationRow[];
  return rows.map(rowToApi);
}
