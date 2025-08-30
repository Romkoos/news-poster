// src/lib/media.ts
// Назначение: извлечение медиа (картинок и видео) из карточки сообщения.
// Модуль знает, как определить URL картинки из background-image и как «поймать»
// адрес видео (через сетевые события или по DOM‑селектору как фолбэк).
//
// Подход:
// - Сначала пытаемся услышать реальные сетевые ответы .m3u8/.mp4 после клика по зоне медиа.
// - Если не получилось — пробуем достать <source src> глобально/локально.
// - Для отладки предусмотрены визуальные рамки и скриншоты (см. src/lib/debug.ts),
//   включаются через .env флаги (см. src/lib/env.ts) и передаются параметрами.
import { Page, ElementHandle } from 'playwright';
import { log } from './logger';

/**
 * Вытащить URL из CSS background-image формата url("...") или url('...') или url(...).
 * @param bg Строка background-image или null/none
 * @returns Чистый URL или null, если не найдено
 */
function parseBgUrl(bg: string | null | undefined) : string | null {
    if (!bg || bg === 'none') return null;
    const m = /url\((['"]?)(.*?)\1\)/.exec(bg);
    return m?.[2].replace(/270X320/, '676X800') || null;
}

/**
 * Попытаться извлечь URL изображения из карточки сообщения.
 * Ищем элемент с классом .mc-content-media-item_picture и берём его CSS background-image.
 * @param messageRoot Хэндл корневого элемента карточки сообщения
 * @returns Строковый URL картинки или null, если картинка не обнаружена
 */
export async function extractImageUrl(messageRoot: ElementHandle<Element>) : Promise<string | null> {
    const imgProbe = await (messageRoot as any).$('.mc-content-media-item_picture');
    log('Image element found?', !!imgProbe);
    if (!imgProbe) return null;

    try {
        const bg = await imgProbe.evaluate((node) => {
            const el = node as HTMLElement;
            const inline = el.style?.backgroundImage;
            const computed = getComputedStyle(el).backgroundImage;
            return inline && inline !== 'none' ? inline : computed;
        });
        return parseBgUrl(bg);
    } catch (e) {
        log('Image parse error:', e);
        return null;
    }
}

/** перехват .m3u8/.mp4 после клика */
// Утилита для фильтрации ответов сети: интересуют .m3u8/.mp4
function isMediaUrl(url: string) { return /\.(m3u8|mp4)(\?|#|$)/i.test(url); }
/**
 * Подождать появления в сети ответа с URL на медиа (.m3u8/.mp4) после пользовательского действия.
 * Реализовано через подписку на событие 'response' и активное ожидание до timeoutMs.
 * @param page Активная страница Playwright
 * @param timeoutMs Максимальное ожидание в миллисекундах (по умолчанию 12 секунд)
 * @returns Найденный URL или null, если в отведённое время ничего не пришло
 */
export async function waitMediaFromNetwork(page: Page, timeoutMs = 12000) {
    const matches: string[] = [];
    const onResponse = (resp: any) => {
        try {
            const url = resp.url();
            if (isMediaUrl(url)) matches.push(url);
        } catch {}
    };
    page.on('response', onResponse);
    try {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (matches.length) return matches[0];
            await page.waitForTimeout(150);
        }
        return null;
    } finally {
        page.off('response', onResponse);
    }
}

/**
 * Попытаться извлечь URL видео из карточки сообщения.
 * Стратегия:
 * 1) Кликаем по контейнеру медиа и слушаем сеть на предмет .m3u8/.mp4 (реальный поток/файл).
 * 2) Если сеть молчит — пробуем достать <source src> из глобального модального контейнера.
 * 3) Если не вышло — ищем локально внутри карточки и, в крайнем случае, в iframe.
 * Для отладки можно включить визуальные рамки и промежуточные скриншоты.
 * @param page Текущая страница
 * @param messageRoot Корневой элемент карточки сообщения
 * @param opts Опции отладки: visuals (рисовать рамки), screenshots (делать скрины)
 * @returns Строковый URL видео или null, если ничего не найдено
 */
export async function extractVideoUrl(page: Page, messageRoot: ElementHandle<Element>, opts?: { visuals?: boolean; screenshots?: boolean }) : Promise<string | null> {
    //TODO: simplify this function
    const vidInner = await (messageRoot as any).$('.mc-content-media-item_video');
    log('Video inner node found?', !!vidInner);
    if (!vidInner) return null;

    const mediaContainer = await (vidInner as any).evaluateHandle((el: Element) => {
        const parent = (el as HTMLElement).closest('.mc-content-media');
        return parent ?? el;
    });

    try {
        const desc = await (mediaContainer as any).evaluate((node: Element) => {
            const el = node as HTMLElement;
            return `<${el.tagName.toLowerCase()} class="${el.className}">`;
        });
    } catch {}


    try {
        await (mediaContainer as any).evaluate((el: Element) =>
            (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
        );
        await page.waitForTimeout(60);
    } catch {}

    const netWait = waitMediaFromNetwork(page, 12000);

    try {
        try {
            await (mediaContainer as any).click({ timeout: 2500 });
            log('Clicked media container (normal).');
        } catch (e1) {
            log('Normal click failed, try force:', e1);
            await (mediaContainer as any).click({ timeout: 2500, force: true });
            log('Clicked media container (force).');
        }
    } catch (e) {
        log('Media container click sequence failed:', e);
        return null;
    }

    const netUrl = await netWait;
    if (netUrl) {
        log('Media URL from network:', netUrl);
        return netUrl;
    }

    // Fallback 1: глобальный контейнер
    try {
        const waitSelector = '.mc-gallery-container .mc-glr-video-wrap video source[src]';
        log('Wait for video source:', waitSelector);
        await page.waitForSelector(waitSelector, { timeout: 6000 });
        const src = await page.$eval(waitSelector, (n) =>
            (n as HTMLSourceElement).src || (n as HTMLSourceElement).getAttribute('src') || ''
        );
        if (src) {
            log('Video src extracted (global):', src);
            return src;
        }
    } catch (e) {
        log('Global video src wait/extract failed:', e);
    }

    // Fallback 2: локально в карточке
    try {
        const localSel = '.mc-glr-video-wrap video source[src]';
        log('Try local video selector inside message root:', localSel);
        const local = await (messageRoot as any).$(localSel);
        if (local) {
            const src = await local.evaluate((n: Element) =>
                (n as HTMLSourceElement).getAttribute('src') || (n as HTMLSourceElement).src || ''
            );
            if (src) {
                log('Local video src extracted:', src);
                return src;
            }
        }
    } catch (e2) {
        log('Local video extract failed:', e2);
    }

    // Fallback 3: iframe
    try {
        const iframe = await page.$('.mc-gallery-container iframe[src], .mc-glr-video-wrap iframe[src]');
        if (iframe) {
            const ifSrc = await iframe.getAttribute('src');
            if (ifSrc && isMediaUrl(ifSrc)) {
                log('Iframe src is media:', ifSrc);
                return ifSrc;
            }
            log('Iframe found (non-media src):', ifSrc);
        }
    } catch {}

    return null;
}
