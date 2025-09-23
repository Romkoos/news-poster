// src/shared/time.ts
// Time/date helpers centralized for reuse across modules.

/**
 * Get local date in YYYY-MM-DD format.
 */
export function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Current timestamp in milliseconds.
 */
export function nowMs(): number { return Date.now(); }
