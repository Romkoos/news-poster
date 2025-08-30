// src/lib/scrape.ts
// Назначение: чистые функции для работы со страницей — ожидания, клики, выбор нод и извлечение текста.
// Важный принцип: функции не знают о .env и не управляют браузером, только манипулируют переданным Page/Handle.
// Это делает логику тестируемой и переиспользуемой.
import { Page, ElementHandle } from 'playwright';
import { log } from './logger';


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

// Надёжный клик с поллингом фиксированного числа попыток.
// Гарантирует до ceil(totalMs / intervalMs) итераций, не «съедает» бюджет.
// Счёт элементов — через querySelectorAll с пер-итерационным таймаутом.

export async function clickWithPolling(
    page: Page,
    selector: string,
    opts: {
        nth?: number;
        totalMs?: number;               // общее время ожидания (по умолчанию 10_000)
        intervalMs?: number;            // шаг опроса (по умолчанию 1_000)
        waitAfterClickSelector?: string;
        waitAfterClickMs?: number;
    } = {}
): Promise<boolean> {
    const nth = opts.nth ?? 0;
    const totalMs = opts.totalMs ?? 10_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const waitAfterClickSelector = opts.waitAfterClickSelector;
    const waitAfterClickMs = opts.waitAfterClickMs ?? 0;

    const attemptsMax = Math.max(1, Math.ceil(totalMs / intervalMs));
    // таймаут на определение count в каждой итерации
    const COUNT_CAP_MS = Math.min(2000, intervalMs);

    log(
        'Click phase (polling). Selector:',
        selector,
        `totalMs=${totalMs}, intervalMs=${intervalMs}, nth=${nth}, attemptsMax=${attemptsMax}`
    );

    for (let attempt = 1; attempt <= attemptsMax; attempt++) {
        // 1) считаем количество кандидатов с жёстким капом по времени
        const count = await countWithCap(page, selector, COUNT_CAP_MS).catch(() => 0);
        log(`Click polling attempt #${attempt}/${attemptsMax}. Candidates:`, count);

        if (count > 0) {
            const index = Math.min(Math.max(nth, 0), count - 1);
            const loc = page.locator(selector).nth(index);

            try {
                await loc.scrollIntoViewIfNeeded();
                try {
                    await loc.click({ timeout: 1500 });
                    log('Clicked (normal):', selector, `#${index}`);
                } catch (e1) {
                    log('Normal click failed, try force:', e1);
                    await loc.click({ timeout: 1500, force: true });
                    log('Clicked (force):', selector, `#${index}`);
                }

                if (waitAfterClickSelector) {
                    log('Wait after click selector:', waitAfterClickSelector);
                    await page.waitForSelector(waitAfterClickSelector, { timeout: 5000 });
                }
                if (waitAfterClickMs > 0) {
                    log('Post-click wait ms:', waitAfterClickMs);
                    await page.waitForTimeout(waitAfterClickMs);
                }
                return true;
            } catch (e) {
                log('Click failed on attempt:', attempt, e);
                // пойдём на следующую попытку после паузы
            }
        }

        // 2) если это не последняя попытка — выдерживаем интервал
        if (attempt < attemptsMax) {
            await page.waitForTimeout(intervalMs);
        }
    }

    log('Click polling timeout exceeded, button not found.');
    return false;
}

// Вспомогательная: безопасно получить count за не более чем capMs.
// Используем querySelectorAll в page.evaluate, чтобы не блокироваться на locator.count().
async function countWithCap(page: Page, selector: string, capMs: number): Promise<number> {
    return await Promise.race<number>([
        page.evaluate((sel) => document.querySelectorAll(sel).length, selector),
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error('count timeout')), capMs)),
    ]).catch(() => 0);
}


/**
 * Дождаться появления корневого контейнера ленты/карточек.
 * Обёртка вокруг page.waitForSelector с логированием.
 * @param page Страница Playwright
 * @param rootSelector CSS‑селектор корневого контейнера
 * @param timeout Таймаут ожидания (мс)
 */
export async function waitRoot(page: Page, rootSelector: string, timeout: number) {
    log('Wait root:', rootSelector);
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

