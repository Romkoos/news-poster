import type { Page, ElementHandle } from 'playwright';
import { EnrichedItem, QueueItem } from './types';

export type EnrichResult = {
  oldestFirst: EnrichedItem[];
  scrollUp: number;
};

export async function enrichItems(page: Page, toProcess: QueueItem[]): Promise<EnrichResult> {
  const enriched: EnrichedItem[] = [];
  for (const q of toProcess) {
    const reporter = await q.handle.evaluateHandle((node) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (node as any).closest?.('.mc-reporter') || null;
    }) as ElementHandle<Element> | null;

    let height = 0;
    try {
      height = reporter
        ? await reporter.evaluate((n) => Math.ceil((n as HTMLElement).getBoundingClientRect().height || 0))
        : 0;
    } catch { /* ignore */ }
    if (!height || height < 40) height = 400; // разумная дефолтная высота

    enriched.push({ ...q, reporter, height });
  }

  // Обрабатывать от «самой старой» к «самой новой»
  const oldestFirst = enriched.slice().reverse();

  const poolHeight = oldestFirst.reduce((acc, it) => acc + it.height, 0);
  const viewportH = await page.evaluate(() => window.innerHeight || 0);
  const SAFETY = 80;
  const scrollUp = Math.max(0, Math.ceil(poolHeight - viewportH + SAFETY));

  return { oldestFirst, scrollUp };
}
