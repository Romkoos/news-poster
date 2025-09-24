import { log, logWarn } from '../../shared/logger';
import { bootAndOpenWeb, stopAndFlush } from '../../shared/browser';
import { clickWithPolling, waitRoot, pickTextNode } from './scrape';
import { initDb } from '../../api/news/db';
import { buildQueue } from './extractQueue';
import { enrichItems } from './enrichItems';
import { loadFiltersBundle, isExcludedByAuthor, decideAction } from './filters';
import { hasDuplicate, handleModeration, handlePublish, handleEditExisting } from './process';
import { compareArrays } from '../../shared/compareArrays';

export async function webParser(config: ReturnType<typeof import('../../shared/config').readAppEnv>) {
  const db = initDb();
  const { ctx, page } = await bootAndOpenWeb(config.WEB_TARGET_URL, {
    headful: config.DEBUG_HEADFUL,
    devtools: config.DEBUG_DEVTOOLS,
  });

  try {
    if (config.CLICK_SELECTOR) {
      const clicked = await clickWithPolling(page, config.CLICK_SELECTOR, {
        nth: config.CLICK_INDEX,
        totalMs: config.CLICK_POLL_SECONDS * 1000,
        intervalMs: config.CLICK_POLL_INTERVAL_MS,
        waitAfterClickSelector: config.ROOT_SELECTOR,
        waitAfterClickMs: config.WAIT_AFTER_CLICK_MS,
      });
      if (!clicked) throw new Error('WEB: Click target not found within time budget.');
    }

    await waitRoot(page, config.ROOT_SELECTOR, config.WAIT_FOR);

    const { items } = await pickTextNode(page, config.ROOT_SELECTOR, 'first', 0);
    const scanCount = Math.min(config.CHECK_LAST_N, items.length);
    log(`(WEB) Scan last N: ${scanCount} (from total ${items.length})`);

    let lastHash: string | null;
    try {
      lastHash = db.getLastHash();
    } catch (e) {
      logWarn('(WEB) DB getLastHash failed; proceeding without boundary.', e);
      lastHash = null;
    }

    const toProcess = await buildQueue(page, items.slice(0, scanCount), lastHash);

    if (toProcess.length === 0) {
      log('(WEB) No new items. Nothing to post.');
      return;
    }

    const { oldestFirst, scrollUp } = await enrichItems(page, toProcess);

    if (scrollUp > 0) {
      await page.mouse.wheel(0, -scrollUp);
      await page.waitForTimeout(150);
    }

    const bundle = loadFiltersBundle();

    let lastBoundaryHash: string | null = null;

    for (let i = 0; i < oldestFirst.length; i++) {
      const q = oldestFirst[i];
      log(`(WEB) [${i + 1}/${oldestFirst.length}] index=${q.index}`);

      const excl = await isExcludedByAuthor(q);
      if (excl.excluded) {
        log(`(WEB) Skipping by excluded author: "${excl.headerName}" (index=${q.index})`);
        try {
          db.addNews(q.textHe, q.hash, Date.now(), null, null, 'filtered');
          lastBoundaryHash = q.hash;
        } catch (e) {
          logWarn('(WEB) db.addNews (filtered by author) failed:', e);
        }
        if (q.height > 0) {
          await page.mouse.wheel(0, q.height);
          await page.waitForTimeout(100);
        }
        continue;
      }

      const decision = decideAction(q, bundle);

      if (decision.action === 'reject') {
        log(`(WEB) Reject by filter: ${decision.winnerId || '<default>'} (index=${q.index})`);
        try {
          db.addNews(q.textHe, q.hash, Date.now(), null, null, 'filtered');
        } catch (e) {
          logWarn('(WEB) db.addNews (filtered by filter) failed:', e);
        }
        lastBoundaryHash = q.hash;
        if (q.height > 0) {
          await page.mouse.wheel(0, q.height);
          await page.waitForTimeout(100);
        }
        continue;
      }

      if (decision.action === 'moderation') {
        const res = await handleModeration(page, q, db, decision.winnerId);
        if (res.boundaryHash) lastBoundaryHash = res.boundaryHash;
        if (q.height > 0) {
          await page.mouse.wheel(0, q.height);
          await page.waitForTimeout(100);
        }
        continue;
      }

      if (hasDuplicate(db, q.hash)) {
        log(`(WEB) Stop publishing by DB duplicate hash: ${q.hash} (index=${q.index})`);
        if (q.height > 0) {
          await page.mouse.wheel(0, q.height);
          await page.waitForTimeout(100);
        }
        continue;
      }

      // Similarity check with last 10 published news (word-by-word positional comparison)
      try {
        const recent = db.getLastNews(10);

        const incomingWords = String(q.textHe || '').trim().split(/\s+/).filter(Boolean);
        let best: { id: number; score: number } | null = null;

        for (const r of recent) {
          const words = String(r.text_original || '').trim().split(/\s+/).filter(Boolean);
          const score = compareArrays(incomingWords, words);

          if (score >= 75 && (!best || score > best.score)) {
            best = { id: r.id, score };
          }
        }
        if (best) {
          logWarn('(WEB) Similar to existing, editing instead of publishing. newsId=', best.id, 'score=', best.score);
          const res = await handleEditExisting(page, q, config, db, best.id);
          if (res.status === 'posted') {
            if (res.boundaryHash) lastBoundaryHash = res.boundaryHash;
            if (q.height > 0) {
              await page.mouse.wheel(0, q.height);
              await page.waitForTimeout(100);
            }
            continue; // успешно отредактировали — прокрутили и переходим к следующему
          } else {
            logWarn('(WEB) Edit failed, falling back to publish. newsId=', best.id);
            // не делаем прокрутку здесь: она выполнится в блоке публикации ниже
          }
        }
      } catch (e) {
        logWarn('(WEB) Similarity check failed (continue anyway):', e);
      }

      try {
        const res = await handlePublish(page, q, config, db);
        if (res.boundaryHash) lastBoundaryHash = res.boundaryHash;
      } finally {
        if (q.height > 0) {
          await page.mouse.wheel(0, q.height);
          await page.waitForTimeout(100);
        }
      }
    }

    if (lastBoundaryHash) {
      try {
        db.setLastHash(lastBoundaryHash);
        log('(WEB) DB lastHash updated:', lastBoundaryHash);
      } catch (e) {
        log('(WEB) DB setLastHash failed; boundary not persisted this run:', e);
      }
    } else {
      log('(WEB) Nothing posted — boundary not updated.');
    }
  } finally {
    await stopAndFlush(ctx);
  }
}
