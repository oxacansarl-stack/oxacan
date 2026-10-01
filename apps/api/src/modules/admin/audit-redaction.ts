/**
 * Turns a request body into what audit_log.new_values may hold: sensitive fields redacted at any
 * depth, IBANs masked inside free text, binary data replaced by its size, and the whole thing
 * bounded in size. Pure (no Nest / TypeORM imports) so it can be unit-tested directly.
 */

/** Field names whose value is never stored (passwords, tokens, secrets, IBAN / QR-IBAN, keys, signatures). */
export const SENSITIVE_KEY_RE = /pass|token|secret|iban|key|signature/i;

export const REDACTED = '[REDACTED]';
export const REDACTED_IBAN = '[REDACTED_IBAN]';

/** Largest new_values document stored, as JSON characters. */
export const MAX_AUDIT_CHARS = 32_768;
export const MAX_DEPTH = 8;
export const MAX_ARRAY_ITEMS = 100;
export const MAX_OBJECT_KEYS = 200;
export const MAX_STRING_CHARS = 2_000;

// A candidate IBAN: country code, check digits, then 11–30 alphanumerics, optionally grouped by 4
// with single spaces (as printed). Candidates are confirmed with the ISO 13616 mod-97 check, so
// article codes and references that merely look similar are left alone.
const IBAN_CANDIDATE_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/gi;

/** ISO 13616 check: rearranged, letters to numbers, the remainder mod 97 must be 1. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/ /g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** Replaces every valid IBAN (spaced or not) in a text with a marker. */
export function maskIbans(text: string): string {
  return text.replace(IBAN_CANDIDATE_RE, (m) => {
    // The candidate can swallow a following word ("CH93…957 et"): trim to the longest valid prefix.
    if (isValidIban(m)) return REDACTED_IBAN;
    for (let end = m.length - 1; end >= 15; end--) {
      const prefix = m.slice(0, end).trimEnd();
      if (isValidIban(prefix)) return REDACTED_IBAN + m.slice(prefix.length);
    }
    return m;
  });
}

function sanitiseString(s: string): string {
  // Mask before truncating so an IBAN cut at the limit cannot leak; slack covers its length.
  const head = s.length > MAX_STRING_CHARS + 64 ? s.slice(0, MAX_STRING_CHARS + 64) : s;
  const masked = maskIbans(head);
  if (s.length <= MAX_STRING_CHARS && masked.length <= MAX_STRING_CHARS) return masked;
  return `${masked.slice(0, MAX_STRING_CHARS)}… [${s.length} chars]`;
}

function isBinary(v: unknown): v is ArrayBufferView | ArrayBuffer {
  return Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
      return sanitiseString(value);
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isBinary(value)) return { _binary: true, bytes: value.byteLength };
  if (typeof (value as { pipe?: unknown }).pipe === 'function') return { _stream: true };

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_ARRAY_ITEMS).map((v) => walk(v, depth + 1, seen) ?? null);
      if (obj.length > MAX_ARRAY_ITEMS) out.push(`[${obj.length - MAX_ARRAY_ITEMS} more items]`);
      return out;
    }
    const toJSON = (obj as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return walk(toJSON.call(obj), depth + 1, seen);

    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      const v = (obj as Record<string, unknown>)[key];
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = v === null || v === undefined ? null : REDACTED;
        continue;
      }
      const clean = walk(v, depth + 1, seen);
      if (clean !== undefined) out[key] = clean;
    }
    if (keys.length > MAX_OBJECT_KEYS) out._omittedKeys = keys.length - MAX_OBJECT_KEYS;
    return out;
  } finally {
    seen.delete(obj);
  }
}

/**
 * The audit-safe form of a request body, or null when there is none. Non-object bodies are
 * wrapped as { value }. A result larger than MAX_AUDIT_CHARS is replaced by a summary.
 */
export function sanitiseForAudit(body: unknown): Record<string, unknown> | null {
  if (body === null || body === undefined) return null;
  const clean = walk(body, 0, new WeakSet());
  const doc: Record<string, unknown> =
    clean && typeof clean === 'object' && !Array.isArray(clean)
      ? (clean as Record<string, unknown>)
      : { value: clean ?? null };

  const json = JSON.stringify(doc);
  if (json.length <= MAX_AUDIT_CHARS) return doc;
  return {
    _truncated: true,
    chars: json.length,
    keys: Object.keys(doc).slice(0, 50),
  };
}
