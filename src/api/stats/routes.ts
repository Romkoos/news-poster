import { Router } from 'express';
import { initDb } from '../news/db';

const router = Router();
const db = initDb();

// GET /api/stats/24h — массив из 24 чисел по часам (первый — 24ч назад, последний — текущий час)
router.get('/24h', (_req, res) => {
  try {
    const HOUR = 60 * 60 * 1000;
    // Выравниваем до начала ТЕКУЩЕГО часа в заданной таймзоне (по умолчанию — Азия/Иерусалим)
    const tz = process.env.STATS_TZ || 'Asia/Jerusalem';
    const now = Date.now();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now));
    const mm = Number(parts.find(p => p.type === 'minute')?.value || '0');
    const ss = Number(parts.find(p => p.type === 'second')?.value || '0');
    const endMs = now - ((mm * 60 + ss) * 1000 + (now % 1000));
    const startMs = endMs - 24 * HOUR;

    // достаём метки времени за интервал [startMs, endMs)
    const timestamps = db.getTimestampsBetween(startMs, endMs);

    // подготовим 24 корзины, по умолчанию 0
    const buckets = new Array<number>(24).fill(0);

    for (const ts of timestamps) {
      if (typeof ts !== 'number') continue;
      // вычисляем индекс корзины: 0 → самый старый (24-23ч назад), 23 → последний час [end-1h, end)
      const diff = ts - startMs;
      if (diff < 0 || diff >= 24 * HOUR) continue;
      const idx = Math.floor(diff / HOUR);
      if (idx >= 0 && idx < 24) buckets[idx]++;
    }

    res.json(buckets);
  } catch (e) {
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
