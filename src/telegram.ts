// src/telegram.ts
// Простая отправка в Telegram: текст / фото / видео по URL.
// Безопасный MarkdownV2: экранируем пользовательский текст и футер.

import { log } from './lib/logger';

const CAPTION_MAX = 900;    // запас от лимита 1024
const TEXT_CHUNK = 3900;    // запас от лимита 4096
const CHANNEL_URL = 'https://t.me/yalla_balagan_news';
const FOOTER_TITLE = 'Ялла балаган | Новости';

// --- MarkdownV2 escaping ---
// Экранируем все зарезервированные символы MarkdownV2.
// Отдельно: URL в круглых скобках не экранируем вовсе.
function escapeMdV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Сформировать готовый футер (MarkdownV2)
function buildFooter(): string {
    const sep = escapeMdV2('---------------------------------');
    const subscribe = escapeMdV2('Подписывайтесь');
    const label = escapeMdV2(FOOTER_TITLE);
    // URL НЕ экранируем
    return `${sep}\n${subscribe}\n[${label}](${CHANNEL_URL})`;
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

    try {
        await postJSON(url, payload);
    } catch (e: any) {
        throw new Error(`sendVideo failed: ${String(e?.message || e)}`);
    }
}
