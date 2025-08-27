// src/lib/hash.ts
// Назначение: компактные хеш‑утилиты.
// Здесь реализован SHA‑1 для дедупликации контента (сравнение предыдущей публикации и новой).

import * as crypto from 'crypto';

/**
 * Вычислить SHA‑1 хеш строки в шестнадцатеричном виде.
 * Используется для сравнения «был ли уже такой текст опубликован».
 */
export function sha1(text: string) {
    return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}
