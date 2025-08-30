// parsers/mobile.ts
import { log } from '../lib/logger';
import { bootAndOpenMobile, stopAndFlush } from '../lib/browser_mobile';
import { waitRoot, pickTextNode, extractTextFrom, findMessageRoot } from '../lib/scrape';
import { extractImageUrl, extractVideoUrl } from '../lib/media';
import { readCache, writeCache } from '../lib/cache';
import { sha1 } from '../lib/hash';
import { heToRu } from '../translate';
import { sendPlain, sendPhoto, sendVideo } from '../telegram';

export async function runMobile(env: ReturnType<typeof import('../lib/env').readAppEnv>) {
    // Мобильная версия — простая: без кликов
    const { ctx, page } = await bootAndOpenMobile(env.MOBILE_TARGET_URL, {
        headful: env.DEBUG_HEADFUL,
        devtools: env.DEBUG_DEVTOOLS
    });

    try {
        await waitRoot(page, env.ROOT_SELECTOR, env.WAIT_FOR);

        // берём все элементы, items[0] — самый свежий
        const { items } = await pickTextNode(page, env.ROOT_SELECTOR, 'first', 0);
        const scanCount = Math.min(env.CHECK_LAST_N, items.length);
        log(`(MOBILE) Scan last N: ${scanCount} (from total ${items.length})`);

        const cache = await readCache();
        const lastHash = cache.lastHash || null;

        type QueueItem = { index: number; handle: any; textHe: string; hash: string };
        const toProcess: QueueItem[] = [];

        for (let i = 0; i < scanCount; i++) {
            const handle = items[i];
            const textHe = await extractTextFrom(handle);
            const hash = sha1(textHe);

            if (lastHash && hash === lastHash) {
                log(`(MOBILE) Hit cache boundary at index ${i}; stopping collection.`);
                break;
            }
            toProcess.push({ index: i, handle, textHe, hash });
        }

        if (toProcess.length === 0) {
            log('(MOBILE) No new items. Nothing to post.');
            return;
        }

        let lastPostedHash: string | null = null;

        for (let qi = toProcess.length - 1; qi >= 0; qi--) {
            const q = toProcess[qi];
            log(`(MOBILE) [${toProcess.length - qi}/${toProcess.length}] index=${q.index}`);

            try {
                const messageRoot = await findMessageRoot(q.handle);
                const [imgUrl, videoUrlCandidate] = await Promise.all([
                    extractImageUrl(messageRoot),
                    extractVideoUrl(page, messageRoot),
                ]);

                // Перевод
                const t0 = Date.now();
                const textRu = await heToRu(q.textHe);
                log(`(MOBILE) Translation ms:`, Date.now() - t0);

                // Отправка: видео > фото > текст
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
                log(`(MOBILE) Item failed, continue:`, e);
            }
        }

        if (lastPostedHash) {
            await writeCache({ lastHash: lastPostedHash });
            log('(MOBILE) Cache updated:', lastPostedHash);
        } else {
            log('(MOBILE) Nothing posted — cache not updated.');
        }
    } finally {
        await stopAndFlush(ctx);
        log('(MOBILE) Browser closed.');
    }
}
