// src/lib/media.ts
// Извлечение медиа: картинки и видео.
// Картинка: кликаем по медиа-контейнеру, ждём появление .mc-content-media-item со style="background-image: url(...)",
// достаём URL из style. (Отказались от parseBgUrl.)
// Видео: как было — слушаем сеть + фолбэки по DOM.

import { Page, ElementHandle } from 'playwright';
import {log} from '../shared/logger';

/**
 * КАРТИНКА:
 * 1) Находим внутренний узел медиа в карточке (picture/video зона), поднимаемся к .mc-content-media.
 * 2) Кликаем (нормально или force).
 * 3) Ждём в DOM элемент .mc-content-media-item со style="background-image: url(...)"
 *    (сначала глобально в галерее, потом локально в карточке).
 * 4) Парсим URL из style и (опционально) увеличиваем размер заменой куска строки.
 */
export async function extractImageUrl(
    pageOrRoot: Page | ElementHandle<Element>,
    maybeRoot?: ElementHandle<Element>
): Promise<string | null> {
    const page: Page =
        (pageOrRoot as any).evaluate ? (pageOrRoot as Page) : (maybeRoot as any)._page;
    const messageRoot: ElementHandle<Element> =
        (pageOrRoot as any).evaluate ? (maybeRoot as ElementHandle<Element>) : (pageOrRoot as ElementHandle<Element>);

    // 1) внутренний узел картинки
    const picInner = await (messageRoot as any).$('.mc-content-media-item_picture');
    log('Image inner node found?', !!picInner);
    if (!picInner) return null;

    // 2) контейнер для клика
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

    // 3) ждём элементы со style="background-image"
    const globalSel = '.mc-glr-image-inner[style*="background-image"]'; // в оверлее
    const localSel  = '.mc-content-media-item_picture[style*="background-image"]'; // на карточке

    const pullUrlFromStyle = (style: string | null) => {
        if (!style) return null;
        const m = /url\((['"]?)(.*?)\1\)/.exec(style);
        return m?.[2] ?? null;
    };

    const extractFromSelector = async (scope: Page | ElementHandle<Element>, sel: string): Promise<string | null> => {
        try {
            const handle = await (scope as any).$(sel);
            if (!handle) return null;
            const style = await handle.evaluate(
                (n: Element) => (n as HTMLElement).getAttribute('style') || (n as HTMLElement).style?.cssText || ''
            );
            const url = pullUrlFromStyle(style);
            return url || null;
        } catch { return null; }
    };

    await page.waitForTimeout(150);

    // Сначала пробуем в оверлее
    let usedGlobal = false;
    try { await page.waitForSelector(globalSel, { timeout: 3000 }); } catch {}
    let imgUrl = await extractFromSelector(page, globalSel);
    if (imgUrl) usedGlobal = true;

    // Если нет — пробуем локально
    if (!imgUrl) {
        imgUrl = await extractFromSelector(messageRoot, localSel);
    }

    if (!imgUrl) {
        log('Image URL not found after click.');
        return null;
    }

    log('Image URL extracted:', imgUrl);

    // 4) если открывали оверлей и вытащили URL оттуда — закрываем его
    if (usedGlobal) {
        try {
            await page.click('.mc-glr-btn-close', { timeout: 1500 });
            await page.waitForTimeout(80);
            log('Image overlay closed.');
        } catch (e) {
            log('Failed to close image overlay (non-fatal):', e);
        }
    }

    return imgUrl;
}

/**
 * 1) кликаем по зоне медиа, слушаем сеть на .m3u8/.mp4
 * 2) фолбэк: <video><source src> глобально/локально; затем iframe
 */
// helpers
function isMp4(u: string) { return /\.mp4(\?|#|$)/i.test(u); }
function preferAkamai(u: string) { return /makostorepdl-a\.akamaihd\.net/i.test(u); }

async function waitMp4FromNetwork(page: Page, timeoutMs = 8000): Promise<string | null> {
    const hits: string[] = [];
    const onResp = (resp: any) => {
        try {
            const u = resp.url();
            if (isMp4(u)) hits.push(u);
        } catch {}
    };
    page.on('response', onResp);
    try {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (hits.length) {
                // если есть несколько — отдаём akamai в приоритет
                const akamai = hits.find(preferAkamai);
                return akamai ?? hits[0];
            }
            await page.waitForTimeout(100);
        }
        return null;
    } finally {
        page.off('response', onResp);
    }
}

// основная функция
export async function extractVideoUrl(page: Page, messageRoot: ElementHandle<Element>): Promise<string | null> {
    const vidInner = await (messageRoot as any).$('.mc-content-media-item_video');
    log('Video inner node found?', !!vidInner);
    if (!vidInner) return null;

    const mediaContainer = await (vidInner as any).evaluateHandle((el: Element) => {
        const parent = (el as HTMLElement).closest('.mc-content-media');
        return parent ?? el;
    });

    // прокрутка + клик по тизеру
    try {
        await (mediaContainer as any).evaluate((el: Element) =>
            (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
        );
        await page.waitForTimeout(80);
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

    // короткая пауза на анимацию оверлея
    await page.waitForTimeout(150);

    // 1) основной путь — сеть
    let src = await waitMp4FromNetwork(page, 8000);
    if (!src) {
        // 2) краткий фолбэк по DOM: НЕ требуем видимости
        const sel = '.mc-glr-video-wrap > video > source[src]';
        try {
            // ждём прикрепления контейнера, не "visible"
            await page.waitForSelector('.mc-glr-video-wrap', { state: 'attached', timeout: 1500 }).catch(() => {});
            src = await page.locator(sel).first().getAttribute('src').catch(() => null) ?? null;
        } catch {}
    }

    // по возможности закрываем оверлей, чтобы не мешал следующим постам
    try {
        const closeBtn = page.locator('.mc-glr-btn-close').first();
        if (await closeBtn.count().catch(() => 0)) {
            await closeBtn.click({ timeout: 1000 }).catch(() => {});
        }
    } catch {}

    if (src) {
        log('Video URL (network/DOM):', src);
        return src;
    }

    log('Video URL not found.');
    return null;
}
