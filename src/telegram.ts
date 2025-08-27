// src/telegram.ts
// Назначение: отправка контента в Telegram через Bot API (sendMessage, sendPhoto, sendVideo).
// Модуль инкапсулирует детали HTTP‑вызовов и ограничения по длине подписи/сообщения.
//
// Замечания:
// - Ограничение подписей к фото/видео у Telegram — 1024 символа. Берём запас (900), чтобы не упереться в лимит.
// - Для простых сообщений лимит ~4096 символов. Отправляем кусками по ~3900 символов.
// - Предполагается, что global fetch доступен (Node 18+). При необходимости можно заменить на undici или axios.

const CAPTION_MAX = 900; // Telegram: реальный лимит 1024, берём запас

/**
 * Усечь подпись до безопасной длины с добавлением многоточия.
 */
function clipCaption(s: string) {
    return s.length <= CAPTION_MAX ? s : s.slice(0, CAPTION_MAX - 1) + '…';
}

/**
 * Отправить простое текстовое сообщение. Длинные тексты режутся на части и отправляются последовательно.
 * @param token Токен бота (BotFather)
 * @param chatId Идентификатор чата/канала (например, -100123456789)
 * @param text Полный текст сообщения (любой длины — порежем сами)
 */
export async function sendPlain(token: string, chatId: string, text: string) {
    const MAX = 3900; // лимит 4096, берём запас
    for (let i = 0; i < text.length; i += MAX) {
        const chunk = text.slice(i, i + MAX);
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
        });
        if (!res.ok) throw new Error(`sendMessage failed: ${res.status} ${await res.text()}`);
    }
}

/**
 * Отправить фото по URL с опциональной подписью (усекается безопасно).
 * Telegram самостоятельно скачает изображение по URL.
 */
export async function sendPhoto(token: string, chatId: string, photoUrl: string, caption?: string) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,             // Telegram сам скачает по URL
            caption: caption ? clipCaption(caption) : undefined,
        }),
    });
    if (!res.ok) throw new Error(`sendPhoto failed: ${res.status} ${await res.text()}`);
}

/**
 * Отправить видео по URL с опциональной подписью. Включаем supports_streaming для HLS/MP4.
 */
export async function sendVideo(token: string, chatId: string, videoUrl: string, caption?: string) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            video: videoUrl,
            caption: caption ? clipCaption(caption) : undefined,
            supports_streaming: true,
        }),
    });
    if (!res.ok) throw new Error(`sendVideo failed: ${res.status} ${await res.text()}`);
}
