import i18n from '../i18n';
import { ApiError } from './api';

/**
 * French message for any failure: business rules and error codes are translated;
 * anything unknown falls back to a generic message rather than raw English server text.
 */
export function errorMessage(err: unknown, fallback?: string): string {
  const t = (key: string) => i18n.t(key, { ns: 'common' });
  if (err instanceof ApiError) {
    const rule = typeof err.details?.rule === 'string' ? err.details.rule : undefined;
    if (rule && i18n.exists(`errors.rule.${rule}`, { ns: 'common' })) return t(`errors.rule.${rule}`);
    if (err.code && i18n.exists(`errors.code.${err.code}`, { ns: 'common' })) return t(`errors.code.${err.code}`);
    return fallback ?? t('errors.generic');
  }
  if (err instanceof TypeError) return t('errors.network');
  return fallback ?? t('errors.generic');
}
