import { applyDecorators } from '@nestjs/common';
import { IsInt, Matches, Max, Min } from 'class-validator';

/** Calendar date as YYYY-MM-DD (DATE columns). Use @IsISO8601() for timestamps. */
export const IsIsoDate = () =>
  Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: ({ property }) => `${property} must be a date in YYYY-MM-DD format`,
  });

/** Non-negative amount in CHF centimes (max 1 billion CHF). */
export const IsCents = () => applyDecorators(IsInt(), Min(0), Max(100_000_000_000));

/** Signed amount in CHF centimes, for adjustments and credit notes. */
export const IsSignedCents = () =>
  applyDecorators(IsInt(), Min(-100_000_000_000), Max(100_000_000_000));
