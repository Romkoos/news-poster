import { Router } from 'express';
import { requireAuth } from '../auth/jwt';
import {
  FilterApiShape,
  FilterInput,
  FilterAction,
  MatchType,
  listFilters,
  insertFilter,
  updateFilter,
  deleteFilter,
  getFilterById,
  hasActiveDuplicate,
  getSettings,
  patchSettings,
} from './db';

const router = Router();

// Protect all /filters* routes
router.use(requireAuth);

function isValidAction(a: any): a is FilterAction {
  return a === 'publish' || a === 'reject' || a === 'moderation';
}
function isValidMatchType(m: any): m is MatchType {
  return m === 'substring' || m === 'regex';
}

function validateFilterCandidate(input: Required<FilterInput>, excludeId?: string): { ok: true } | { ok:false; code:string } {
  const keyword = String(input.keyword ?? '').trim();
  if (keyword.length < 2) return { ok: false, code: 'keyword:required' };

  const pr = Number(input.priority);
  if (!Number.isInteger(pr) || pr < 1 || pr > 1000) return { ok: false, code: 'priority:range' };

  if (!isValidAction(input.action)) return { ok: false, code: 'internal' };

  const matchType: MatchType = isValidMatchType(input.matchType) ? input.matchType : 'substring';
  if (matchType === 'regex') {
    try {
      // u-flag as required
      // eslint-disable-next-line no-new
      new RegExp(keyword, 'u');
    } catch {
      return { ok: false, code: 'regex:invalid' };
    }
  }

  if (input.active === true) {
    if (hasActiveDuplicate(keyword, matchType, excludeId)) {
      return { ok: false, code: 'duplicate:active' };
    }
  }

  return { ok: true };
}

type ValidationResult = ReturnType<typeof validateFilterCandidate>;
function isInvalidValidationResult(v: ValidationResult): v is { ok:false; code:string } {
  return v.ok === false;
}

// GET /filters → Filter[]
router.get('/', (_req, res) => {
  try {
    const list = listFilters();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'internal' });
  }
});

// POST /filters (FilterInput) → Filter
router.post('/', (req, res) => {
  try {
    const body = (req.body ?? {}) as FilterInput;
    const candidate: Required<FilterInput> = {
      keyword: String(body.keyword ?? '').trim(),
      action: body.action as any,
      priority: Number(body.priority),
      matchType: (body.matchType as any) ?? 'substring',
      active: typeof body.active === 'boolean' ? body.active : true,
      notes: typeof body.notes === 'string' ? body.notes.trim() : undefined,
    } as any;

    const v = validateFilterCandidate(candidate);
    if (isInvalidValidationResult(v)) {
      return res.status(400).json({ error: v.code });
    }

    try {
      const created = insertFilter(candidate);
      return res.status(201).json(created);
    } catch (err: any) {
      const msg: string = String(err?.message || '');
      if (msg.includes('idx_filters_unique_active') || msg.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'duplicate:active' });
      }
      return res.status(500).json({ error: 'internal' });
    }
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

// PATCH /filters/:id (Partial<FilterInput>) → Filter
router.patch('/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const prev = getFilterById(id);
    if (!prev) return res.status(404).json({ error: 'notfound' });

    const patch = (req.body ?? {}) as Partial<FilterInput>;

    const merged: Required<FilterInput> = {
      keyword: (typeof patch.keyword === 'string' ? patch.keyword.trim() : prev.keyword),
      action: (patch.action ?? prev.action) as any,
      priority: Number(typeof patch.priority !== 'undefined' ? patch.priority : prev.priority),
      matchType: (patch.matchType ?? prev.matchType ?? 'substring') as any,
      active: typeof patch.active === 'boolean' ? patch.active : (prev.active ?? true),
      notes: typeof patch.notes === 'string' ? patch.notes.trim() : (prev.notes as any),
    };

    const v = validateFilterCandidate(merged, id);
    if (isInvalidValidationResult(v)) {
      return res.status(400).json({ error: v.code });
    }

    try {
      const updated = updateFilter(id, merged);
      if (!updated) return res.status(404).json({ error: 'notfound' });
      return res.json(updated satisfies FilterApiShape);
    } catch (err: any) {
      const msg: string = String(err?.message || '');
      if (msg.includes('idx_filters_unique_active') || msg.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'duplicate:active' });
      }
      return res.status(500).json({ error: 'internal' });
    }
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

// DELETE /filters/:id → 204
router.delete('/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const ok = deleteFilter(id);
    if (!ok) return res.status(404).json({ error: 'notfound' });
    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

// GET /filters/settings → { defaultAction }
router.get('/settings', (_req, res) => {
  try {
    const s = getSettings();
    res.json(s);
  } catch {
    res.status(500).json({ error: 'internal' });
  }
});

// PATCH /filters/settings (Partial<Settings>) → { defaultAction }
router.patch('/settings', (req, res) => {
  try {
    const body = req.body ?? {};
      console.log(body)
    if (typeof body.defaultAction !== 'undefined') {
      if (body.defaultAction !== 'publish' && body.defaultAction !== 'reject' && body.defaultAction !== 'moderation') {
        return res.status(400).json({ error: 'internal' });
      }
    }
    const s = patchSettings(body);
    res.json(s);
  } catch {
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
