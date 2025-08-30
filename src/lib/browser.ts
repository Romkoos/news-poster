// src/lib/browser.ts
import { chromium, devices, Page, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import { ensureDirs } from './fsutil';
import { log } from './logger';

export type BootOpts = {
    headful?: boolean;
    devtools?: boolean;
    recordVideo?: boolean;
};

export type BootResult = { browser: Browser; ctx: BrowserContext; page: Page };

export async function bootAndOpen(url: string, opts: BootOpts = {}): Promise<BootResult> {
    const videoDir = path.resolve('debug-artifacts', 'video');
    if (opts.recordVideo) await ensureDirs([videoDir]);

    const browser = await chromium.launch({
        headless: !opts.headful,
        devtools: !!opts.devtools,
    });

    // Используем готовый пресет iPhone 12
    const ctx = await browser.newContext({
        ...devices['iPhone 15 Pro Max'],
        recordVideo: opts.recordVideo ? { dir: videoDir } : undefined,
    });

    const page = await ctx.newPage();

    log('Goto:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('Loaded:', page.url());

    return { browser, ctx, page };
}

export async function stopAndFlush(ctx: BrowserContext) {
    await ctx.close();
}
