// src/api.ts
import express from 'express';
import cors from 'cors';
import { initDb } from './api/news/db';

const app = express();
const db = initDb();
import usersRoutes from './api/users/routes';
import filtersRoutes from './api/filters/routes';
import statsRoutes from './api/stats/routes';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// CORS: по умолчанию открыт. Можно ограничить через CORS_ORIGIN="https://my.site, http://localhost:5173"
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin: corsOrigins && corsOrigins.length ? corsOrigins : true,
}));

// хелпер: "сегодня" в таймзоне Израиля (YYYY-MM-DD)
function todayIL(): string {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit' });
    // en-CA даёт YYYY-MM-DD
    return fmt.format(new Date());
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

app.use('/api/stats', statsRoutes);

// /api/news/today?limit=500&extended=1&all=1&onlyNew=1
app.get('/api/news/today', (req, res) => {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 500));
    const rows = db.getNewsFor(todayIL()).slice(-limit); // уже по возрастанию ts → берём последние

    // отдаём по убыванию времени (свежее первым)
    const all = rows.sort((a,b) => b.ts - a.ts);

    const lastUsedPostIdBefore = db.getLastUsedPostId();
    const newSince = all.filter(r => r.id > lastUsedPostIdBefore);

    // флаги управления выводом
    const q = (name: string) => String((req.query as any)[name] || '').toLowerCase();
    const isTrue = (v: string) => v === '1' || v === 'true' || v === 'yes' || v === 'y';

    const extended = isTrue(q('extended'));
    const forceAll = isTrue(q('all'));
    const forceOnlyNew = isTrue(q('onlyNew')) || isTrue(q('new')) || isTrue(q('since'));

    // по умолчанию: если маркер задан, возвращаем только новые; иначе — все
    let list = all;
    if (forceAll) {
        list = all;
    } else if (forceOnlyNew) {
        list = newSince;
    } else if (lastUsedPostIdBefore > 0) {
        list = newSince;
    }

    if (extended) {
        res.json({
            all,
            newSince,
            lastUsedPostIdBefore,
            totalAll: all.length,
            totalNew: newSince.length,
        });
    } else {
        res.json(list);
    }
});

// /api/news?date=YYYY-MM-DD&limit=500
app.get('/api/news', (req, res) => {
    const date = String(req.query.date || todayIL());
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 500));
    // const rows = db.getNewsFor(date).slice(-limit);
    const rows = db.getNews();
    console.log(rows)
    res.json(rows.sort((a,b) => b.ts - a.ts));
});

app.use('/api/users', usersRoutes);
app.use('/api/filters', filtersRoutes);
import moderationRoutes from './api/moderation/routes';
app.use('/api/moderation', moderationRoutes);

// POST /api/news/last-used — запись маркера по нажатию кнопки на фронте
app.post('/api/news/last-used', (req, res) => {
    const before = db.getLastUsedPostId();
    const body: any = req.body || {};
    const fromBody = typeof body.id !== 'undefined' ? Number(body.id) : NaN;
    const candidate = Number.isFinite(fromBody) && fromBody > 0 ? Math.floor(fromBody) : db.getLatestNewsId();
    const after = candidate || before; // не понижать на 0 в ответе

    // если candidate == 0 — запишем 0 (как и ранее), иначе — candidate
    db.setLastUsedPostId(candidate || 0);
    res.json({ ok: true, lastUsedPostIdBefore: before, lastUsedPostIdAfter: after });
});

const PORT = Number(process.env.API_PORT || 8080);
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on :${PORT}`);
});
