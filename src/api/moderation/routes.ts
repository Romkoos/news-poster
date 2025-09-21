import { Router } from 'express';
import { requireAuth } from '../auth/jwt';
import { deleteModerationById, getModerationById, insertModerationItem, listModeration } from './db';
import { sha1 } from '../../lib/hash';
import { heToRu } from '../../translate';
import { sendPhoto, sendPlain, sendVideo } from '../../telegram';
import { initDb } from '../news/db';
import { readAppEnv } from '../../shared/config';

const router = Router();

// protect all moderation routes
router.use(requireAuth);

// GET /moderation -> ModerationItem[]
router.get('/', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const items = listModeration(limit, offset);
    res.json(items);
  } catch {
    res.status(500).json({ error: 'internal' });
  }
});

// POST /moderation -> create item
router.post('/', (req, res) => {
  try {
    const body = req.body ?? {};
    const textHe: string = String(body.textHe ?? '').trim();
    const filterId: string = String(body.filterId ?? '').trim();
    const media: string | undefined = typeof body.media === 'string' ? body.media : undefined;
    if (!textHe || textHe.length < 2) return res.status(400).json({ error: 'keyword:required' });
    // allow any string as filterId (UUID shape is not strictly validated here)
    const created = insertModerationItem(textHe, filterId || '00000000-0000-0000-0000-000000000000', media);
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: 'internal' });
  }
});

// POST /moderation/:id/approve -> publish and delete
router.post('/:id/approve', async (req, res) => {
  try {
    const id = String(req.params.id);
    const item = getModerationById(id);
    if (!item) return res.status(404).json({ error: 'notfound' });

    // delete first (as per simple behavior requirement)
    deleteModerationById(id);

    // proceed to publish (translate -> media -> telegram -> record hash)
    try {
      const env = readAppEnv();
      const db = initDb();
      const hash = sha1(item.textHe);
      const textRu = await heToRu(item.textHe, env);

      let media = item.media || undefined;
      // Align with parser: ignore HLS playlists (.m3u8) — send plain text instead
      if (media && /\.m3u8(\?|#|$)/i.test(media)) {
        media = undefined;
      }
      const isVideo = !!media && /\.(mp4|mov|webm|mkv)(\?|#|$)/i.test(media);

      if (media && isVideo) {
        await sendVideo(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, media, textRu);
      } else if (media) {
        await sendPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, media, textRu);
      } else {
        await sendPlain(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, textRu);
      }

      try {
        db.addNews(textRu, hash, Date.now());
      } catch {
        // ignore persistence failure per simple behavior
      }

      return res.json({ ok: true });
    } catch {
      // log suppressed here; return ok per spec (do not restore queue)
      return res.json({ ok: true });
    }
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

// POST /moderation/:id/reject -> delete only
router.post('/:id/reject', (req, res) => {
  try {
    const id = String(req.params.id);
    const item = getModerationById(id);
    if (!item) return res.status(404).json({ error: 'notfound' });
    deleteModerationById(id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

export default router;
