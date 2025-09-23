import type { Page } from 'playwright';
import { findMessageRoot } from './scrape';
import { extractImageUrl, extractVideoUrl } from './media';
import { heToRu } from '../../translate';
import { sendPlain, sendPhoto, sendVideo } from '../../telegram';
import { log, logWarn } from '../../shared/logger';
import { isHlsPlaylist } from '../../shared/media';
import type { EnrichedItem, AppConfig, ProcessResult } from './types';
import { insertModerationItem } from '../../api/moderation/db';

export type NewsDb = ReturnType<typeof import('../../api/news/db').initDb>;

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function hasDuplicate(db: NewsDb, hash: string): boolean {
  try {
    return db.hasNewsHash(hash);
  } catch (e) {
    log('(WEB) DB hasNewsHash failed (continue anyway):', e);
    return false;
  }
}

export async function handleModeration(page: Page, q: EnrichedItem, db: NewsDb, filterId?: string): Promise<ProcessResult> {
  try {
    const messageRoot = await findMessageRoot(q.handle);
    const [imgUrl, videoUrlCandidate] = await Promise.all([
      extractImageUrl(page, messageRoot),
      extractVideoUrl(page, messageRoot),
    ]);
    const videoOk = videoUrlCandidate && !isHlsPlaylist(videoUrlCandidate);
    const media: string | undefined = videoOk ? String(videoUrlCandidate) : (imgUrl || undefined);
    insertModerationItem(q.textHe, filterId || ZERO_UUID, media);
    try {
      db.addNews(q.textHe, q.hash, Date.now());
    } catch (e) {
      log('(WEB) db.addNews (moderation) failed:', e);
    }
    return { status: 'moderation', boundaryHash: q.hash };
  } catch (e) {
    logWarn('(WEB) Failed to create moderation item:', e);
    return { status: 'error', error: e };
  }
}

export async function handlePublish(page: Page, q: EnrichedItem, config: AppConfig, db: NewsDb): Promise<ProcessResult> {
    try {
    const messageRoot = await findMessageRoot(q.handle);
    const [imgUrl, videoUrlCandidate] = await Promise.all([
      extractImageUrl(page, messageRoot),
      extractVideoUrl(page, messageRoot),
    ]);

    const t0 = Date.now();
    const textRu = await heToRu(q.textHe, config);
    log('(WEB) Translation ms:', Date.now() - t0);

    const videoUrl = videoUrlCandidate && isHlsPlaylist(videoUrlCandidate) ? null : videoUrlCandidate;

    if (videoUrl) {
      await sendVideo(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, String(videoUrl), textRu);
    } else if (imgUrl) {
      await sendPhoto(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, imgUrl, textRu);
    } else {
      await sendPlain(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, textRu);
    }

    try {
      db.addNews(textRu, q.hash, Date.now());
    } catch (e) {
      log('(WEB) db.addNews failed:', e);
    }
    return { status: 'posted', boundaryHash: q.hash };
  } catch (e) {
    log('(WEB) Item failed, continue:', e);
    return { status: 'error', error: e };
  }
}
