import type { NextFunction, Request, Response } from 'express';

/** Largest page any list returns; the biggest a controller already allowed. */
export const MAX_PAGE_SIZE = 500;

/**
 * Normalises ?page= and ?limit= for every list before controllers parse them: a value that is not
 * a positive integer is dropped (the list's default applies) and limit is capped. Without this a
 * negative, fractional or non-numeric value reached the query builder and caused a 500, and an
 * unbounded limit let one request load a whole table.
 */
export function paginationQuery(req: Request, _res: Response, next: NextFunction) {
  const q = req.query as Record<string, unknown>;
  for (const key of ['page', 'limit'] as const) {
    if (q[key] === undefined) continue;
    const n = Number(q[key]);
    if (typeof q[key] !== 'string' || !Number.isInteger(n) || n < 1) delete q[key];
    else q[key] = String(key === 'limit' ? Math.min(n, MAX_PAGE_SIZE) : Math.min(n, 1_000_000));
  }
  next();
}
