import fr from './fr';

/**
 * Minimal i18n layer (no runtime dependency, Hermes-safe).
 *  - t('home.greeting', { name }) with {{param}} interpolation
 *  - plurals: pass `count`; `key_one` (0 and 1, French rule) / `key_other` are tried first
 * To add German (V2): create de.ts with the same shape and register it below.
 */
type Params = Record<string, string | number>;
type Tree = { [key: string]: string | Tree };

const dictionaries: Record<string, Tree> = { fr };
let locale = 'fr';

export function setLocale(next: string): void {
  if (dictionaries[next]) locale = next;
}

export function getLocale(): string {
  return locale;
}

function lookup(key: string): string | undefined {
  let node: string | Tree | undefined = dictionaries[locale];
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function pluralSuffix(count: number): '_one' | '_other' {
  // French: 0 and 1 are singular. (German/English: only 1.)
  if (locale === 'fr') return Math.abs(count) < 2 ? '_one' : '_other';
  return count === 1 ? '_one' : '_other';
}

function resolve(key: string, params?: Params): string | undefined {
  if (params && typeof params.count === 'number') {
    const plural = lookup(key + pluralSuffix(params.count));
    if (plural !== undefined) return plural;
  }
  return lookup(key);
}

export function exists(key: string, params?: Params): boolean {
  return resolve(key, params) !== undefined;
}

/** Translated string; returns the key itself when missing (visible in dev, never crashes). */
export function t(key: string, params?: Params): string {
  const template = resolve(key, params) ?? key;
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/** Label for a DB status value, e.g. statusLabel('task', 'done') → "Terminée"; unknown values pass through. */
export function statusLabel(domain: string, value: string | null | undefined): string {
  if (!value) return t('state.notAvailable');
  const key = `status.${domain}.${value}`;
  return exists(key) ? t(key) : value;
}

/** Label for a role, e.g. roleLabel('WORKER') → "Ouvrier". */
export function roleLabel(role: string): string {
  const key = `role.${role}`;
  return exists(key) ? t(key) : role;
}
