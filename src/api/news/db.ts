// src/lib/db.ts
import Database from 'better-sqlite3';
import * as path from 'node:path';
import { ensureDirs } from '../../shared/fsutil';
import { todayLocal } from '../../shared/time';

export function initDb(dbPath = path.resolve('data', 'news.db')) {
    ensureDirs([path.dirname(dbPath)]);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.prepare(`
        CREATE TABLE IF NOT EXISTS meta (
                                            key   TEXT PRIMARY KEY,
                                            value TEXT
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS news (
                                            id    INTEGER PRIMARY KEY AUTOINCREMENT,
                                            ts    INTEGER NOT NULL,
                                            date  TEXT    NOT NULL,
                                            hash  TEXT    NOT NULL UNIQUE,
                                            text  TEXT    NOT NULL
        )
    `).run();

    const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?');
    const metaSet = db.prepare(`
        INSERT INTO meta(key, value) VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    const newsInsert = db.prepare(`
        INSERT INTO news(ts, date, hash, text)
        VALUES(@ts, @date, @hash, @text)
        ON CONFLICT(hash) DO UPDATE SET
          ts = excluded.ts,
          date = excluded.date,
          text = excluded.text
    `);

    const newsByDate = db.prepare(`
        SELECT id, ts, date, hash, text
        FROM news
        WHERE date = ?
        ORDER BY ts ASC
    `);

    const purgeNotDate = db.prepare(`
        DELETE FROM news
        WHERE date <> ?
    `);

    // NEW: быстрый проверочный запрос по хешу
    const newsHasHashStmt = db.prepare(`SELECT 1 FROM news WHERE hash = ? LIMIT 1`);
    const latestNewsIdStmt = db.prepare(`SELECT id FROM news ORDER BY id DESC LIMIT 1`);

    return {
        raw: db,

        getLastHash(): string | null {
            const row = metaGet.get('last_hash') as { value?: string } | undefined;
            return row?.value ?? null;
        },

        setLastHash(h: string): void {
            metaSet.run('last_hash', h);
        },

        // --- meta: lastUsedPostId ---
        getLastUsedPostId(): number {
            const row = metaGet.get('lastUsedPostId') as { value?: string } | undefined;
            const n = row?.value != null ? Number(row.value) : 0;
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        },
        setLastUsedPostId(id: number): void {
            const v = Math.max(0, Math.floor(Number(id)));
            metaSet.run('lastUsedPostId', String(v));
        },

        // --- news helpers ---
        getLatestNewsId(): number {
            const row = latestNewsIdStmt.get() as { id?: number } | undefined;
            const id = row?.id ?? 0;
            return Number.isFinite(id) && id > 0 ? id : 0;
        },

        // сохраняем уже ПЕРЕВЕДЁННЫЙ текст (ru)
        addNews(text: string, hash: string, ts: number = Date.now()): void {
            newsInsert.run({ ts, date: todayLocal(), hash, text });
        },

        getNewsFor(date: string) {
            return newsByDate.all(date) as Array<{ id: number; ts: number; date: string; hash: string; text: string }>;
        },

        purgeExceptToday(): void {
            purgeNotDate.run(todayLocal());
        },

        purgeExcept(date: string): void {
            purgeNotDate.run(date);
        },

        // NEW: есть ли уже запись с таким хешем?
        hasNewsHash(hash: string): boolean {
            return !!newsHasHashStmt.get(hash);
        },
    };
}
