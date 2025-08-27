// src/lib/fsutil.ts
// Назначение: небольшие утилиты работы с файловой системой.
// В данном модуле — функция ensureDirs, которая гарантирует существование каталогов.

import * as fs from 'fs/promises';

/**
 * Убедиться, что перечисленные директории существуют.
 * Аналог mkdir -p: создаёт каталог и все недостающие родительские.
 * Ошибки существования игнорируются — удобно для сценариев отладки.
 */
export async function ensureDirs(paths: string[]) {
  await Promise.all(paths.map(async (p) => {
    try { await fs.mkdir(p, { recursive: true }); } catch {}
  }));
}
