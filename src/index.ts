// src/index.ts
import './ort-silence';
import { readAppEnv } from './lib/env';
import { log } from './lib/logger';
import { readCache, writeCache } from './lib/cache';
import { sha1 } from './lib/hash';
import { clickWithPolling, waitRoot, pickTextNode, extractTextFrom, findMessageRoot } from './lib/scrape';
import { bootAndOpen, stopAndFlush } from './lib/browser';
import { debugScreenshot } from './lib/debug';
import { extractImageUrl, extractVideoUrl } from './lib/media';
import { heToRu } from './translate';
import { sendPlain, sendPhoto, sendVideo } from './telegram';

type QueueItem = {
    index: number;
    handle: any;      // ElementHandle<Element>
    textHe: string;
    hash: string;
};

async function main() {
    const env = readAppEnv();
    log('Boot with env:', {
        TARGET_URL: env.TARGET_URL,
        ROOT_SELECTOR: env.ROOT_SELECTOR,
        LIST_ITEM_SELECTOR: env.LIST_ITEM_SELECTOR,
        CLICK_SELECTOR: env.CLICK_SELECTOR,
        CLICK_INDEX: env.CLICK_INDEX,
        CLICK_POLL_SECONDS: env.CLICK_POLL_SECONDS,
        CLICK_POLL_INTERVAL_MS: env.CLICK_POLL_INTERVAL_MS,
        WAIT_FOR: env.WAIT_FOR,
        WAIT_AFTER_CLICK_MS: env.WAIT_AFTER_CLICK_MS,
        LATEST_PICK: env.LATEST_PICK,
        OFFSET_FROM_END: env.OFFSET_FROM_END,
        CHECK_LAST_N: env.CHECK_LAST_N,
        TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
    });

    const { ctx, page } = await bootAndOpen(env.TARGET_URL, {
        headful: env.DEBUG_HEADFUL,
        devtools: env.DEBUG_DEVTOOLS,
        recordVideo: env.DEBUG_RECORD_VIDEO,
        trace: env.DEBUG_TRACE,
    });

    try {
        // 1) Клик по дроверу с опросом (если нужен)
        if (env.CLICK_SELECTOR) {
            const clicked = await clickWithPolling(page, env.CLICK_SELECTOR, {
                nth: env.CLICK_INDEX,
                totalMs: env.CLICK_POLL_SECONDS * 1000,
                intervalMs: env.CLICK_POLL_INTERVAL_MS,
                waitAfterClickSelector: env.ROOT_SELECTOR,
                waitAfterClickMs: env.WAIT_AFTER_CLICK_MS,
            });
            if (!clicked) {
                log('Click target not found within time budget. Skipping the run.');
                return;
            }
        }

        // 2) Дождаться корень
        await waitRoot(page, env.ROOT_SELECTOR, env.WAIT_FOR);

        // 3) Получить список элементов (items[0] — самый свежий)
        const { items } = await pickTextNode(page, env.ROOT_SELECTOR, 'first', 0);

        // Ограничим сканирование CHECK_LAST_N
        const scanCount = Math.min(env.CHECK_LAST_N, items.length);
        log(`Scan last N: ${scanCount} (from total ${items.length})`);

        // 4) Сформировать очередь к обработке до первого совпадения с кэшем
        const cache = await readCache();
        const lastHash = cache.lastHash || null;

        const toProcess: QueueItem[] = [];
        for (let i = 0; i < scanCount; i++) {
            const handle = items[i];
            const textHe = await extractTextFrom(handle);
            const hash = sha1(textHe);

            // если встретили закешированное — прекращаем набор очереди
            if (lastHash && hash === lastHash) {
                log(`Hit cache boundary at index ${i}; stopping collection.`);
                break;
            }

            // добавляем в очередь новый элемент
            toProcess.push({ index: i, handle, textHe, hash });
        }

        log(`Collected toProcess size: ${toProcess.length}`);
        if (toProcess.length === 0) {
            log('No new items. Nothing to post.');
            return;
        }

        // 5) Публикуем ОТ СТАРЫХ К НОВЫМ (реверс массива)
        // Обновлять кэш будем значением ПОСЛЕДНЕГО успешно опубликованного хэша
        let lastPostedHash: string | null = null;

        for (let qi = toProcess.length - 1; qi >= 0; qi--) {
            const q = toProcess[qi];
            log(`[${toProcess.length - qi}/${toProcess.length}] Start process index=${q.index}, preview="${q.textHe.slice(0, 80)}"`);

            try {
                // Найти message root для текущей карточки
                const messageRoot = await findMessageRoot(q.handle);

                // Извлечь медиа (картинка/видео)
                const [imgUrl, videoUrlCandidate] = await Promise.all([
                    extractImageUrl(messageRoot),
                    extractVideoUrl(page, messageRoot),
                ]);

                await debugScreenshot(page, `after-media-probe-${q.index}`, env.DEBUG_SCREENSHOTS);

                // Перевести текст (he→ru)
                const t0 = Date.now();
                const textRu = await heToRu(q.textHe);
                log(`[${toProcess.length - qi}/${toProcess.length}] Translation ms:`, Date.now() - t0);

                // Отправить: видео > фото > текст
                const videoUrl = videoUrlCandidate && /\.m3u8(\?|#|$)/i.test(videoUrlCandidate) ? null : videoUrlCandidate;
                log(`[${toProcess.length - qi}/${toProcess.length}] Media picked:`, { videoUrl: videoUrl ?? '<none>', imgUrl: imgUrl ?? '<none>' });

                if (videoUrl) {
                    await sendVideo(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, videoUrl, textRu);
                    log(`[${toProcess.length - qi}/${toProcess.length}] sendVideo OK`);
                } else if (imgUrl) {
                    await sendPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, imgUrl, textRu);
                    log(`[${toProcess.length - qi}/${toProcess.length}] sendPhoto OK`);
                } else {
                    await sendPlain(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, textRu);
                    log(`[${toProcess.length - qi}/${toProcess.length}] sendPlain OK`);
                }

                lastPostedHash = q.hash; // фиксируем последнюю успешную публикацию
            } catch (e) {
                log(`[${toProcess.length - qi}/${toProcess.length}] Item failed, continue with next:`, e);
                // продолжаем со следующей новостью
            }
        }

        // 6) Обновить кэш последним успешно опубликованным хэшем
        if (lastPostedHash) {
            await writeCache({ lastHash: lastPostedHash });
            log('Cache updated with last posted hash:', lastPostedHash);
        } else {
            log('Nothing posted — cache not updated.');
        }
    } finally {
        await stopAndFlush(ctx, env.DEBUG_TRACE);
        log('Browser closed.');
    }
}

main().catch((err) => {
    log('FATAL:', err);
    process.exit(1);
});
