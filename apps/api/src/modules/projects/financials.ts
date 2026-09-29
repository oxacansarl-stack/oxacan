import { OFFICE_ROLES } from '../../common/decorators/roles.decorator';

/**
 * Field roles (TEAM_LEADER, WORKER) may see projects, lots and tasks but not their money
 * (budgets, costs, hourly rates). Every monetary field in OXACAN is an integer in CHF
 * centimes whose name ends in `Cents`, so redaction is a deep strip of those keys.
 */
export function canSeeFinancials(role: string | undefined): boolean {
  return !!role && OFFICE_ROLES.includes(role);
}

/** Returns `value` unchanged for office roles, otherwise a deep copy without `*Cents` keys. */
export function redactFinancials<T>(value: T, role: string | undefined): T {
  return canSeeFinancials(role) ? value : (stripCents(value, new WeakMap()) as T);
}

function stripCents(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(stripCents(item, seen));
    return out;
  }

  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, v] of Object.entries(value)) {
    if (key.endsWith('Cents')) continue;
    out[key] = stripCents(v, seen);
  }
  return out;
}
