import { applyDecorators } from '@nestjs/common';
import { IsInt, IsUrl, Max, Min, ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

/** A real calendar day as YYYY-MM-DD within 1900–2100 (rejects 2026-02-30, 0001-01-01, 9999-12-31). */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Calendar date as YYYY-MM-DD (DATE columns). Use @IsISO8601() for timestamps. */
export const IsIsoDate = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isIsoDate',
      validator: {
        validate: isCalendarDate,
        defaultMessage: buildMessage((p) => `${p}$property must be a real date in YYYY-MM-DD format (1900–2100)`, options),
      },
    },
    options,
  );

/**
 * Link to a stored file (plan, receipt, photo): https only, with a real host. Rules out
 * javascript:, data:, file:, plain http and bare internal addresses (e.g. 169.254.169.254).
 */
export const IsHttpsUrl = (options?: ValidationOptions) =>
  IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true, allow_underscores: true }, options);

/** Non-negative amount in CHF centimes (max 1 billion CHF). */
export const IsCents = () => applyDecorators(IsInt(), Min(0), Max(100_000_000_000));

/** Signed amount in CHF centimes, for adjustments and credit notes. */
export const IsSignedCents = () =>
  applyDecorators(IsInt(), Min(-100_000_000_000), Max(100_000_000_000));
