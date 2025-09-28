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

    // base table (without new columns) — created if not exists
    db.prepare(`
        CREATE TABLE IF NOT EXISTS news (
                                            id    INTEGER PRIMARY KEY AUTOINCREMENT,
                                            ts    INTEGER NOT NULL,
                                            date  TEXT    NOT NULL,
                                            hash  TEXT    NOT NULL UNIQUE,
                                            text_original TEXT,
                                            text  TEXT,
                                            tg_message_id INTEGER,
                                            status TEXT NOT NULL DEFAULT 'published'
        )
    `).run();

    // lightweight migration: add columns if missing
    const cols = db.prepare(`PRAGMA table_info(news)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map(c => c.name));
    if (!names.has('text_original')) {
        db.prepare(`ALTER TABLE news ADD COLUMN text_original TEXT`).run();
    }
    if (!names.has('tg_message_id')) {
        db.prepare(`ALTER TABLE news ADD COLUMN tg_message_id INTEGER`).run();
    }
    if (!names.has('status')) {
        db.prepare(`ALTER TABLE news ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`).run();
    }

    // Aggregator table: per-day counters by status
    db.prepare(`
        CREATE TABLE IF NOT EXISTS aggregator (
            date TEXT PRIMARY KEY,
            published INTEGER NOT NULL DEFAULT 0,
            rejected  INTEGER NOT NULL DEFAULT 0,
            moderated INTEGER NOT NULL DEFAULT 0,
            filtered  INTEGER NOT NULL DEFAULT 0
        )
    `).run();

    // NEW: Filter aggregator table — per-day counters by filter note (including EXCLUDED_AUTHORS and moderation)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS filter_aggregator (
            date TEXT NOT NULL,
            note TEXT NOT NULL,
            hits INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(date, note)
        )
    `).run();

    // ensure text can be NULL (older schema had NOT NULL). We won't alter constraint; just handle NULLs in code.

    const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?');
    const metaSet = db.prepare(`
        INSERT INTO meta(key, value) VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    const newsInsert = db.prepare(`
        INSERT INTO news(ts, date, hash, text_original, text, tg_message_id, status)
        VALUES(@ts, @date, @hash, @text_original, @text, @tg_message_id, @status)
        ON CONFLICT(hash) DO UPDATE SET
          text_original = COALESCE(excluded.text_original, news.text_original),
          text = COALESCE(excluded.text, news.text),
          tg_message_id = COALESCE(excluded.tg_message_id, news.tg_message_id),
          status = COALESCE(excluded.status, news.status)
    `);

    const news = db.prepare(`
        SELECT id, ts, date, hash, COALESCE(text, text_original, '') as text
        FROM news
        ORDER BY ts ASC
    `);

    const newsByDate = db.prepare(`
        SELECT id, ts, date, hash, COALESCE(text, text_original, '') as text
        FROM news
        WHERE date = ?
        ORDER BY ts ASC
    `);

    const newsByDatePublic = db.prepare(`
        SELECT id, ts, date, hash, status, COALESCE(text, text_original, '') as text
        FROM news
        WHERE date = ? AND status IN ('published','moderated')
        ORDER BY ts ASC
    `);

    const purgeNotDate = db.prepare(`
        DELETE FROM news
        WHERE date <> ?
    `);

    const tgMsgIdByIdStmt = db.prepare(`SELECT tg_message_id FROM news WHERE id = ?`);

    // NEW: быстрый проверочный запрос по хешу
    const newsHasHashStmt = db.prepare(`SELECT 1 FROM news WHERE hash = ? LIMIT 1`);
    const latestNewsIdStmt = db.prepare(`SELECT id FROM news ORDER BY id DESC LIMIT 1`);
    const lastNewsStmt = db.prepare(`SELECT id, text_original FROM news ORDER BY id DESC LIMIT ?`);

    const setTgMsgIdByHash = db.prepare(`
        UPDATE news SET tg_message_id = @tg_message_id WHERE hash = @hash
    `);

    // stats: timestamps in range [fromTs, toTs)
    const newsTsBetweenStmt = db.prepare(`
        SELECT ts FROM news
        WHERE ts >= ? AND ts < ? AND status IN ('published','moderated')
        ORDER BY ts ASC
    `);

    // stats (hidden): rejected/filtered timestamps in range [fromTs, toTs)
    const newsTsBetweenHiddenStmt = db.prepare(`
        SELECT ts FROM news
        WHERE ts >= ? AND ts < ? AND status IN ('rejected','filtered')
        ORDER BY ts ASC
    `);

    // aggregator statements
    const aggUpsertStmt = db.prepare(`
        INSERT INTO aggregator(date, published, rejected, moderated, filtered)
        VALUES(@date, @published, @rejected, @moderated, @filtered)
        ON CONFLICT(date) DO UPDATE SET
          published = aggregator.published + excluded.published,
          rejected  = aggregator.rejected  + excluded.rejected,
          moderated = aggregator.moderated + excluded.moderated,
          filtered  = aggregator.filtered  + excluded.filtered
    `);

    const aggRangeStmt = db.prepare(`
        SELECT date, published, rejected, moderated, filtered
        FROM aggregator
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
    `);

    // NEW: filter aggregator statements
    const filtAggUpsertStmt = db.prepare(`
        INSERT INTO filter_aggregator(date, note, hits)
        VALUES(@date, @note, @hits)
        ON CONFLICT(date, note) DO UPDATE SET
          hits = filter_aggregator.hits + excluded.hits
    `);

    const filtAggRangeStmt = db.prepare(`
        SELECT date, note, hits FROM filter_aggregator
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC, hits DESC
    `);

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

        // сохраняем оригинал и перевод (если есть), а также message_id и статус
        addNews(textOriginal: string, hash: string, ts: number = Date.now(), textTranslated?: string | null, tgMessageId?: number | null, status: 'published' | 'rejected' | 'moderated' | 'filtered' | 'review' = 'published'): void {
            const date = todayLocal();
            newsInsert.run({
                ts,
                date,
                hash,
                text_original: textOriginal,
                // fallback: keep compatibility with older DBs where text might be NOT NULL
                text: textTranslated ?? textOriginal,
                tg_message_id: tgMessageId ?? null,
                status: status ?? 'published',
            });
            // increment daily aggregator for tracked statuses
            if (status === 'published' || status === 'rejected' || status === 'moderated' || status === 'filtered') {
                try {
                    aggUpsertStmt.run({
                        date,
                        published: status === 'published' ? 1 : 0,
                        rejected:  status === 'rejected'  ? 1 : 0,
                        moderated: status === 'moderated' ? 1 : 0,
                        filtered:  status === 'filtered'  ? 1 : 0,
                    });
                } catch {}
            }
        },

        // только опубликованные и модерированные за дату (для публичных выдач)
        getPublicNewsFor(date: string) {
            return newsByDatePublic.all(date) as Array<{ id: number; ts: number; date: string; hash: string; status: string; text: string }>;
        },

        // обновить запись новости по хешу после модерации (обновляем текст, статус и message_id)
        updateNewsModeratedByHash(hash: string, textTranslated: string, tgMessageId: number | null): void {
            const info = db.prepare(`
                UPDATE news
                SET text = @text, status = 'moderated', tg_message_id = COALESCE(@tg_message_id, tg_message_id)
                WHERE hash = @hash
            `).run({ hash, text: textTranslated, tg_message_id: tgMessageId ?? null, ts: Date.now(), date: todayLocal() });
            // increment aggregator for moderation action only if row was updated
            if ((info as any)?.changes > 0) {
                try {
                    aggUpsertStmt.run({
                        date: todayLocal(),
                        published: 0,
                        rejected: 0,
                        moderated: 1,
                        filtered: 0,
                    });
                } catch {}
            }
        },

        // установить статус по хешу
        setStatusByHash(hash: string, status: 'published' | 'rejected' | 'moderated' | 'filtered' | 'review'): void {
            const info = db.prepare(`UPDATE news SET status = ? WHERE hash = ?`).run(status, hash);
            if ((info as any)?.changes > 0 && (status === 'published' || status === 'rejected' || status === 'moderated' || status === 'filtered')) {
                try {
                    aggUpsertStmt.run({
                        date: todayLocal(),
                        published: status === 'published' ? 1 : 0,
                        rejected:  status === 'rejected'  ? 1 : 0,
                        moderated: status === 'moderated' ? 1 : 0,
                        filtered:  status === 'filtered'  ? 1 : 0,
                    });
                } catch {}
            }
        },

        // точечное обновление message_id при необходимости
        setTelegramMessageIdByHash(hash: string, tgMessageId: number): void {
            setTgMsgIdByHash.run({ hash, tg_message_id: tgMessageId });
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

        // NEW: последние N новостей (по id DESC)
        getLastNews(limit: number): Array<{ id: number; text_original: string }> {
            const lim = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 10));
            return lastNewsStmt.all(lim) as Array<{ id: number; text_original: string }>;
        },

        // NEW: получить tg_message_id по id записи
        getTelegramMessageIdById(id: number): number | null {
            const row = tgMsgIdByIdStmt.get(id) as { tg_message_id?: number } | undefined;
            const mid = row?.tg_message_id;
            return (typeof mid === 'number' && Number.isFinite(mid) && mid > 0) ? Math.floor(mid) : null;
        },

        // stats helper: timestamps between [fromTs, toTs)
        getTimestampsBetween(fromTs: number, toTs: number): number[] {
            if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return [];
            const rows = newsTsBetweenStmt.all(fromTs, toTs) as Array<{ ts: number }>;
            return rows.map(r => r.ts);
        },

        // stats helper: hidden (rejected/filtered) timestamps between [fromTs, toTs)
        getTimestampsBetweenHidden(fromTs: number, toTs: number): number[] {
            if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return [];
            const rows = newsTsBetweenHiddenStmt.all(fromTs, toTs) as Array<{ ts: number }>;
            return rows.map(r => r.ts);
        },

        // aggregator: manual increment if needed by external code
        incAggregator(status: 'published' | 'rejected' | 'moderated' | 'filtered', date?: string): void {
            const d = date || todayLocal();
            try {
                aggUpsertStmt.run({
                    date: d,
                    published: status === 'published' ? 1 : 0,
                    rejected:  status === 'rejected'  ? 1 : 0,
                    moderated: status === 'moderated' ? 1 : 0,
                    filtered:  status === 'filtered'  ? 1 : 0,
                });
            } catch {}
        },

        // aggregator: get last N days with zero-filling
        getAggregatorLastDays(days: number): Array<{ date: string; published: number; rejected: number; moderated: number; filtered: number }> {
            const n = Math.max(1, Math.min(366, Math.floor(Number(days)) || 1));
            const dates: string[] = [];
            const base = new Date();
            for (let i = n - 1; i >= 0; i--) {
                const d = new Date(base);
                d.setHours(0,0,0,0);
                d.setDate(d.getDate() - i);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                dates.push(`${yyyy}-${mm}-${dd}`);
            }
            const start = dates[0];
            const end = dates[dates.length - 1];
            const rows = aggRangeStmt.all(start, end) as Array<{ date: string; published: number; rejected: number; moderated: number; filtered: number }>;
            const map = new Map(rows.map(r => [r.date, r]));
            return dates.map(date => map.get(date) || { date, published: 0, rejected: 0, moderated: 0, filtered: 0 });
        },

        // NEW: log a filter hit by note (defaults to 'UNKNOWN')
        logFilterHit(note: string, date?: string): void {
            const safeNote = String(note || 'UNKNOWN').slice(0, 200);
            const d = date || todayLocal();
            try {
                filtAggUpsertStmt.run({ date: d, note: safeNote, hits: 1 });
            } catch {}
        },

        // NEW: get last N days of filter hits grouped by note
        getFilterHitsLastDays(days: number): Array<{ date: string; items: Array<{ note: string; count: number }> }> {
            const n = Math.max(1, Math.min(366, Math.floor(Number(days)) || 1));
            const dates: string[] = [];
            const base = new Date();
            for (let i = n - 1; i >= 0; i--) {
                const d = new Date(base);
                d.setHours(0,0,0,0);
                d.setDate(d.getDate() - i);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                dates.push(`${yyyy}-${mm}-${dd}`);
            }
            const start = dates[0];
            const end = dates[dates.length - 1];
            const rows = filtAggRangeStmt.all(start, end) as Array<{ date: string; note: string; hits: number }>;
            const byDate = new Map<string, Array<{ note: string; count: number }>>();
            for (const r of rows) {
                const arr = byDate.get(r.date) || [];
                arr.push({ note: r.note, count: r.hits });
                byDate.set(r.date, arr);
            }
            return dates.map(date => ({ date, items: byDate.get(date) || [] }));
        }
    };
}
