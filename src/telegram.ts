// src/telegram.ts
// Отправка контента в Telegram: текст / фото / видео с фолбэком.
// Исправлено: загрузка по WebStream -> NodeStream через Readable.fromWeb.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { ReadableStream as WebReadableStream } from 'node:stream/web';

const CAPTION_MAX = 900; // запас от лимита 1024
const TEXT_CHUNK = 3900;
const DEFAULT_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';

function clipCaption(s: string) {
    return s.length <= CAPTION_MAX ? s : s.slice(0, CAPTION_MAX - 1) + '…';
}

function isTgWrongPage(errBody: string) {
    return /wrong type of the web page content/i.test(errBody);
}

async function postJSON<T = any>(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

// -------------------- public API --------------------

export async function sendPlain(token: string, chatId: string, text: string) {
    for (let i = 0; i < text.length; i += TEXT_CHUNK) {
        const chunk = text.slice(i, i + TEXT_CHUNK);
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await postJSON(url, {
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
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
    const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption ? clipCaption(caption) : undefined,
    };

    try {
        await postJSON(url, payload);
        return;
    } catch (e: any) {
        const body = String(e?.message || e);
        if (!isTgWrongPage(body)) throw new Error(`sendPhoto failed: ${body}`);
    }

    // fallback: качаем сами и шлём multipart
    const tmp = await downloadToTemp(photoUrl, {
        referer: process.env.TARGET_URL,
        filenameFallback: filenameFromUrl(photoUrl, 'photo.jpg'),
    });

    try {
        await uploadAsMultipart(token, 'sendPhoto', chatId, 'photo', tmp.fullPath, caption);
    } finally {
        safeUnlink(tmp.fullPath);
    }
}

export async function sendVideo(
    token: string,
    chatId: string,
    videoUrl: string,
    caption?: string
) {
    const url = `https://api.telegram.org/bot${token}/sendVideo`;
    const payload = {
        chat_id: chatId,
        video: videoUrl,
        caption: caption ? clipCaption(caption) : undefined,
        supports_streaming: true,
    };

    if (/\.m3u8(\?|#|$)/i.test(videoUrl)) {
        throw new Error('sendVideo: HLS (.m3u8) URL не поддерживается Telegram как video URL');
    }

    try {
        await postJSON(url, payload);
        return;
    } catch (e: any) {
        const body = String(e?.message || e);
        if (!isTgWrongPage(body)) throw new Error(`sendVideo failed: ${body}`);
    }

    // fallback: качаем сами и шлём multipart
    const tmp = await downloadToTemp(videoUrl, {
        referer: process.env.TARGET_URL,
        filenameFallback: filenameFromUrl(videoUrl, 'video.mp4'),
        // maxBytes: 45 * 1024 * 1024, // при необходимости ограничить размер
    });

    try {
        await uploadAsMultipart(token, 'sendVideo', chatId, 'video', tmp.fullPath, caption, {
            supports_streaming: 'true',
        });
    } finally {
        safeUnlink(tmp.fullPath);
    }
}

// -------------------- helpers --------------------

function filenameFromUrl(u: string, fallback: string) {
    try {
        const { pathname } = new URL(u);
        const base = path.basename(pathname);
        if (base && base !== '/' && base !== '.' && base !== '..') return base;
    } catch {}
    return fallback;
}

function ensureTmpDir() {
    const dir = path.resolve('.telegram-tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function safeUnlink(p: string) {
    try { fs.unlinkSync(p); } catch {}
}

type DownloadOpts = {
    referer?: string;
    filenameFallback: string;
    maxBytes?: number;
};

async function downloadToTemp(
    url: string,
    opts: DownloadOpts
): Promise<{ fullPath: string; contentType: string | null }> {
    const headers: Record<string, string> = {
        'User-Agent': DEFAULT_UA,
        Accept: 'video/*,image/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.7',
    };
    if (opts.referer) headers['Referer'] = opts.referer;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`downloadToTemp: ${res.status} ${res.statusText}`);

    const ct = res.headers.get('content-type');
    const tmpDir = ensureTmpDir();
    const fullPath = path.join(tmpDir, `${Date.now()}-${opts.filenameFallback}`);

    // res.body — Web ReadableStream. Явно приводим к node:stream/web типу:
    const webStream = res.body as unknown as WebReadableStream;
    const nodeStream = Readable.fromWeb(webStream);

    await streamPipeline(
        nodeStream,
        new TransformLimit(opts.maxBytes),
        fs.createWriteStream(fullPath)
    );

    return { fullPath, contentType: ct };
}

class TransformLimit extends Transform {
    private limit?: number;
    private count = 0;
    public exceeded = false;

    constructor(limit?: number) {
        super();
        this.limit = limit;
    }
    override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
        this.count += chunk.length;
        if (this.limit && this.count > this.limit) {
            this.exceeded = true;
            cb(new Error('size limit exceeded'));
            return;
        }
        this.push(chunk);
        cb();
    }
}

async function uploadAsMultipart(
    token: string,
    method: 'sendPhoto' | 'sendVideo' | 'sendDocument',
    chatId: string,
    fieldName: 'photo' | 'video' | 'document',
    filePath: string,
    caption?: string,
    extra?: Record<string, string>
) {
    const url = `https://api.telegram.org/bot${token}/${method}`;

    // Используем встроенный FormData (undici). Для файла — Blob из ReadStream.
    // Чтобы не грузить файл целиком в память, можно оставить ReadStream:
    // undici FormData поддерживает ReadableStream как value с filename.
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', clipCaption(caption));
    if (extra) for (const [k, v] of Object.entries(extra)) form.append(k, v);

    const fileStream = fs.createReadStream(filePath);
    form.append(fieldName, fileStream as any, path.basename(filePath));

    const res = await fetch(url, { method: 'POST', body: form as any });
    if (!res.ok) throw new Error(`${method} (multipart) failed: ${res.status} ${await res.text()}`);
}
