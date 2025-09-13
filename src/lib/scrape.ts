// src/lib/scrape.ts
// Назначение: чистые функции для работы со страницей — ожидания, клики, выбор нод и извлечение текста.
// Важный принцип: функции не знают о .config и не управляют браузером, только манипулируют переданным Page/Handle.
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
import {log, logDebug} from '../shared/logger';


export async function clickWithPolling(
    page: Page,
    selector: string,
    opts: {
        nth?: number;
        attemptsMax?: number;        // по умолчанию 20
        intervalMs?: number;         // по умолчанию 1000
        totalMs?: number;            // предохранитель (если не задан — attemptsMax*interval*1.5)
        waitAfterClickSelector?: string;
        waitAfterClickMs?: number;
    } = {}
): Promise<boolean> {
    const attemptsMax = opts.attemptsMax ?? 20;
    const intervalMs = opts.intervalMs ?? 1000;
    const totalMs = opts.totalMs ?? Math.ceil(attemptsMax * intervalMs * 1.5);
    const waitAfterClickSelector = opts.waitAfterClickSelector;
    const waitAfterClickMs = opts.waitAfterClickMs ?? 0;
    const nth = opts.nth ?? 0;

    const deadline = Date.now() + totalMs;
    const waitSuccess = async (): Promise<boolean> => {
        try {
            if (waitAfterClickSelector) {
                await page.waitForSelector(waitAfterClickSelector, { timeout: Math.min(2000, Math.max(500, intervalMs)) });
            }
            if (waitAfterClickMs > 0) await page.waitForTimeout(waitAfterClickMs);
            return true;
        } catch {
            return false;
        }
    };

    for (let attempt = 1; attempt <= attemptsMax; attempt++) {
        if (Date.now() >= deadline) break;

        let count = 0;
        try { count = await page.locator(selector).count(); } catch {}
        if (!count) {
            await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
            continue;
        }

        const index = Math.min(Math.max(nth, 0), count - 1);
        const loc: Locator = page.locator(selector).nth(index);

        try {
            await loc.scrollIntoViewIfNeeded();
        } catch {}

        const handle = await loc.elementHandle();
        if (!handle) {
            await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
            continue;
        }

        // 1) dispatchEvent('click')
        try {
            await handle.dispatchEvent('click');
            if (await waitSuccess()) {
                log(`Clicked via dispatchEvent: ${selector} #${index}`);
                return true;
            }
        } catch {}

        // 2) DOM el.click()
        try {
            await page.evaluate((el: unknown) => {
                (el as HTMLElement).click();
            }, handle);

            if (await waitSuccess()) {
                log(`Clicked via evaluate(el.click()): ${selector} #${index}`);
                return true;
            }
        } catch {}

        // 3) мышкой по центру бокса
        try {
            const box = await loc.boundingBox();
            if (box) {
                const cx = Math.floor(box.x + box.width / 2);
                const cy = Math.floor(box.y + box.height / 2);
                await page.mouse.click(cx, cy, { delay: 10 });
                if (await waitSuccess()) {
                    log(`Clicked via mouse.center: ${selector} #${index}`);
                    return true;
                }
            }
        } catch {}

        // следующий тик
        await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
    }

    log(`Click polling timeout: ${selector}`);
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
export async function extractTextFrom(el: ElementHandle<Element>, page: Page): Promise<string> {
    try {
        // если внутри есть кнопка "читать дальше" — жмём и ждём чуть-чуть
        const btn = await el.$('.mc-read-more-btn');
        if (btn) {
            await btn.click().catch(() => {});
            await page.waitForTimeout(50);
        }
    } catch {
        // игнорируем, если кнопки нет или клик не удался
    }

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

