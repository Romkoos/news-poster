import { log } from '../shared/logger';
import { initDb } from '../api/news/db';
import {readAppEnv} from "../shared/config";

const config = readAppEnv();

// --- step 1: статистика из Telegram ---
async function collectStats(db: ReturnType<typeof initDb>) {
    log('Collecting stats from Telegram...');
    //const membersCountApi = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getChatMemberCount?chat_id=${config.TELEGRAM_CHAT_ID}`
    // TODO: пройтись по таблице news, взять tg_message_id,
    // сходить в Telegram API, положить результаты в другую таблицу.
    // Заглушка:
    await new Promise(res => setTimeout(res, 2000));
    log('Stats collection complete.');
}

// --- step 2: очистка базы ---
// function purgeOldNews(db: ReturnType<typeof initDb>) {
//     log('Purging old news...');
//     db.raw.prepare(`
//         DELETE FROM news
//         WHERE id NOT IN (
//             SELECT id FROM news
//             ORDER BY id DESC
//             LIMIT 5
//         )
//     `).run();
//     log('Purge complete: kept last 5 records.');
// }

async function main() {
    const db = initDb();

    try {
        if (config.ENABLE_STATS) {
            await collectStats(db);
        } else {
            log('Stats collection skipped (ENABLE_STATS=false).');
        }

        // if (config.ENABLE_PURGE) {
        //     purgeOldNews(db);
        // } else {
        //     log('Purge skipped (ENABLE_PURGE=false).');
        // }
    } catch (e) {
        log('Maintenance failed:', e);
    } finally {
        db.raw.close();
    }
}

main();
