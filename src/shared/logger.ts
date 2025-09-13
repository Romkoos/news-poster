// src/lib/logger.ts
// Назначение: простейший модуль логирования с меткой времени.
// Используется по всему приложению для единообразного вывода событий в консоль.
//
// Дизайн решения:
// - ts(): генерирует человекочитаемую метку времени (UTC) вида "YYYY-MM-DD hh:mm:ss.mmm".
// - log(...args): обёртка над console.log, автоматически добавляет метку времени.
//
// В случае переноса логов в файлы/агрегатор можно заменить реализацию log(), 
// сохранив тот же интерфейс во всех модулях.

/**
 * Вернуть текущую метку времени в формате ISO без букв T/Z (удобнее читать в логах).
 */
export function ts() {
    return '';
    // const d = new Date();
    // return d.toISOString().replace('T', ' ').replace('Z', '');
}


const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
};

export function logInfo(...args: any[]) {
    console.log(colors.green + ts(), '-', ...args, colors.reset);
}

export function logWarn(...args: any[]) {
    console.log(colors.yellow + ts(), '-', ...args, colors.reset);
}

export function logError(...args: any[]) {
    console.log(colors.red + ts(), '-', ...args, colors.reset);
}

export function logDebug(...args: any[]) {
    console.log(colors.cyan + ts(), '-', ...args, colors.reset);
}

// Универсальный "старый" лог, если не хочется менять везде
export function log(...args: any[]) {
    console.log(ts(), '-', ...args);
}