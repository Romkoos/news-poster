import { Router } from 'express';
import { initDb } from '../news/db';
import { DateTime } from 'luxon'; // если нет — поставь: npm i luxon

const router = Router();
const db = initDb();

router.get('/24h', (_req, res) => {
    try {
        const HOUR = 60 * 60 * 1000;
        const tz = process.env.STATS_TZ || 'Asia/Jerusalem';

        // Получаем дату окончания: начало текущего часа в заданной таймзоне
        const end = DateTime.now().setZone(tz).startOf('hour');
        const start = end.minus({ hours: 24 });

        // Получаем timestamp в мс
        const startMs = start.toMillis();
        const endMs = end.toMillis();

        // Получаем все таймстемпы публикаций за последние 24 часа
        const timestamps = db.getTimestampsBetween(startMs, endMs);

        // 24 пустых корзины
        const buckets = new Array(24).fill(0);

        for (const ts of timestamps) {
            const diff = ts - startMs;
            const idx = Math.floor(diff / HOUR);
            if (idx >= 0 && idx < 24) buckets[idx]++;
        }

        res.json(buckets);
    } catch (e) {
        res.status(500).json({ error: 'internal' });
    }
});

export default router;
