// src/lib/browser_mobile.ts
import { chromium, webkit, devices, Page, Browser, BrowserContext } from 'playwright';
import { log } from './logger';

export type BootOpts = {
    headful?: boolean;   // локальный дебаг
    devtools?: boolean;  // открыть DevTools (если headful)
    engine?: 'chromium' | 'webkit'; // если нужно строго Safari-движок
    profile?: 'android' | 'iphone'; // какой профиль притворяться
};

export type BootResult = { browser: Browser; ctx: BrowserContext; page: Page };

/**
 * Минимальный бут браузера с мобильным профилем и логированием ошибок.
 * По умолчанию: Chromium + Pixel 7 (Android Chrome).
 */
export async function bootAndOpenMobile(url: string, opts: BootOpts = {}): Promise<BootResult> {
    const engine = opts.engine ?? 'chromium';
    const profile = opts.profile ?? 'android';

    const browser = await (engine === 'webkit' ? webkit : chromium).launch({
        headless: !opts.headful,
        devtools: !!opts.devtools,
    });

    // Профили
    const device = profile === 'iphone'
        ? devices['iPhone 15 Pro Max'] // Safari UA/размеры
        : devices['Pixel 7'];          // Chrome UA/размеры (по умолчанию)

    const ctx = await browser.newContext({
        ...device,
    });

    // «Человеческие» заголовки — помогают пройти антибот-прокладки
    await ctx.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1',
    });

    // (Опционально) правдоподобные регион-настройки
    await ctx.grantPermissions(['geolocation']);
    await ctx.setGeolocation({ latitude: 32.0853, longitude: 34.7818 }); // Тель-Авив
    await ctx.addInitScript(() => {
        try {
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function () {
                    const o = (Intl as any).DateTimeFormat.prototype.resolvedOptions.call(this);
                    o.timeZone = 'Asia/Jerusalem';
                    return o;
                }
            });
        } catch {}
    });

    const page = await ctx.newPage();

    // // Диагностика: всё, что падает на странице, попадёт в логи
    // page.on('console', (msg) => {
    //     const type = msg.type();
    //     if (type === 'error') log('[page.console.error]', ...msg.args().map(a => a.toString()));
    //     else if (type === 'warning') log('[page.console.warn]', msg.text());
    // });
    // page.on('pageerror', (err) => log('[pageerror]', err.message));
    // page.on('requestfailed', (req) => {
    //     const f = req.failure();
    //     log('[requestfailed]', req.url(), f?.errorText || '');
    // });

    log('Goto:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    log('Loaded:', page.url());

    return { browser, ctx, page };
}

export async function stopAndFlush(ctx: BrowserContext) {
    await ctx.close();
}
