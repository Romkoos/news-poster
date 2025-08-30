// src/translate.ts
// Назначение: перевод текста с иврита на русский через «пивот» английский.
// Используются две модели @xenova/transformers:
// - m2m100_418M — быстрее, подходит для коротких отрезков.
// - nllb-200-1.3B — качественнее на длинных фрагментах.
//
// Общая стратегия:
// - Для коротких текстов (<= SHORT_LEN_THRESHOLD) делаем he→en→ru через m2m (быстро).
// - Для длинных — режем на предложения, для каждого выбираем модель: m2m для коротких, NLLB для длинных.
// - Если пивот дал пустую строку (редкий случай) — делаем прямой he→ru фолбэк.
// - На выходе прогоняем лёгкий пост‑процессинг терминов (например, замены «ВС Израиля» → «ЦАХАЛ»).
//

import { pipeline } from '@xenova/transformers';

// Модели (совместимы с @xenova/transformers)
const MODEL_SHORT = 'Xenova/m2m100_418M';   // быстрый универсал, норм на коротких
const MODEL_LONG  = 'Xenova/nllb-200-1.3B'; // качественнее на длинных

// Порог/сегментация
const SHORT_LEN_THRESHOLD = 160;  // что короче — гоним через m2m
const SENTENCE_MAX = 220;         // мягкая нарезка длинных кусков

let shortPipePromise: Promise<any> | null = null;
let longPipePromise:  Promise<any> | null = null;

async function getShortPipe() {
    if (!shortPipePromise) shortPipePromise = pipeline('translation', MODEL_SHORT);
    return shortPipePromise;
}
async function getLongPipe() {
    if (!longPipePromise) longPipePromise = pipeline('translation', MODEL_LONG);
    return longPipePromise;
}

function toArray<T>(res: T | T[]): T[] { return Array.isArray(res) ? res : [res]; }

// --- базовые вызовы пайплайнов ---
async function m2m(text: string, src: 'he'|'en', tgt: 'en'|'ru'): Promise<string> {
    const pipe = await getShortPipe();
    const out = await pipe(text, { src_lang: src, tgt_lang: tgt });
    return toArray(out)[0]?.translation_text ?? '';
}

async function nllb(text: string, src: 'heb_Hebr'|'eng_Latn', tgt: 'eng_Latn'|'rus_Cyrl'): Promise<string> {
    const pipe = await getLongPipe();
    const out = await pipe(text, { src_lang: src, tgt_lang: tgt });
    return toArray(out)[0]?.translation_text ?? '';
}

// --- утилиты ---
/**
 * Наивно разбить текст на предложения, а затем мягко нарезать длинные фрагменты по пробелам.
 * Это помогает пускать в перевод разумные по длине куски для сохранения контекста.
 */
function splitIntoSentences(text: string): string[] {
    const naive = text
        .replace(/([\.!?])(\s+)/g, '$1§§§')
        .split('§§§')
        .map(s => s.trim())
        .filter(Boolean);

    const chunks: string[] = [];
    for (const s of (naive.length ? naive : [text])) {
        if (s.length <= SENTENCE_MAX) { chunks.push(s); continue; }
        let buf = s;
        while (buf.length > SENTENCE_MAX) {
            let cut = buf.lastIndexOf(' ', SENTENCE_MAX);
            if (cut < Math.floor(SENTENCE_MAX * 0.6)) cut = SENTENCE_MAX;
            chunks.push(buf.slice(0, cut).trim());
            buf = buf.slice(cut).trim();
        }
        if (buf) chunks.push(buf);
    }
    return chunks;
}

function postprocessRu(s: string): string {
    return s
        .replace(/\bВМФ\b/g, 'ЦАХАЛ')
        .replace(/\bВМС\b/g, 'ЦАХАЛ')
        .replace(/\bИзраильские ВС\b/gi, 'ЦАХАЛ')
        .replace(/\bсектора газа\b/gi, 'сектора Газа')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// --- пивотные переводчики ---

// Короткий кусок: m2m (he->en) → m2m (en->ru)
async function pivotShort(text: string): Promise<string> {
    const en = await m2m(text, 'he', 'en');
    const ru = await m2m(en || text, 'en', 'ru');
    return ru;
}

// Длинный кусок: NLLB (he->en) → NLLB (en->ru)
async function pivotLong(text: string): Promise<string> {
    const en = await nllb(text, 'heb_Hebr', 'eng_Latn');
    const ru = await nllb(en || text, 'eng_Latn', 'rus_Cyrl');
    return ru;
}

// Фолбэк «на всякий случай», если пивот дал пустоту — прямой перевод
async function fallbackDirect(text: string, preferLong: boolean): Promise<string> {
    if (preferLong) return nllb(text, 'heb_Hebr', 'rus_Cyrl');
    return m2m(text, 'he', 'ru');
}

// --- публичный API ---
export async function heToRu(text: string): Promise<string> {
    // короткий текст — одним пивотом без сегментации
    if (text.length <= SHORT_LEN_THRESHOLD) {
        const ru = await pivotShort(text);
        const final = ru || await fallbackDirect(text, false);
        return postprocessRu(final);
    }

    // длинный текст — режем на предложения и пивотим по кускам
    const parts = splitIntoSentences(text);
    const out: string[] = [];
    for (const p of parts) {
        if (!p) continue;
        const preferLong = p.length > SHORT_LEN_THRESHOLD;
        const ru = preferLong ? await pivotLong(p) : await pivotShort(p);
        out.push(ru || await fallbackDirect(p, preferLong));
    }

    // склейка + лёгкая чистка пробелов перед знаками
    return postprocessRu(out.join(' ').replace(/\s+([,.;!?])/g, '$1'));
}
