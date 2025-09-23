// src/parsers/web/scrape.ts
// Clean page helpers for the web parser: waits, clicks, item selection, and text extraction.

import { Page, Locator, ElementHandle } from 'playwright';
import { log, logDebug } from '../../shared/logger';

export async function clickWithPolling(
  page: Page,
  selector: string,
  opts: {
    nth?: number;
    attemptsMax?: number; // default 20
    intervalMs?: number; // default 1000
    totalMs?: number; // guard; if absent => attemptsMax*interval*1.5
    waitAfterClickSelector?: string;
    waitAfterClickMs?: number;
  } = {}
): Promise<boolean> {
  const attemptsMax = opts.attemptsMax ?? 20;
  const intervalMs = opts.intervalMs ?? 1000;
  const totalMs = opts.totalMs ?? Math.ceil(attemptsMax * intervalMs * 1.5);
  const waitAfterClickSelector = opts.waitAfterClickSelector;
  const waitAfterClickMs = opts.waitAfterClickMs ?? 0;
  const nth = opts.nth ?? 0;

  const deadline = Date.now() + totalMs;
  const waitSuccess = async (): Promise<boolean> => {
    try {
      if (waitAfterClickSelector) {
        await page.waitForSelector(waitAfterClickSelector, {
          timeout: Math.min(2000, Math.max(500, intervalMs)),
        });
      }
      if (waitAfterClickMs > 0) await page.waitForTimeout(waitAfterClickMs);
      return true;
    } catch {
      return false;
    }
  };

  for (let attempt = 1; attempt <= attemptsMax; attempt++) {
    if (Date.now() >= deadline) break;

    let count = 0;
    try {
      count = await page.locator(selector).count();
    } catch {}
    if (!count) {
      await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
      continue;
    }

    const index = Math.min(Math.max(nth, 0), count - 1);
    const loc: Locator = page.locator(selector).nth(index);

    try {
      await loc.scrollIntoViewIfNeeded();
    } catch {}

    const handle = await loc.elementHandle();
    if (!handle) {
      await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
      continue;
    }

    // 1) dispatchEvent('click')
    try {
      await handle.dispatchEvent('click');
      if (await waitSuccess()) {
        log(`Clicked via dispatchEvent: ${selector} #${index}`);
        return true;
      }
    } catch {}

    // 2) DOM el.click()
    try {
      await page.evaluate((el: unknown) => {
        (el as HTMLElement).click();
      }, handle);

      if (await waitSuccess()) {
        log(`Clicked via evaluate(el.click()): ${selector} #${index}`);
        return true;
      }
    } catch {}

    // 3) mouse click at element center
    try {
      const box = await loc.boundingBox();
      if (box) {
        const cx = Math.floor(box.x + box.width / 2);
        const cy = Math.floor(box.y + box.height / 2);
        await page.mouse.click(cx, cy, { delay: 10 });
        if (await waitSuccess()) {
          log(`Clicked via mouse.center: ${selector} #${index}`);
          return true;
        }
      }
    } catch {}

    await page.waitForTimeout(Math.min(intervalMs, Math.max(50, deadline - Date.now())));
  }

  log(`Click polling timeout: ${selector}`);
  return false;
}

export async function waitRoot(page: Page, rootSelector: string, timeout: number) {
  await page.waitForSelector(rootSelector, { timeout });
}

const TEXT_PATH = '.mc-extendable-text__content > div > div';

export async function pickTextNode(
  page: Page,
  rootSelector: string,
  latestPick: 'first' | 'last',
  offsetFromEnd: number
) {
  const scoped = `${rootSelector} ${TEXT_PATH}`;
  await page.waitForSelector(scoped, { timeout: 15000 });

  const root = await page.$(rootSelector);
  if (!root) throw new Error('Root container not found');

  const items = await root.$$(TEXT_PATH);
  if (!items.length) throw new Error('News list is empty under root');

  const pick = latestPick === 'first' ? items[offsetFromEnd] : items[0];
  const index = latestPick === 'first' ? offsetFromEnd : 0;

  return { pick, items, index };
}

export async function extractTextFrom(el: ElementHandle<Element>, page: Page): Promise<string> {
  try {
    const btn = await el.$('.mc-read-more-btn');
    if (btn) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(50);
    }
  } catch {}

  const text = await el.evaluate((node) => {
    const it = (node as any).innerText as string | undefined;
    if (typeof it === 'string' && it.length) return it;
    return (node.textContent || '') as string;
  });

  return String(text || '');
}

export async function findMessageRoot(el: ElementHandle<Element>) {
  return await el.evaluateHandle((node) => {
    const r = (node as any).closest?.('.mc-message-content_open');
    return r || node;
  });
}
