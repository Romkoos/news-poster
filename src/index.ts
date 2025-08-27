// src/index.ts
// Главная точка входа приложения.
// Задача: открыть сайт, найти последнюю новость, извлечь текст и медиа, перевести и отправить в Telegram.
//
// Ключевые этапы конвейера:
// 1) Чтение конфигурации из .env (см. src/lib/env.ts) и логирование параметров запуска.
// 2) Подъём браузера Playwright (см. src/lib/browser.ts) с опциональными фичами дебага:
//    - headful/devtools/video/trace/визуальные оверлеи/скриншоты.
// 3) (Опционально) Поллинг-клик по кнопке, чтобы раскрыть ленту/контейнер с новостями.
// 4) Ожидание появления корневого контейнера и выбор нужной текстовой ноды (см. src/lib/scrape.ts).
// 5) Дедупликация по SHA‑1 хешу текста (см. src/lib/hash.ts, src/lib/cache.ts).
// 6) Поиск медиа (картинка/видео) относительно корня сообщения (см. src/lib/media.ts).
// 7) Перевод he → en → ru (см. src/translate.ts) и лёгкий пост‑процессинг.
// 8) Отправка в Telegram: видео/фото/текст (см. src/telegram.ts).
// 9) Закрытие браузера, финализация трейсинга/видео при необходимости.
//
// Важно: любая отладка и «шумные» фичи управляются переменными окружения, чтобы их легко включать/выключать.
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
        TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
    });

    const debugOn = !!env.DEBUG_BROWSER;
    const dbgHeadful = debugOn && env.DEBUG_HEADFUL;
    const dbgDevtools = debugOn && env.DEBUG_DEVTOOLS;
    const dbgRecordVideo = debugOn && env.DEBUG_RECORD_VIDEO;
    const dbgTrace = debugOn && env.DEBUG_TRACE;
    const dbgScreenshots = debugOn && env.DEBUG_SCREENSHOTS;
    const dbgVisuals = debugOn && env.DEBUG_VISUALS;

    const { ctx, page } = await bootAndOpen(env.TARGET_URL, {
        headful: dbgHeadful,
        devtools: dbgDevtools,
        recordVideo: dbgRecordVideo,
        trace: dbgTrace,
        visualOverlay: dbgVisuals,
    });

    try {
        // === ЭТАП КЛИКА С ПОЛЛИНГОМ ===
        if (env.CLICK_SELECTOR) {
            const clicked = await clickWithPolling(page, env.CLICK_SELECTOR, {
                nth: env.CLICK_INDEX,
                totalMs: env.CLICK_POLL_SECONDS * 1000,
                intervalMs: env.CLICK_POLL_INTERVAL_MS,
                waitAfterClickSelector: env.ROOT_SELECTOR,
                waitAfterClickMs: env.WAIT_AFTER_CLICK_MS,
            });

            // Если не нашли/не кликнули за отведённое время — СКИПАЕМ ВЕСЬ РАН
            if (!clicked) {
                log('Click target not found within time budget. Skipping the run.');
                return;
            }
        }

        // На всякий случай: если клик выключен, но корень рендерится сам — дождёмся корня
        await waitRoot(page, env.ROOT_SELECTOR, env.WAIT_FOR);

        // Текстовая нода
        const { pick } = await pickTextNode(page, env.ROOT_SELECTOR, env.LATEST_PICK, env.OFFSET_FROM_END);

        await debugScreenshot(page, 'picked-before-extract', dbgScreenshots);

        const textHe = await extractTextFrom(pick);
        log('Text length:', textHe?.length ?? 0);
        log('Text preview:', (textHe || '').slice(0, 140));
        if (!textHe) throw new Error('Empty text node');

        // Дедуп
        const hash = sha1(textHe);
        log('Text hash:', hash);
        const cache = await readCache();
        if (cache.lastHash === hash) {
            log('No new item. Skip by hash match.');
            return;
        }

        // Медиа
        const messageRoot = await findMessageRoot(pick);
        const [imgUrl, videoUrlCandidate] = await Promise.all([
            extractImageUrl(messageRoot),
            extractVideoUrl(page, messageRoot, { visuals: dbgVisuals, screenshots: dbgScreenshots }),
        ]);
        await debugScreenshot(page, 'after-media-probe', dbgScreenshots);

        // Перевод
        log('Start translation he→en→ru…');
        const t0 = Date.now();
        const textRu = await heToRu(textHe);
        log('Translation done in ms:', Date.now() - t0);
        log('Translation preview:', (textRu || '').slice(0, 140));

        // Отправка
        const videoUrl = videoUrlCandidate && /\.m3u8(\?|#|$)/i.test(videoUrlCandidate) ? null : videoUrlCandidate;
        log('videoUrl:', videoUrl ?? '<none>');
        log('imgUrl:', imgUrl ?? '<none>');

        // РАЗКОММЕНТИРУЙ, когда будешь готовы слать в канал:
        try {
          if (videoUrl) {
            log('Sending VIDEO with caption…', { videoUrl, captionLen: textRu.length });
            await sendVideo(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, videoUrl, textRu);
            log('sendVideo OK');
          } else if (imgUrl) {
            log('Sending PHOTO with caption…', { imgUrl, captionLen: textRu.length });
            await sendPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, imgUrl, textRu);
            log('sendPhoto OK');
          } else {
            log('Sending PLAIN text…', { textLen: textRu.length });
            await sendPlain(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, textRu);
            log('sendPlain OK');
          }
        } catch (e) {
          log('Telegram send error:', e);
          throw e;
        }

        await writeCache({ lastHash: hash });
        log('Posted. Hash saved.');
    } finally {
        await stopAndFlush(ctx, dbgTrace);
        log('Done.');
        process.exit(0)
    }
}

main().catch((err) => {
    log('FATAL:', err);
    process.exit(1);
});
