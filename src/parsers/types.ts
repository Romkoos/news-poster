// src/parsers/types.ts
// Generic parser plugin interface to allow multiple interchangeable parsers.

import type { AppConfig } from '../shared/config';

export type Parser = {
  name: string;
  run: (config: AppConfig) => Promise<void>;
};
