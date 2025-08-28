import * as deepl from 'deepl-node';
import {readAppEnv} from "../lib/env";

const env = readAppEnv();

const authKey = env.DEEPL_API_KEY;
const deeplClient = new deepl.Translator(authKey);

(async () => {
    const targetLang: deepl.TargetLanguageCode = 'ru';
    const results = await deeplClient.translateText(
        ['Hello, world!', 'How are you?'],
        null,
        targetLang,
    );
    results.map((result: deepl.TextResult) => {
        console.log(result.text);
    });
})();