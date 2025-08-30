// src/ort-silence.ts
// Назначение: возможность приглушать/отключать шумные логи ONNX Runtime через .env.
// Этот модуль импортируется самым первым в src/index.ts,
// чтобы успеть выставить переменные окружения ДО загрузки onnxruntime-node/onnxruntime-web.
//
// Поддерживаемые переменные окружения:
// - ORT_SILENCE=1 или ORT_DISABLE_WARNINGS=1 — быстрый способ убрать предупреждения (уровень error).
// - ORT_LOG_LEVEL — явный уровень (число 0..4 или имя verbose|info|warning|error|fatal|none).
//   0=verbose, 1=info, 2=warning, 3=error, 4=fatal (none трактуем как fatal).

function asBool(v?: string): boolean {
    const s = (v || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function mapLevelToNumber(v?: string): number | undefined {
    if (!v) return undefined;
    const s = v.trim().toLowerCase();
    if (/^[0-4]$/.test(s)) return Number(s);
    switch (s) {
        case 'verbose': return 0;
        case 'info':
        case 'information': return 1;
        case 'warn':
        case 'warning': return 2;
        case 'error': return 3;
        case 'fatal':
        case 'none': return 4; // treat 'none' as fatal-only
        default: return undefined;
    }
}

// Primary toggles to silence warnings
const silence = asBool(process.env.ORT_SILENCE) || asBool(process.env.ORT_DISABLE_WARNINGS);

// Optional explicit level (0-4 or names)
let desiredLevel = mapLevelToNumber(process.env.ORT_LOG_LEVEL);

// If silence is requested and no explicit level provided, default to ERROR (3)
if (silence && desiredLevel === undefined) desiredLevel = 3;

// If a desired level is determined, set ORT_LOG_SEVERITY_LEVEL accordingly
if (desiredLevel !== undefined) {
    // Must be set before onnxruntime-node is loaded
    process.env.ORT_LOG_SEVERITY_LEVEL = String(desiredLevel);
}

// Best-effort: если onnxruntime-web уже загружен
try {
    const g: any = globalThis as any;
    if (g && g.ort && g.ort.env && desiredLevel !== undefined) {
        const map: Record<number, string> = {
            0: 'verbose',
            1: 'info',
            2: 'warning',
            3: 'error',
            4: 'fatal'
        };
        g.ort.env.logLevel = map[desiredLevel] ?? 'error';
    }
} catch {
    // ignore
}
