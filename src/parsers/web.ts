// src/parsers/web.ts
import {log, logWarn} from '../shared/logger';
import { stopAndFlush } from '../lib/browser_web';
import { clickWithPolling, waitRoot, pickTextNode, extractTextFrom, findMessageRoot } from '../lib/scrape';
import { extractImageUrl, extractVideoUrl } from '../lib/media';
import { readCache, writeCache } from '../lib/cache';
import { sha1 } from '../lib/hash';
import { heToRu } from '../translate';
import { sendPlain, sendPhoto, sendVideo } from '../telegram';
import { bootAndOpenWeb } from '../lib/browser_web';

// DB
import { initDb } from '../api/news/db';
import {ElementHandle} from "playwright";

// Authors/sources to exclude by header name inside .mc-message-header__name
// Extend this list as needed.
const EXCLUDED_AUTHORS = ["מבזקן 12", "דסק החוץ"];

// Keywords to exclude if found within the text content (original Hebrew text)
// Extend this list as needed.
const EXCLUDED_KEYWORDS = [
    "חטופים",
    "החטופים",
    "החטופה",
    "חטופה",
    "החטוף",
    "חטוף",
    "השבי",
    "מהשבי",
];

export async function runWeb(config: ReturnType<typeof import('../shared/config').readAppEnv>) {
    const db = initDb();

    const { ctx, page } = await bootAndOpenWeb(config.WEB_TARGET_URL, {
        headful: config.DEBUG_HEADFUL,
        devtools: config.DEBUG_DEVTOOLS,
    });

    try {
        if (config.CLICK_SELECTOR) {
            const clicked = await clickWithPolling(page, config.CLICK_SELECTOR, {
                nth: config.CLICK_INDEX,
                totalMs: config.CLICK_POLL_SECONDS * 1000,
                intervalMs: config.CLICK_POLL_INTERVAL_MS,
                waitAfterClickSelector: config.ROOT_SELECTOR,
                waitAfterClickMs: config.WAIT_AFTER_CLICK_MS,
            });
            if (!clicked) throw new Error('WEB: Click target not found within time budget.');
        }

        await waitRoot(page, config.ROOT_SELECTOR, config.WAIT_FOR);

        // Берём текстовые ноды внутри ленты (items[0] — самый свежий)
        const { items } = await pickTextNode(page, config.ROOT_SELECTOR, 'first', 0);
        const scanCount = Math.min(config.CHECK_LAST_N, items.length);
        log(`(WEB) Scan last N: ${scanCount} (from total ${items.length})`);

        // lastHash через БД (fallback — файл)
        let lastHash: string | null;
        try {
            lastHash = db.getLastHash();
        } catch (e) {
            logWarn('(WEB) DB getLastHash failed, fallback to file cache:', e);
            const cache = await readCache().catch(() => ({ lastHash: null as string | null }));
            lastHash = cache?.lastHash ?? null;
            log('(WEB) lastHash from file cache:', lastHash ?? '<none>');
        }

        type QueueItem = { index: number; handle: any; textHe: string; hash: string };
        const toProcess: QueueItem[] = [];

        for (let i = 0; i < scanCount; i++) {
            const handle = items[i];
            const textHe = await extractTextFrom(handle, page);
            const hash = sha1(textHe);

            if (lastHash && hash === lastHash) {
                log(`(WEB) Hit cache boundary at index ${i}; stopping collection.`);
                break;
            }
            toProcess.push({ index: i, handle, textHe, hash });
        }

        if (toProcess.length === 0) {
            log('(WEB) No new items. Nothing to post.');
            return;
        }

        // --- НОВОЕ: готовим данные для скролла по высотам карточек .mc-reporter ---
        type EnrichedItem = QueueItem & { reporter: ElementHandle<Element> | null; height: number };
        const enriched: EnrichedItem[] = [];
        for (const q of toProcess) {
            // ближайшая карточка
            const reporter = await q.handle.evaluateHandle((node) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (node as any).closest?.('.mc-reporter') || null;
            }) as ElementHandle<Element> | null;

            // высота карточки (с запасом по умолчанию)
            let height = 0;
            try {
                height = reporter
                    ? await reporter.evaluate((n) => Math.ceil((n as HTMLElement).getBoundingClientRect().height || 0))
                    : 0;
            } catch { /* ignore */ }
            if (!height || height < 40) height = 400; // дефолтная «разумная» высота

            enriched.push({ ...q, reporter, height });
        }

        // Обрабатывать будем от «самой старой» к «самой новой»
        const oldestFirst = enriched.slice().reverse(); // теперь [0] — «самая старая»

        // --- УМНЫЙ АПСКРОЛЛ ---
        // считаем суммарную высоту CHECK_LAST_N карточек и сравниваем с высотой вьюпорта
        const poolHeight = oldestFirst.reduce((acc, it) => acc + it.height, 0);
        const viewportH = await page.evaluate(() => window.innerHeight || 0);
        // на всякий случай небольшой запас, чтобы верхняя карточка точно оказалась полностью в зоне клика
        const SAFETY = 80;

        // крутить вверх нужно только если пул не помещается целиком
        const scrollUp = Math.max(0, Math.ceil(poolHeight - viewportH + SAFETY));

        if (scrollUp > 0) {
            await page.mouse.wheel(0, -scrollUp);
            await page.waitForTimeout(150);
        }


        let lastPostedHash: string | null = null;

        for (let i = 0; i < oldestFirst.length; i++) {
            const q = oldestFirst[i];
            log(`(WEB) [${i + 1}/${oldestFirst.length}] index=${q.index}`);

            // Первичная фильтрация по источнику/имени автора в .mc-message-header__name
            try {
                const headerName = await q.handle.evaluate((node) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const msg = (node as any).closest?.('.mc-message');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const nameEl = msg ? (msg.querySelector('.mc-message-header__name') as any) : null;
                    const raw = nameEl ? (nameEl.innerText || nameEl.textContent || '') : '';
                    return String(raw || '').trim();
                });
                if (EXCLUDED_AUTHORS.includes(headerName)) {
                    log(`(WEB) Skipping by excluded author: "${headerName}" (index=${q.index})`);
                    if (q.height > 0) {
                        await page.mouse.wheel(0, q.height);
                        await page.waitForTimeout(100);
                    }
                    continue;
                }
            } catch {}

            // Фильтрация по ключевым словам в тексте (исходный he)
            try {
                const kw = EXCLUDED_KEYWORDS.find((k) => k && q.textHe && q.textHe.includes(k));
                if (kw) {
                    log(`(WEB) Skipping by excluded keyword: "${kw}" (index=${q.index})`);
                    if (q.height > 0) {
                        await page.mouse.wheel(0, q.height);
                        await page.waitForTimeout(100);
                    }
                    continue;
                }
            } catch {}

            // Дубликаты до перевода (по исходному he-тексту)
            try {
                if (db.hasNewsHash(q.hash)) {
                    log(`(WEB) Stop publishing by DB duplicate hash: ${q.hash} (index=${q.index})`);
                    // даже если дубликат — всё равно прокручиваем вниз на его высоту,
                    // чтобы не сбить дальнейшую геометрию
                    if (q.height > 0) {
                        await page.mouse.wheel(0, q.height);
                        await page.waitForTimeout(100);
                    }
                    continue;
                }
            } catch (e) {
                log('(WEB) DB hasNewsHash failed (continue anyway):', e);
            }

            try {
                // Достаём медиа (клик по карточке уже не нужен — мы на ней «стоим» по высоте)
                const messageRoot = await findMessageRoot(q.handle);
                const [imgUrl, videoUrlCandidate] = await Promise.all([
                    extractImageUrl(page, messageRoot),
                    extractVideoUrl(page, messageRoot),
                ]);

                // Перевод → публикация
                const t0 = Date.now();
                const textRu = await heToRu(q.textHe, config);
                log(`(WEB) Translation ms:`, Date.now() - t0);

                const videoUrl =
                    videoUrlCandidate && /\.m3u8(\?|#|$)/i.test(videoUrlCandidate) ? null : videoUrlCandidate;

                if (videoUrl) {
                    await sendVideo(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, videoUrl, textRu);
                } else if (imgUrl) {
                    await sendPhoto(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, imgUrl, textRu);
                } else {
                    await sendPlain(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, textRu);
                }

                // В БД сохраняем ТОЛЬКО переведённый текст (ru)
                try {
                    db.addNews(textRu, q.hash, Date.now());
                } catch (e) {
                    log('(WEB) db.addNews failed:', e);
                }

                lastPostedHash = q.hash;
            } catch (e) {
                log(`(WEB) Item failed, continue:`, e);
            } finally {
                // Прокрутка ВНИЗ на высоту только что обработанной карточки
                if (q.height > 0) {
                    await page.mouse.wheel(0, q.height);
                    await page.waitForTimeout(100);
                }
            }
        }

        if (lastPostedHash) {
            try {
                db.setLastHash(lastPostedHash);
                log('(WEB) DB lastHash updated:', lastPostedHash);
            } catch (e) {
                log('(WEB) DB setLastHash failed, fallback to file cache:', e);
                await writeCache({ lastHash: lastPostedHash });
                log('(WEB) Cache updated (file):', lastPostedHash);
            }
        } else {
            log('(WEB) Nothing posted — cache not updated.');
        }
    } finally {
        await stopAndFlush(ctx);
    }
}

