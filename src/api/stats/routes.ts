import { Router } from 'express';
import { initDb } from '../news/db';
import { DateTime } from 'luxon';

const router = Router();
const db = initDb();

router.get('/24h', (_req, res) => {
    try {
        const HOUR = 60 * 60 * 1000;
        const tz = process.env.STATS_TZ || 'Asia/Jerusalem';

        // Получаем конец окна — начало текущего часа в нужной зоне, но приводим к UTC!
        const end = DateTime.now()
            .setZone(tz)
            .startOf('hour')
            .toUTC();

        const start = end.minus({ hours: 24 });

        const startMs = start.toMillis();
        const endMs = end.toMillis();

        // Извлекаем все timestamp'ы между start и end
        const timestamps = db.getTimestampsBetween(startMs, endMs);

        const buckets = new Array(24).fill(0);

        for (const ts of timestamps) {
            const diff = ts - startMs;
            const idx = Math.floor(diff / HOUR);
            if (idx >= 0 && idx < 24) buckets[idx]++;
        }

        res.json(buckets);
    } catch (e) {
        console.error('Error in /24h stats:', e);
        res.status(500).json({ error: 'internal' });
    }
});

router.get('/24h-hidden', (_req, res) => {
    try {
        const HOUR = 60 * 60 * 1000;
        const tz = process.env.STATS_TZ || 'Asia/Jerusalem';

        // Получаем конец окна — начало текущего часа в нужной зоне, но приводим к UTC!
        const end = DateTime.now()
            .setZone(tz)
            .startOf('hour')
            .toUTC();

        const start = end.minus({ hours: 24 });

        const startMs = start.toMillis();
        const endMs = end.toMillis();

        // Извлекаем все timestamp'ы между start и end ТОЛЬКО для rejected/filtered
        const timestamps = db.getTimestampsBetweenHidden(startMs, endMs);

        const buckets = new Array(24).fill(0);

        for (const ts of timestamps) {
            const diff = ts - startMs;
            const idx = Math.floor(diff / HOUR);
            if (idx >= 0 && idx < 24) buckets[idx]++;
        }

        res.json(buckets);
    } catch (e) {
        console.error('Error in /24h-hidden stats:', e);
        res.status(500).json({ error: 'internal' });
    }
});

export default router;
