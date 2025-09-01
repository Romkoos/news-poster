import { initDb } from './lib/db';
import { log } from './lib/logger';

async function main() {
    const db = initDb();

    try {
        // Удаляем все, кроме последних 5 записей
        db.raw.prepare(`
            DELETE FROM news
            WHERE id NOT IN (
                SELECT id FROM news
                ORDER BY id DESC
                LIMIT 5
            )
        `).run();

        log('Purge complete: kept last 5 records.');
    } catch (e) {
        log('Purge failed:', e);
    } finally {
        db.raw.close();
    }
}

main();
