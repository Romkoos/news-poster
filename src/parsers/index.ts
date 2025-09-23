// src/parsers/index.ts
// Registry and selector for pluggable parsers

import type { Parser } from './types';
import type { AppConfig } from '../shared/config';
import { webParser } from './web/pipeline';


const registry = new Map<string, Parser>();

// Register built-in parsers here
registry.set('web', { name: 'web', run: webParser as (cfg: AppConfig) => Promise<void> });

export function listParsers(): string[] {
  return Array.from(registry.keys());
}

export function selectParser(key: string): Parser {
  const k = String(key || '').toLowerCase();
  const p = registry.get(k);
  if (!p) {
    const known = listParsers().join(', ') || '<none>';
    throw new Error(`Unknown PARSER_TYPE="${key}". Known: ${known}`);
  }
  return p;
}
