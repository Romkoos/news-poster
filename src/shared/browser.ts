// src/shared/browser.ts
// Encapsulates Playwright browser boot/stop and optional debugging helpers.

import { chromium, Page, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import { ensureDirs } from './fsutil';
import { logInfo } from './logger';

export type BootOpts = {
  headful?: boolean;
  devtools?: boolean;
  recordVideo?: boolean;
  trace?: boolean;
  visualOverlay?: boolean; // include visual overlays/highlights
};

export type BootResult = { browser: Browser; ctx: BrowserContext; page: Page };

export async function bootAndOpenWeb(url: string, opts: BootOpts = {}): Promise<BootResult> {
  const videoDir = path.resolve('debug-artifacts', 'video');

  const browser = await chromium.launch({
    headless: !opts.headful,
    devtools: !!opts.devtools,
  });

  if (opts.recordVideo) await ensureDirs([videoDir]);

  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
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

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  logInfo('Loaded:', page.url());
  return { browser, ctx, page };
}

export async function stopAndFlush(ctx: BrowserContext) {
  await ctx.close();
}
