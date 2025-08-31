// src/lib/scrape.ts
// Назначение: чистые функции для работы со страницей — ожидания, клики, выбор нод и извлечение текста.
// Важный принцип: функции не знают о .env и не управляют браузером, только манипулируют переданным Page/Handle.
// Это делает логику тестируемой и переиспользуемой.


/**
 * Клик с поллингом по CSS‑селектору.
 *
 * Алгоритм:
 * 1) До истечения totalMs опрашиваем страницу каждые intervalMs, считая количество найденных элементов.
 * 2) Как только элементы появились — выбираем индексом nth (безопасно ограничиваем диапазон) и пытаемся кликнуть.
 *    Сначала «обычный» click с timeout 2s; если не удалось — пробуем force: true.
 * 3) После успешного клика опционально ждём появления waitAfterClickSelector и/или просто паузу waitAfterClickMs.
 * 4) Если времена ожидания исчерпаны — возвращаем false (внешняя логика решает, что делать дальше).
 *
 * Возвращает true при успешном клике, иначе false.
 * Ошибки внутри попыток клика логируются и не прерывают цикл до дедлайна.
 */

import {Page, Locator, ElementHandle} from 'playwright';
import {log, logDebug} from './logger';

async function isCenterClickable(page: Page, loc: Locator): Promise<boolean> {
    try {
        const box = await loc.boundingBox();
        if (!box) return false;
        const cx = Math.floor(box.x + box.width / 2);
        const cy = Math.floor(box.y + box.height / 2);
        return await page.evaluate(([x, y, el]) => {
            const target = document.elementFromPoint(x as number, y as number);
            return !!target && (target === el || (el as HTMLElement).contains(target));
        }, [cx, cy, await loc.elementHandle()]);
    } catch {
        return false;
    }
}

export async function clickWithPolling(
    page: Page,
    selector: string,
    opts: {
        nth?: number;
        attemptsMax?: number;         // сколько «тиков» (по умолчанию 20)
        intervalMs?: number;          // пауза между тиками (по умолчанию 1000)
        totalMs?: number;             // глобальный предохранитель
        innerRetries?: number;        // быстрых попыток внутри одного тика (по умолчанию 3)
        perClickMs?: number;          // timeout для normal/force клика (по умолчанию 900)
        backoffFailMs?: number;       // пауза между innerRetries (по умолчанию 150)
        waitAfterClickSelector?: string;
        waitAfterClickMs?: number;
    } = {}
): Promise<boolean> {
    const attemptsMax = opts.attemptsMax ?? 20;
    const intervalMs = opts.intervalMs ?? 1000;
    const innerRetries = opts.innerRetries ?? 3;
    const perClickMs = opts.perClickMs ?? 900;
    const backoffFailMs = opts.backoffFailMs ?? 150;
    const waitAfterClickSelector = opts.waitAfterClickSelector;
    const waitAfterClickMs = opts.waitAfterClickMs ?? 0;

    // totalMs — предохранитель: если не задан, ≈ 1.5 * attemptsMax * interval
    const totalMs = opts.totalMs ?? Math.ceil(attemptsMax * intervalMs * 1.5);
    const deadline = Date.now() + totalMs;

    log(
        'Click phase (polling). Selector:',
        selector,
        `totalMs=${totalMs}, intervalMs=${intervalMs}, nth=${opts.nth ?? 0}, attemptsMax=${attemptsMax}`
    );

    for (let attempt = 1; attempt <= attemptsMax; attempt++) {
        if (Date.now() >= deadline) {
            log('Click polling global deadline hit.');
            break;
        }

        // узнаём текущее количество кандидатов
        let count = 0;
        try { count = await page.locator(selector).count(); } catch { count = 0; }
        log(`Click polling attempt #${attempt}/${attemptsMax}. Candidates:`, count);

        if (count > 0) {
            // если их два — попробуем оба; если больше — возьмём первые два
            const tryIndexes = count >= 2 ? [0, 1] : [0];
            // если явно задан nth — поставим его первым
            const nth = opts.nth ?? 0;
            if (tryIndexes.includes(nth)) {
                tryIndexes.splice(tryIndexes.indexOf(nth), 1);
                tryIndexes.unshift(nth);
            }

            for (const idx of tryIndexes) {
                const loc = page.locator(selector).nth(idx);
                // внутри одного тика несколько быстрых попыток

                for (let r = 1; r <= innerRetries; r++) {
                    try {
                        // normal
                        try {
                            await loc.click({ timeout: perClickMs });
                            log('Clicked (normal):', selector, `#${idx}`);
                        } catch (e1) {
                            log('Normal click failed, try force:', e1);
                            // force
                            try {
                                await loc.click({ timeout: perClickMs, force: true });
                                log('Clicked (force):', selector, `#${idx}`);
                            } catch (e2) {
                                // последняя попытка — прямой el.click()
                                const handle = await loc.elementHandle();
                                if (handle) {
                                    await page.evaluate((el: any) => (el as HTMLElement).click(), handle);
                                    log('Clicked via evaluate(el.click()):', selector, `#${idx}`);
                                } else {
                                    log('evaluate fallback skipped: no elementHandle');
                                }
                            }
                        }

                        // проверяем «успех» клика
                        if (waitAfterClickSelector) {
                            log('Wait after click selector:', waitAfterClickSelector);
                            try {
                                await page.waitForSelector(waitAfterClickSelector, { timeout: 3000 });
                            } catch {
                                // условие не наступило — считаем попытку неуспешной и попробуем ещё
                                throw new Error('waitAfterClickSelector timeout');
                            }
                        }
                        if (waitAfterClickMs > 0) {
                            await page.waitForTimeout(waitAfterClickMs);
                        }
                        return true; // клик успешен
                    } catch (err) {
                        log(`Click sub-attempt r=${r}/${innerRetries} on #${idx} failed:`, err);
                        const remain = deadline - Date.now();
                        if (remain <= 0) break;
                        await page.waitForTimeout(Math.min(backoffFailMs, Math.max(50, remain)));
                    }
                }
            }
            // кандидаты были, но все быстрые попытки в этом тике не сработали — ждём следующий тик
        }

        const remain = deadline - Date.now();
        if (remain <= 0) break;
        await page.waitForTimeout(Math.min(intervalMs, Math.max(50, remain)));
    }

    log('Click polling timeout exceeded, button not found.');
    return false;
}


