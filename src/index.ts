import './ort-silence';
import { log } from './lib/logger';
import { readAppEnv } from './lib/env';

// парсеры
import { runMobile } from './parsers/mobile';
import { runWeb } from './parsers/web';

async function main() {
    const env = readAppEnv();

    // 1) Сначала — мобильная версия
    if (env.TRY_MOBILE) {
        try {
            await runMobile(env);
            log('Mobile parser completed successfully.');
            return;
        } catch (e) {
            log('Mobile parser failed, fallback to WEB:', e);
        }
    }

    // 2) Если мобильный не удался — пробуем WEB
    try {
        await runWeb(env);
        log('WEB parser completed successfully.');
        return;
    } catch (e) {
        log('WEB parser failed as well:', e);
        throw e; // пусть pm2 увидит фейл и перезапустит по расписанию
    }
}

main().catch((err) => {
    log('FATAL:', err);
    process.exit(1);
});
