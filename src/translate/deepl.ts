import * as deepl from 'deepl-node';
import {log} from "../shared/logger";

const authKey = process.env.DEEPL_API_KEY;

let translator: deepl.Translator | null = null;

function getTranslator(): deepl.Translator {
    if (!authKey) throw new Error('DEEPL_API_KEY is missing');
    if (!translator) {
        translator = new deepl.Translator(authKey);
        log('DeepL translator initialized.');
    }
    return translator;
}

export async function heToRuDeepl(text: string): Promise<string> {
    const tr = getTranslator();
    const result = await tr.translateText(text, 'he', 'ru', {
        glossary: '2738e371-c08c-4ae3-a917-13e0cb9b85a1'
    });
    return result.text.trim();
}