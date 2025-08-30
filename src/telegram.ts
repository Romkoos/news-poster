// src/telegram.ts
// Простая отправка в Telegram: текст / фото / видео по URL.

import { log } from './lib/logger';

const CAPTION_MAX = 900;    // запас от лимита 1024
const TEXT_CHUNK = 3900;    // запас от лимита 4096

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

// -------- public API --------

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
    const payload = {
        chat_id: chatId,
        video: videoUrl,
        caption: caption ? clipCaption(caption) : undefined,
        supports_streaming: true,
    };

    try {
        await postJSON(url, payload);
    } catch (e: any) {
        throw new Error(`sendVideo failed: ${String(e?.message || e)}`);
    }
}
