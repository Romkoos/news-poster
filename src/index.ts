import { logError, log, logInfo, logWarn } from './shared/logger';
import { readAppEnv } from './shared/config';
import { selectParser } from './parsers';

async function main() {
    const env = readAppEnv();

    try {
        const parser = selectParser(env.PARSER_TYPE);
        await parser.run(env);
        logInfo(`${parser.name.toUpperCase()} parser completed successfully.`);
        log('----------------------------------------------');
        log(' ');
        return;
    } catch (e: any) {
        const msg = e?.message || String(e);
        logWarn('Parser run failed:', msg);
        throw e; // пусть pm2 увидит фейл и перезапустит по расписанию
    }
}

main().catch((err) => {
    logError('FATAL:', err);
    process.exit(1);
});
