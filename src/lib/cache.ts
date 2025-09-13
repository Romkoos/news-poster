// src/lib/cache.ts
// Назначение: маленький JSON-кеш на диске, чтобы избегать повторных публикаций.
// Мы сохраняем последний хеш опубликованного текста и при следующем запуске
// сравниваем его, чтобы понять — есть ли новый материал.

import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from '../shared/logger';

/**
 * Структура кеша приложения.
 * lastHash — SHA‑1 хеш последнего успешно опубликованного текста.
 */
export type Cache = { lastHash?: string };

// Путь к файлу кеша (в корне проекта). Лёгкая альтернатива БД.
const cachePath = path.resolve('.cache.json');

/**
 * Прочитать кеш из файла.
 * Если файл отсутствует или битый, вернём пустой объект.
 */
export async function readCache(): Promise<Cache> {
    try {
        const raw = await fs.readFile(cachePath, 'utf-8');
        return JSON.parse(raw);

    } catch {

        return {};
    }
}

/**
 * Записать кеш в файл в человекочитаемом формате (отступ 2 пробела).
 */
export async function writeCache(c: Cache) {
    await fs.writeFile(cachePath, JSON.stringify(c, null, 2), 'utf-8');
    log('Cache written:', c);
}
