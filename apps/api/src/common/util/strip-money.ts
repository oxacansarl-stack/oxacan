import { OFFICE_ROLES } from '../decorators/roles.decorator';

/** Recursively drops `*Cents` properties; field roles must not see prices, costs or budgets. */
export function stripMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripMoney) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.endsWith('Cents'))
        .map(([key, v]) => [key, stripMoney(v)]),
    ) as T;
  }
  return value;
}

export function hidesMoneyFor(role: string): boolean {
  return !OFFICE_ROLES.includes(role);
}
