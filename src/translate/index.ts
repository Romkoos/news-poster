// src/translate/index.ts
import {log, logInfo, logWarn} from '../lib/logger';
import { heToRu as heToRuLocal } from './translate'; // ваш существующий локальный переводчик
import { heToRuDeepl } from './deepl';
import {AppEnv} from "../lib/env";

export async function heToRu(text: string, env: AppEnv): Promise<string> {
    // 1) пытаемся DeepL, если есть ключ
    if (env.USE_DEEPL && env.DEEPL_API_KEY) {
        try {
            const t0 = Date.now();
            const out = await heToRuDeepl(text);
            log('DeepL OK in ms:', Date.now() - t0);
            return out;
        } catch (e: any) {
            // фолбэк на локальный
            const msg = (e && e.message) ? e.message : String(e);
            log('DeepL failed, fallback to local translator. Reason:', msg);
        }
    } else {
        log('DeepL is not configured');
    }

    // 2) локальный переводчик
    if (env.USE_LOCAL_TRANSLATION) {
        const t1 = Date.now();
        const out = await heToRuLocal(text);
        log('Local translator OK in ms:', Date.now() - t1);
        return out;
    }
    logWarn('Using original text (HE)')
    return text;

}
