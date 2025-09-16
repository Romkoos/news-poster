// src/lib/config.ts
// Назначение: чтение и валидация переменных окружения (.config) с формированием удобной структуры AppEnv.
// Этот модуль централизует все настройки приложения: целевой сайт, селекторы, тайминги, 
// а также флаги отладки браузера. Значения читаются из process.config и приводятся к нужным типам.
// Если обязательная переменная отсутствует — бросаем понятную ошибку с подсказками.

/**
 * Прочитать переменную окружения по имени с опциональной обязательностью.
 * Если required=true и значение отсутствует — бросается ошибка с подсказкой.
 * @param name Имя переменной окружения
 * @param required Обязательность (по умолчанию true)
 * @returns Строковое значение или пустая строка
 */

import dotenvFlow from 'dotenv-flow';

dotenvFlow.config(); // сам выберет .config, .config.local и т.д.

export function config(name: string, required = true): string {
    const v = process.env[name];
    if (required && !v) throw new Error(`Missing env: ${name}`);
    return v || '';
}


/**
 * Схема конфигурации приложения, собранная из .config.
 * Все строковые значения приводятся к нужным типам, где это уместно.
 * Флаги DEBUG_* позволяют тонко управлять поведением браузера и артефактами.
 */
export type AppConfig = {
    MOBILE_TARGET_URL: string;
    WEB_TARGET_URL: string;
    LIST_ITEM_SELECTOR: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    DEEPL_API_KEY: string;
    USE_DEEPL: boolean;
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

    DEBUG_BROWSER: boolean;

    DEBUG_HEADFUL: boolean;
    DEBUG_DEVTOOLS: boolean;
    DEBUG_RECORD_VIDEO: boolean;
    DEBUG_TRACE: boolean;
    DEBUG_SCREENSHOTS: boolean;
    DEBUG_VISUALS: boolean; // overlays/highlights/bboxes
};

/**
 * Собрать конфигурацию приложения из переменных окружения .config.
 * Необязательные значения имеют дефолты, булевы флаги читаются как '1' → true.
 */
export function readAppEnv(): AppConfig {
    return {
        MOBILE_TARGET_URL: config('MOBILE_TARGET_URL'),
        WEB_TARGET_URL: config('WEB_TARGET_URL'),
        LIST_ITEM_SELECTOR: config('LIST_ITEM_SELECTOR'),
        TELEGRAM_BOT_TOKEN: config('TELEGRAM_BOT_TOKEN'),
        TELEGRAM_CHAT_ID: config('TELEGRAM_CHAT_ID'),
        DEEPL_API_KEY: config('DEEPL_API_KEY'),
        USE_DEEPL: (config('USE_DEEPL', false) === '1'),
        LATEST_PICK: ((config('LATEST_PICK', false) || 'first').toLowerCase() as 'first' | 'last'),
        OFFSET_FROM_END: Number(config('OFFSET_FROM_END', false) || '1'),
        ROOT_SELECTOR: (config('ROOT_SELECTOR', false) || '.mc-feed_open').trim(),
        WAIT_FOR: Number(config('WAIT_FOR_LIST_TIMEOUT_MS', false) || '15000'),
        CLICK_SELECTOR: config('CLICK_SELECTOR', false) || undefined,
        CLICK_INDEX: Number(config('CLICK_INDEX', false) || '0'),
        CLICK_POLL_SECONDS: Number(config('CLICK_POLL_SECONDS', false) || '10'),
        CLICK_POLL_INTERVAL_MS: Number(config('CLICK_POLL_INTERVAL_MS', false) || '1000'),
        WAIT_AFTER_CLICK_MS: Number(config('WAIT_AFTER_CLICK_MS', false) || '0'),
        CHECK_LAST_N: Math.max(1, Number(config('CHECK_LAST_N', false) || '5')),
        DEBUG_BROWSER: (config('DEBUG_BROWSER', false) === '1'),
        DEBUG_HEADFUL: (config('DEBUG_HEADFUL', false) === '1'),
        DEBUG_DEVTOOLS: (config('DEBUG_DEVTOOLS', false) === '1'),
        DEBUG_RECORD_VIDEO: (config('DEBUG_RECORD_VIDEO', false) === '1'),
        DEBUG_TRACE: (config('DEBUG_TRACE', false) === '1'),
        DEBUG_SCREENSHOTS: (config('DEBUG_SCREENSHOTS', false) === '1'),
        DEBUG_VISUALS: (config('DEBUG_VISUALS', false) === '1'),
    };
}
