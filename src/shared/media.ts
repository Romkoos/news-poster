// src/shared/media.ts
// Shared media-related small helpers.

/**
 * Detect whether a URL refers to an HLS playlist (.m3u8), case-insensitive.
 */
export function isHlsPlaylist(url: unknown): boolean {
  const s = String(url ?? '');
  return /\.m3u8(\?|#|$)/i.test(s);
}
