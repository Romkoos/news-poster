import type { QueueItem, FiltersBundle } from './types';
import { listFilters, getSettings } from '../../api/filters/db';

// export const EXCLUDED_AUTHORS = [""] as const;
export const EXCLUDED_AUTHORS = ["מבזקן 12", "דסק החוץ"] as const;

export function loadFiltersBundle(): FiltersBundle {
  const allFilters = listFilters().filter(f => f.active);
  const settings = getSettings();

  return { allFilters, settings };
}

export async function getHeaderName(handle: any): Promise<string> {
  const headerName = await handle.evaluate((node: any) => {
    const msg = node.closest?.('.mc-message');
    const nameEl = msg ? (msg.querySelector('.mc-message-header__name') as any) : null;
    const raw = nameEl ? (nameEl.innerText || nameEl.textContent || '') : '';
    return String(raw || '').trim();
  });
  return headerName;
}

export async function isExcludedByAuthor(q: QueueItem): Promise<{ excluded: boolean; headerName: string }>{
  try {
    const headerName = await getHeaderName(q.handle);
    return { excluded: EXCLUDED_AUTHORS.includes(headerName as any), headerName };
  } catch {
    return { excluded: false, headerName: '' };
  }
}

export type FilterDecision = {
  action: 'publish' | 'reject' | 'moderation';
  winnerId?: string;
};

export function decideAction(q: QueueItem, bundle: FiltersBundle): FilterDecision {
  const matches = bundle.allFilters.filter(f => {
    if (!q.textHe) return false;
    if ((f.matchType ?? 'substring') === 'regex') {
      try {
        return new RegExp(f.keyword, 'u').test(q.textHe);
      } catch {
        return false;
      }
    }
    return q.textHe.includes(f.keyword);
  });
  const winner = matches[0];
  const action = (winner?.action ?? bundle.settings.defaultAction);
  return { action, winnerId: winner?.id };
}
