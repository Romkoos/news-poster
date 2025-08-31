// src/lib/media.ts
// Извлечение медиа: картинки и видео.
// Картинка: кликаем по медиа-контейнеру, ждём появление .mc-content-media-item со style="background-image: url(...)",
// достаём URL из style. (Отказались от parseBgUrl.)
// Видео: как было — слушаем сеть + фолбэки по DOM.

import { Page, ElementHandle } from 'playwright';
import { log } from './logger';

/** интересуют .m3u8/.mp4 */
function isMediaUrl(url: string) { return /\.(m3u8|mp4)(\?|#|$)/i.test(url); }

/** Перехват .m3u8/.mp4 из сети в течение timeoutMs */
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
 * КАРТИНКА:
 * 1) Находим внутренний узел медиа в карточке (picture/video зона), поднимаемся к .mc-content-media.
 * 2) Кликаем (нормально или force).
 * 3) Ждём в DOM элемент .mc-content-media-item со style="background-image: url(...)"
 *    (сначала глобально в галерее, потом локально в карточке).
 * 4) Парсим URL из style и (опционально) увеличиваем размер заменой куска строки.
 */
export async function extractImageUrl(pageOrRoot: Page | ElementHandle<Element>, maybeRoot?: ElementHandle<Element>): Promise<string | null> {
    const page: Page = (pageOrRoot as any).evaluate ? (pageOrRoot as Page) : (maybeRoot as any)._page;
    const messageRoot: ElementHandle<Element> = (pageOrRoot as any).evaluate ? (maybeRoot as ElementHandle<Element>) : (pageOrRoot as ElementHandle<Element>);

    // 1) ищем «внутренний» узел картинки внутри карточки
    const picInner = await (messageRoot as any).$('.mc-content-media-item_picture, .mc-content-media-item_video');
    log('Image inner node found?', !!picInner);
    if (!picInner) return null;

    // 2) ближайший контейнер .mc-content-media (кликаем по нему)
    const mediaContainer = await (picInner as any).evaluateHandle((el: Element) => {
        const parent = (el as HTMLElement).closest('.mc-content-media');
        return parent ?? el;
    });

    try {
        await (mediaContainer as any).evaluate((el: Element) =>
            (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
        );
        await page.waitForTimeout(60);
    } catch {}

    try {
        try {
            await (mediaContainer as any).click({ timeout: 2500 });
            log('Clicked media container (normal) for image.');
        } catch (e1) {
            log('Normal click failed (image), try force:', e1);
            await (mediaContainer as any).click({ timeout: 2500, force: true });
            log('Clicked media container (force) for image.');
        }
    } catch (e) {
        log('Media container click sequence failed (image):', e);
        return null;
    }

    // 3) ждём появление элемента с background-image
    // сперва глобально (галерея), затем локально в карточке
    const globalSel = '.mc-gallery-container .mc-content-media-item[style*="background-image"]';
    const localSel  = '.mc-content-media-item[style*="background-image"]';

    // helper: вытащить url(...) из style
    const pullUrlFromStyle = (style: string | null) => {
        if (!style) return null;
        const m = /url\((['"]?)(.*?)\1\)/.exec(style);
        return m?.[2] ?? null;
    };

    const extractFromSelector = async (scope: Page | ElementHandle<Element>, sel: string): Promise<string | null> => {
        try {
            const handle = await (scope as any).$(sel);
            if (!handle) return null;
            const style = await handle.evaluate((n: Element) => (n as HTMLElement).getAttribute('style') || (n as HTMLElement).style?.cssText || '');
            const url = pullUrlFromStyle(style);
            return url || null;
        } catch { return null; }
    };

    // подождём немного, чтобы стиль успел появиться
    await page.waitForTimeout(150);

    // Порядок: глобально → локально
    try {
        await page.waitForSelector(globalSel, { timeout: 3000 });
    } catch {}
    let imgUrl = await extractFromSelector(page, globalSel);
    if (!imgUrl) {
        imgUrl = await extractFromSelector(messageRoot, localSel);
    }

    if (!imgUrl) {
        log('Image URL not found after click.');
        return null;
    }

    // 4) простой апскейл: меняем известные размеры на 676X800 (если встречаются)
    imgUrl = imgUrl.replace(/270X320|148X320/g, '676X800');

    log('Image URL extracted:', imgUrl);
    return imgUrl;
}

/**
 * 1) кликаем по зоне медиа, слушаем сеть на .m3u8/.mp4
 * 2) фолбэк: <video><source src> глобально/локально; затем iframe
 */
export async function extractVideoUrl(page: Page, messageRoot: ElementHandle<Element>, _opts?: { visuals?: boolean; screenshots?: boolean }): Promise<string | null> {
    const vidInner = await (messageRoot as any).$('.mc-content-media-item_video');
    log('Video inner node found?', !!vidInner);
    if (!vidInner) return null;

    const mediaContainer = await (vidInner as any).evaluateHandle((el: Element) => {
        const parent = (el as HTMLElement).closest('.mc-content-media');
        return parent ?? el;
    });

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
