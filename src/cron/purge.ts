import { log } from '../shared/logger';
import {initDb} from "../api/news/db";

async function main() {
    const db = initDb();

    try {
        db.raw.prepare(`
            DELETE FROM news
            WHERE ts < (strftime('%s','now') - 86400) * 1000
        `).run();

        log('Purge complete: kept last 5 records.');
    } catch (e) {
        log('Purge failed:', e);
    } finally {
        db.raw.close();
    }
}

main();
