import { Page } from 'playwright';
import { extractTextFrom } from './scrape';
import { sha1 } from '../../lib/hash';
import { QueueItem } from './types';
import { log } from '../../shared/logger';

/**
 * Build processing queue from picked DOM items until lastHash boundary.
 */
export async function buildQueue(page: Page, items: any[], lastHash: string | null): Promise<QueueItem[]> {
  const toProcess: QueueItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const handle = items[i];
    const textHe = await extractTextFrom(handle, page);
    const hash = sha1(textHe);

    if (lastHash && hash === lastHash) {
      log(`(WEB) Hit cache boundary at index ${i}; stopping collection.`);
      break;
    }
    toProcess.push({ index: i, handle, textHe, hash });
  }
  return toProcess;
}