/**
 * Дождаться появления корневого контейнера ленты/карточек.
 * Обёртка вокруг page.waitForSelector с логированием.
 * @param page Страница Playwright
 * @param rootSelector CSS‑селектор корневого контейнера
 * @param timeout Таймаут ожидания (мс)
 */
export async function waitRoot(page: Page, rootSelector: string, timeout: number) {
    logDebug('Wait root:', rootSelector);
    await page.waitForSelector(rootSelector, { timeout });
}

// Селектор до текстового содержимого внутри карточки сообщения.
// Используется как относительный путь от rootSelector при поиске элементов.
const TEXT_PATH = '.mc-extendable-text__content > div > div';

/**
 * Найти и выбрать нужную текстовую ноду в списке сообщений.
 *
 * Поведение выбора:
 * - latestPick === 'first'  → берём items[offsetFromEnd] (режим отладки: «первый с конца» со смещением);
 * - latestPick === 'last'   → берём items[0] (первый в DOM‑порядке).
 * Точное смысловое назначение зависит от структуры ленты, поэтому оставляем простую и явную стратегию.
 * @param page Страница Playwright
 * @param rootSelector CSS‑селектор корневого контейнера ленты
 * @param latestPick Режим выбора ('first' или 'last')
 * @param offsetFromEnd Индекс при выборе 'first' — смещение от конца массива
 * @returns Объект с полями: pick (ElementHandle), items (все найденные), index (какой индекс выбран)
 */
export async function pickTextNode(page: Page, rootSelector: string, latestPick: 'first'|'last', offsetFromEnd: number) {
    const scoped = `${rootSelector} ${TEXT_PATH}`;
    await page.waitForSelector(scoped, { timeout: 15000 });

    const root = await page.$(rootSelector);
    if (!root) throw new Error('Root container not found');

    const items = await root.$$(TEXT_PATH);
    if (!items.length) throw new Error('News list is empty under root');

    // режим отладки: «first» + смещение с конца (OFFSET_FROM_END)
    const pick = latestPick === 'first' ? items[offsetFromEnd] : items[0];
    const index = latestPick === 'first' ? offsetFromEnd : 0;

    return { pick, items, index };
}

/**
 * Извлечь человекочитаемый текст из элемента.
 * Пытаемся взять innerText (если доступен и непустой), иначе fallback на textContent.
 */
export async function extractTextFrom(el: ElementHandle<Element>) {
    const text = await el.evaluate((node) => {
        // @ts-ignore
        const it = (node as any).innerText;
        if (typeof it === 'string' && it.length) return it;
        return node.textContent || '';
    });
    return String(text || '');
}

/**
 * Найти корневой контейнер карточки сообщения относительно выбранной текстовой ноды.
 * Ищем ближайшего предка с классом .mc-message-content_open, иначе возвращаем исходный узел.
 */
export async function findMessageRoot(el: ElementHandle<Element>) {
    return  await el.evaluateHandle((node) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = (node as any).closest?.('.mc-message-content_open');
        return r || node;
    });

}

