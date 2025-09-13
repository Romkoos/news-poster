// src/translate/index.ts
import {log, logWarn} from '../shared/logger';
import { heToRuDeepl } from './deepl';
import { AppEnv } from "../shared/config";

export async function heToRu(text: string, env: AppEnv): Promise<string> {
    if (env.USE_DEEPL && env.DEEPL_API_KEY) {
        try {
            const t0 = Date.now();
            const out = await heToRuDeepl(text);
            log('DeepL OK in ms:', Date.now() - t0);
            return out;
        } catch (e: any) {
            const msg = (e && e.message) ? e.message : String(e);
            log('DeepL failed, fallback to local translator. Reason:', msg);
        }
    } else {
        log('DeepL is not configured');
    }

    logWarn('Using original text (HE)')
    return text;

}
