import './ort-silence';
import {logError, log, logInfo, logWarn} from './lib/logger';
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
            logInfo('Mobile parser completed successfully.');
            return;
        } catch (e) {
            log('Mobile parser failed, fallback to WEB:', e);
        }
    }

    // 2) Если мобильный не удался — пробуем WEB
    try {
        await runWeb(env);
        logInfo('WEB parser completed successfully.');
        log(' ');
        log('----------------------------------------------');
        log(' ');
        return;
    } catch (e) {
        logWarn('WEB parser failed as well:', e.message);
        throw e; // пусть pm2 увидит фейл и перезапустит по расписанию
    }
}

main().catch((err) => {
    logError('FATAL:', err);
    process.exit(1);
});
