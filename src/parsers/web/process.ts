import type { Page } from 'playwright';
import { findMessageRoot } from './scrape';
import { extractImageUrl, extractVideoUrl } from './media';
import { heToRu } from '../../translate';
import { sendPlain, sendPhoto, sendVideo, editMessageText } from '../../telegram';
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
      // сохраняем только оригинальный текст (без перевода и без message_id), статус review
      db.addNews(q.textHe, q.hash, Date.now(), null, null, 'review');
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

    let messageId: number | null = null;
    if (videoUrl) {
      messageId = await sendVideo(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, String(videoUrl), textRu);
    } else if (imgUrl) {
      messageId = await sendPhoto(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, imgUrl, textRu);
    } else {
      messageId = await sendPlain(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, textRu);
    }

    try {
      db.addNews(q.textHe, q.hash, Date.now(), textRu, messageId ?? null, 'published');
    } catch (e) {
      log('(WEB) db.addNews failed:', e);
    }
    return { status: 'posted', boundaryHash: q.hash };
  } catch (e) {
    log('(WEB) Item failed, continue:', e);
    return { status: 'error', error: e };
  }
}

export async function handleEditExisting(page: Page, q: EnrichedItem, config: AppConfig, db: NewsDb, existingNewsId: number): Promise<ProcessResult> {
  try {
    // Переводим текст как в обычной публикации
    const t0 = Date.now();
    const textRu = await heToRu(q.textHe, config);
    log('(WEB) Translation ms (edit):', Date.now() - t0);

    // Ищем message_id по ID новости
    const msgId = db.getTelegramMessageIdById(existingNewsId);
    if (!msgId) {
      logWarn('(WEB) handleEditExisting: tg_message_id not found for news id', existingNewsId);
      return { status: 'error', error: new Error('No tg_message_id') };
    }

    // Редактируем текст существующего сообщения
    await editMessageText(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, msgId, textRu);

    // Фиксируем новый хеш в БД, привязывая к тому же message_id
    try {
      db.addNews(q.textHe, q.hash, Date.now(), textRu, msgId, 'published');
    } catch (e) {
      log('(WEB) db.addNews (edit) failed:', e);
    }

    return { status: 'posted', boundaryHash: q.hash };
  } catch (e) {
    logWarn('(WEB) handleEditExisting failed:', e);
    return { status: 'error', error: e };
  }
}
