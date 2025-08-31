// src/lib/browser_web.ts
// Назначение: инкапсулирует всё, что связано с запуском/остановкой браузера Playwright
// и техническими возможностями отладки (видео, трейс, визуальные оверлеи).
//
// Почему вынесено в отдельный модуль:
// - Упрощает читаемость основной логики скрейпинга.
// - Позволяет централизованно управлять дебаг-фичами через .env (см. src/lib/env.ts).
// - Легко расширять: можно добавлять прокси/профили/куки не трогая остальной код.

import { chromium, Page, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import { ensureDirs } from './fsutil';
import {log, logInfo} from './logger';

/**
 * Опции запуска браузера/контекста.
 * Все флаги предназначены для удобной отладки и включаются через .env (см. readAppEnv()).
 * - headful: показывать окно браузера (false => headless)
 * - devtools: автоматически открыть вкладку DevTools
 * - recordVideo: писать видео сессии в debug-artifacts/video
 * - trace: включить playwright tracing (скриншоты, снапшоты, исходники)
 * - visualOverlay: добавить CSS-оверлеи/рамки для ключевых блоков на странице
 */
export type BootOpts = {
    headful?: boolean;
    devtools?: boolean;
    recordVideo?: boolean;
    trace?: boolean;
    visualOverlay?: boolean; // include visual overlays/highlights
};

export type BootResult = { browser: Browser; ctx: BrowserContext; page: Page };

/**
 * Запустить браузер Chromium, создать контекст/страницу и открыть указанный URL.
 * В зависимости от опций включает запись видео, трейс и визуальные оверлеи.
 * @param url Стартовый адрес, который нужно открыть
 * @param opts Опции отладки/запуска (headful/devtools/recordVideo/trace/visualOverlay)
 * @returns Объект с дескрипторами browser, ctx (контекст), page
 */
export async function bootAndOpenWeb(url: string, opts: BootOpts = {}): Promise<BootResult> {
    const videoDir = path.resolve('debug-artifacts', 'video');

    const browser = await chromium.launch({
        headless: !opts.headful,
        devtools: !!opts.devtools,
    });

    if (opts.recordVideo) await ensureDirs([videoDir]);

    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        viewport: { width: 1366, height: 900 },
        recordVideo: opts.recordVideo ? { dir: videoDir } : undefined,
    });

    if (opts.trace) {
        await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }



    const page = await ctx.newPage();

    // Visual overlays for debugging only when enabled
    if (opts.visualOverlay) {
        await page.addStyleTag({
            content: `
      .mc-content-media { outline: 3px solid rgba(255,0,0,.7) !important; outline-offset: 2px; }
      .mc-extendable-text__content > div > div { outline: 2px dashed rgba(0,128,255,.7) !important; outline-offset: 2px; }
    `,
        });
    }

    log('Goto:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    logInfo('Loaded:', page.url());
    return { browser, ctx, page };
}

/**
 * Корректно остановить трейс (если включён) и закрыть контекст браузера.
 * Сохраняет .zip трейс в debug-artifacts/trace и печатает подсказку для просмотра.
 * @param ctx Контекст браузера Playwright
 * @param traceOn Флаг «трейс включён» (если false — просто закроем контекст)
 */
export async function stopAndFlush(ctx: BrowserContext) {
    await ctx.close();
}