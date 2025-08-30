// src/telegram.ts
// Простая отправка в Telegram: текст / фото / видео по URL.
// Безопасный MarkdownV2: экранируем пользовательский текст и футер.
// Для видео добавлен фолбэк: при ошибке "wrong type of the web page content"
// скачиваем файл сами и отправляем как multipart.

import { log } from './lib/logger';

// --- node helpers для видео-фолбэка ---
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream as WebReadableStream } from 'node:stream/web';

const CAPTION_MAX = 900;    // запас от лимита 1024
const TEXT_CHUNK = 3900;    // запас от лимита 4096
const CHANNEL_URL = 'https://t.me/yalla_balagan_news';
const FOOTER_TITLE = 'Ялла балаган | Новости';

const DEFAULT_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';

// --- MarkdownV2 escaping ---
// Экранируем все зарезервированные символы MarkdownV2.
// Отдельно: URL в круглых скобках не экранируем вовсе.
function escapeMdV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Сформировать готовый футер (MarkdownV2)
function buildFooter(): string {
    const label = escapeMdV2(FOOTER_TITLE);
    // URL НЕ экранируем
    return `[${label}](${CHANNEL_URL})`;
}

// Добавить футер к тексту, экранируя текст как MarkdownV2
function withFooterMdV2(text?: string): string {
    const footer = buildFooter();
    if (!text || !text.trim()) return footer;
    return `${escapeMdV2(text.trim())}\n\n${footer}`;
}

function clipCaption(s: string) {
    return s.length <= CAPTION_MAX ? s : s.slice(0, CAPTION_MAX - 1) + '…';
}

async function postJSON<T = any>(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text || res.statusText}`);
    }
    return (await res.json()) as T;
}

// --- вспомогалки для видео-фолбэка ---

function isWrongTypeError(msg: string) {
    return /wrong type of the web page content/i.test(msg);
}

function ensureTmpDir() {
    const dir = path.resolve('.telegram-tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function refererForDownload() {
    // Для скачивания видео Akamai иногда требует реферер.
    return process.env.MOBILE_TARGET_URL || process.env.WEB_TARGET_URL || undefined;
}

async function downloadToTemp(url: string, filenameFallback = 'video.mp4') {
    const headers: Record<string, string> = {
        'User-Agent': DEFAULT_UA,
        'Accept': 'video/*;q=1.0,application/octet-stream;q=0.9,*/*;q=0.8',
    };
    const ref = refererForDownload();
    if (ref) headers['Referer'] = ref;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);

    const web = res.body as unknown as WebReadableStream;
    const node = Readable.fromWeb(web);

    const dir = ensureTmpDir();
    let name = filenameFallback;
    try {
        const { pathname } = new URL(url);
        const base = path.basename(pathname);
        if (base && base !== '/' && base !== '.' && base !== '..') name = base;
    } catch {}
    const fullPath = path.join(dir, `${Date.now()}-${name}`);

    await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(fullPath);
        node.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        node.pipe(out);
    });

    return fullPath;
}

async function uploadVideoMultipart(
    token: string,
    chatId: string,
    filePath: string,
    caption?: string
) {
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', clipCaption(caption));
    form.append('supports_streaming', 'true');
    form.append('parse_mode', 'MarkdownV2');
    form.append('video', fs.createReadStream(filePath) as any, path.basename(filePath));

    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: form as any,
    });
    if (!res.ok) throw new Error(`sendVideo multipart failed: ${res.status} ${await res.text()}`);
}

// -------- public API --------

export async function sendPlain(token: string, chatId: string, text: string) {
    // ВАЖНО: сначала экранируем и добавляем футер, потом режем
    const ready = withFooterMdV2(text);
    for (let i = 0; i < ready.length; i += TEXT_CHUNK) {
        const chunk = ready.slice(i, i + TEXT_CHUNK);
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await postJSON(url, {
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
            parse_mode: 'MarkdownV2',
        });
    }
}

export async function sendPhoto(
    token: string,
    chatId: string,
    photoUrl: string,
    caption?: string
) {
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    const finalCaption = clipCaption(withFooterMdV2(caption));
    const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: finalCaption,
        parse_mode: 'MarkdownV2',
    };

    try {
        await postJSON(url, payload);
    } catch (e: any) {
        throw new Error(`sendPhoto failed: ${String(e?.message || e)}`);
    }
}

export async function sendVideo(
    token: string,
    chatId: string,
    videoUrl: string,
    caption?: string
) {
    // Telegram не принимает .m3u8 в sendVideo по URL — сразу пропускаем.
    if (/\.m3u8(\?|#|$)/i.test(videoUrl)) {
        log('sendVideo skipped: HLS (.m3u8) is not supported by Telegram sendVideo URL', { videoUrl });
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendVideo`;
    const finalCaption = clipCaption(withFooterMdV2(caption));
    const payload = {
        chat_id: chatId,
        video: videoUrl,
        caption: finalCaption,
        supports_streaming: true,
        parse_mode: 'MarkdownV2',
    };

    // 1) пробуем отдать ссылку напрямую
    try {
        await postJSON(url, payload);
        return;
    } catch (e: any) {
        const msg = String(e?.message || e);
        // если это не "wrong type…" — пробрасываем как есть
        if (!isWrongTypeError(msg)) throw new Error(`sendVideo failed: ${msg}`);
        log('sendVideo: URL rejected by Telegram, switching to multipart fallback');
    }

    // 2) фолбэк: скачиваем и шлём multipart
    const tmp = await downloadToTemp(videoUrl, 'video.mp4');
    try {
        await uploadVideoMultipart(token, chatId, tmp, finalCaption);
    } finally {
        try { fs.unlinkSync(tmp); } catch {}
    }
}
