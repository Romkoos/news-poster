// src/api.ts
import express from 'express';
import cors from 'cors';
import { initDb } from './lib/db';

const app = express();
const db = initDb();

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

// /api/news/today?limit=500
app.get('/api/news/today', (req, res) => {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 500));
    const rows = db.getNewsFor(todayIL()).slice(-limit);         // уже по возрастанию ts → берём последние
    // отдаём по убыванию времени (свежее первым)
    res.json(rows.sort((a,b) => b.ts - a.ts));
});

// /api/news?date=YYYY-MM-DD&limit=500
app.get('/api/news', (req, res) => {
    const date = String(req.query.date || todayIL());
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 500));
    const rows = db.getNewsFor(date).slice(-limit);
    res.json(rows.sort((a,b) => b.ts - a.ts));
});

const PORT = Number(process.env.API_PORT || 8080);
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on :${PORT}`);
});
