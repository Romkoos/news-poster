// parsers/web.ts
import { log } from '../lib/logger';
import { stopAndFlush } from '../lib/browser_web';
import { clickWithPolling, waitRoot, pickTextNode, extractTextFrom, findMessageRoot } from '../lib/scrape';
import { extractImageUrl, extractVideoUrl } from '../lib/media';
import { readCache, writeCache } from '../lib/cache';
import { sha1 } from '../lib/hash';
import { heToRu } from '../translate';
import { sendPlain, sendPhoto, sendVideo } from '../telegram';
import {bootAndOpenWeb} from "../lib/browser_web";

export async function runWeb(env: ReturnType<typeof import('../lib/env').readAppEnv>) {
    const { ctx, page } = await bootAndOpenWeb(env.WEB_TARGET_URL, {
        headful: env.DEBUG_HEADFUL,
        devtools: env.DEBUG_DEVTOOLS
    });

    try {
        // Клик по «дроверу», если он есть (с polling)
        if (env.CLICK_SELECTOR) {
            const clicked = await clickWithPolling(page, env.CLICK_SELECTOR, {
                nth: env.CLICK_INDEX,
                totalMs: env.CLICK_POLL_SECONDS * 1000,
                intervalMs: env.CLICK_POLL_INTERVAL_MS,
                waitAfterClickSelector: env.ROOT_SELECTOR,
                waitAfterClickMs: env.WAIT_AFTER_CLICK_MS,
            });
            if (!clicked) {
                throw new Error('WEB: Click target not found within time budget.');
            }
        }

        await waitRoot(page, env.ROOT_SELECTOR, env.WAIT_FOR);

        const { items } = await pickTextNode(page, env.ROOT_SELECTOR, 'first', 0);
        const scanCount = Math.min(env.CHECK_LAST_N, items.length);
        log(`(WEB) Scan last N: ${scanCount} (from total ${items.length})`);

        const cache = await readCache();
        const lastHash = cache.lastHash || null;

        type QueueItem = { index: number; handle: any; textHe: string; hash: string };
        const toProcess: QueueItem[] = [];

        for (let i = 0; i < scanCount; i++) {
            const handle = items[i];
            const textHe = await extractTextFrom(handle);
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

        let lastPostedHash: string | null = null;

        for (let qi = toProcess.length - 1; qi >= 0; qi--) {
            const q = toProcess[qi];
            log(`(WEB) [${toProcess.length - qi}/${toProcess.length}] index=${q.index}`);

            try {
                const messageRoot = await findMessageRoot(q.handle);
                const [imgUrl, videoUrlCandidate] = await Promise.all([
                    extractImageUrl(messageRoot),
                    extractVideoUrl(page, messageRoot),
                ]);

                const t0 = Date.now();
                const textRu = await heToRu(q.textHe);
                log(`(WEB) Translation ms:`, Date.now() - t0);

                const videoUrl =
                    videoUrlCandidate && /\.m3u8(\?|#|$)/i.test(videoUrlCandidate) ? null : videoUrlCandidate;

                if (videoUrl) {
                    await sendVideo(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, videoUrl, textRu);
                } else if (imgUrl) {
                    await sendPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, imgUrl, textRu);
                } else {
                    await sendPlain(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, textRu);
                }

                lastPostedHash = q.hash;
            } catch (e) {
                log(`(WEB) Item failed, continue:`, e);
            }
        }

        if (lastPostedHash) {
            await writeCache({ lastHash: lastPostedHash });
            log('(WEB) Cache updated:', lastPostedHash);
        } else {
            log('(WEB) Nothing posted — cache not updated.');
        }
    } finally {
        await stopAndFlush(ctx);
        log('(WEB) Browser closed.');
    }
}
