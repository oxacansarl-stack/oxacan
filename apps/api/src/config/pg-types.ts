import { types } from 'pg';

// Money is stored as BIGINT centimes. pg returns int8 as strings by default; parse to number,
// which is exact up to 2^53 centimes (~CHF 90 trillion). Fail loudly rather than lose precision.
types.setTypeParser(types.builtins.INT8, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 value ${value} exceeds the safe integer range`);
  return n;
});
