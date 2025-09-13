import {logError, log, logInfo, logWarn} from './shared/logger';
import { readAppEnv } from './shared/config';
import { runWeb } from './parsers/web';

async function main() {
    const env = readAppEnv();

    try {
        await runWeb(env);
        logInfo('WEB parser completed successfully.');
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
