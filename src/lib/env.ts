// src/lib/env.ts
// Назначение: чтение и валидация переменных окружения (.env) с формированием удобной структуры AppEnv.
// Этот модуль централизует все настройки приложения: целевой сайт, селекторы, тайминги, 
// а также флаги отладки браузера. Значения читаются из process.env и приводятся к нужным типам.
// Если обязательная переменная отсутствует — бросаем понятную ошибку с подсказками.

/**
 * Прочитать переменную окружения по имени с опциональной обязательностью.
 * Если required=true и значение отсутствует — бросается ошибка с подсказкой.
 * @param name Имя переменной окружения
 * @param required Обязательность (по умолчанию true)
 * @returns Строковое значение или пустая строка
 */

import dotenvFlow from 'dotenv-flow';

dotenvFlow.config(); // сам выберет .env, .env.local и т.д.

export function env(name: string, required = true): string {
    const v = process.env[name];
    if (required && !v) throw new Error(`Missing env: ${name}`);
    return v || '';
}


/**
 * Схема конфигурации приложения, собранная из .env.
 * Все строковые значения приводятся к нужным типам, где это уместно.
 * Флаги DEBUG_* позволяют тонко управлять поведением браузера и артефактами.
 */
export type AppEnv = {
    TRY_MOBILE: boolean;
    MOBILE_TARGET_URL: string;
    WEB_TARGET_URL: string;
    LIST_ITEM_SELECTOR: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;

    DEEPL_API_KEY: string;

    LATEST_PICK: 'first' | 'last';
    OFFSET_FROM_END: number;
    ROOT_SELECTOR: string;
    WAIT_FOR: number

    CLICK_SELECTOR?: string;
    CLICK_INDEX: number;                 // по какому из .mc-drawer__btn кликать
    CLICK_POLL_SECONDS: number;          // сколько секунд опрашивать кнопку
    CLICK_POLL_INTERVAL_MS: number;      // шаг опроса (мс)
    WAIT_AFTER_CLICK_MS: number;


    CHECK_LAST_N: number;                // ограничение количества проверяемых последних новостей

    // Master switch to enable/disable all browser debugging related features
    DEBUG_BROWSER: boolean;

    // Fine-grained controls (applied only when DEBUG_BROWSER === true)
    DEBUG_HEADFUL: boolean;
    DEBUG_DEVTOOLS: boolean;
    DEBUG_RECORD_VIDEO: boolean;
    DEBUG_TRACE: boolean;
    DEBUG_SCREENSHOTS: boolean;
    DEBUG_VISUALS: boolean; // overlays/highlights/bboxes
};

/**
 * Собрать конфигурацию приложения из переменных окружения .env.
 * Необязательные значения имеют дефолты, булевы флаги читаются как '1' → true.
 */
export function readAppEnv(): AppEnv {
    return {
        TRY_MOBILE: (env('TRY_MOBILE', false) === '1'),
        MOBILE_TARGET_URL: env('MOBILE_TARGET_URL'),
        WEB_TARGET_URL: env('WEB_TARGET_URL'),
        LIST_ITEM_SELECTOR: env('LIST_ITEM_SELECTOR'),
        TELEGRAM_BOT_TOKEN: env('TELEGRAM_BOT_TOKEN'),
        TELEGRAM_CHAT_ID: env('TELEGRAM_CHAT_ID'),

        DEEPL_API_KEY: env('DEEPL_API_KEY'),

        LATEST_PICK: ((env('LATEST_PICK', false) || 'first').toLowerCase() as 'first' | 'last'),
        OFFSET_FROM_END: Number(env('OFFSET_FROM_END', false) || '1'),
        ROOT_SELECTOR: (env('ROOT_SELECTOR', false) || '.mc-feed_open').trim(),
        WAIT_FOR: Number(env('WAIT_FOR_LIST_TIMEOUT_MS', false) || '15000'),

        CLICK_SELECTOR: env('CLICK_SELECTOR', false) || undefined,
        CLICK_INDEX: Number(env('CLICK_INDEX', false) || '0'),
        CLICK_POLL_SECONDS: Number(env('CLICK_POLL_SECONDS', false) || '10'),
        CLICK_POLL_INTERVAL_MS: Number(env('CLICK_POLL_INTERVAL_MS', false) || '1000'),
        WAIT_AFTER_CLICK_MS: Number(env('WAIT_AFTER_CLICK_MS', false) || '0'),



        CHECK_LAST_N: Math.max(1, Number(env('CHECK_LAST_N', false) || '5')),

        DEBUG_BROWSER: (env('DEBUG_BROWSER', false) === '1'),
        DEBUG_HEADFUL: (env('DEBUG_HEADFUL', false) === '1'),
        DEBUG_DEVTOOLS: (env('DEBUG_DEVTOOLS', false) === '1'),
        DEBUG_RECORD_VIDEO: (env('DEBUG_RECORD_VIDEO', false) === '1'),
        DEBUG_TRACE: (env('DEBUG_TRACE', false) === '1'),
        DEBUG_SCREENSHOTS: (env('DEBUG_SCREENSHOTS', false) === '1'),
        DEBUG_VISUALS: (env('DEBUG_VISUALS', false) === '1'),
    };
}
