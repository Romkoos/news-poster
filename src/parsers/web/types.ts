import type { ElementHandle } from 'playwright';
import type { AppConfig } from '../../shared/config';
import type { FilterApiShape, Settings } from '../../api/filters/db';

export type { AppConfig };

export type QueueItem = { index: number; handle: any; textHe: string; hash: string };
export type EnrichedItem = QueueItem & { reporter: ElementHandle<Element> | null; height: number };

export type FiltersBundle = {
  allFilters: FilterApiShape[];
  settings: Settings;
};

export type ProcessResult = {
  status: 'skipped' | 'duplicate' | 'moderation' | 'posted' | 'error';
  error?: unknown;
  boundaryHash?: string | null; // set when we consider item processed for boundary
};
