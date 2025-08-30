import {log} from "./lib/logger";
import {bootAndOpen, stopAndFlush} from "./lib/browser";
import {readAppEnv} from "./lib/env";
import {extractTextFrom, findMessageRoot, pickTextNode, waitRoot} from "./lib/scrape";
import {readCache, writeCache} from "./lib/cache";
import {sha1} from "./lib/hash";
import {extractImageUrl, extractVideoUrl} from "./lib/media";
import {heToRu} from "./translate";
import {sendPhoto, sendPlain, sendVideo} from "./telegram";

type QueueItem = {
    index: number;
    handle: any;      // ElementHandle<Element>
    textHe: string;
    hash: string;
};

async function main() {
    const env = readAppEnv();
    const { ctx, page } = await bootAndOpen(env.TARGET_URL, {
        headful: env.DEBUG_HEADFUL,
        devtools: env.DEBUG_DEVTOOLS,
        recordVideo: env.DEBUG_RECORD_VIDEO
    });

    try {

        await waitRoot(page, env.ROOT_SELECTOR, env.WAIT_FOR);

        // 3) Получить список элементов (items[0] — самый свежий)
        const { items } = await pickTextNode(page, env.ROOT_SELECTOR, 'first', 0);

        // Ограничим сканирование CHECK_LAST_N
        const scanCount = Math.min(env.CHECK_LAST_N, items.length);

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
                break;
            }

            // добавляем в очередь новый элемент
            toProcess.push({ index: i, handle, textHe, hash });
        }

        if (toProcess.length === 0) {
            log('No new items. Nothing to post.');
            return;
        }

        // 5) Публикуем ОТ СТАРЫХ К НОВЫМ (реверс массива)
        // Обновлять кэш будем значением ПОСЛЕДНЕГО успешно опубликованного хэша
        let lastPostedHash: string | null = null;

        for (let qi = toProcess.length - 1; qi >= 0; qi--) {
            const q = toProcess[qi];

            try {
                // Найти message root для текущей карточки
                const messageRoot = await findMessageRoot(q.handle);



                // Извлечь медиа (картинка/видео)
                const [imgUrl, videoUrlCandidate] = await Promise.all([
                    extractImageUrl(messageRoot),
                    extractVideoUrl(page, messageRoot),
                ]);

                // Перевести текст (he→ru)
                const textRu = await heToRu(q.textHe);

                // Отправить: видео > фото > текст
                const videoUrl = videoUrlCandidate && /\.m3u8(\?|#|$)/i.test(videoUrlCandidate) ? null : videoUrlCandidate;

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
        }
    } finally {
        await stopAndFlush(ctx);
        log('Done.');
    }

}

main().catch((err) => {
    log('FATAL:', err);
    process.exit(1);
});
