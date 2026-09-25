/**
 * Arithmétique monétaire en CHF.
 * Tous les montants internes sont des nombres en centimes entiers (integer cents)
 * pour éviter les erreurs binaires (0.1 + 0.2). La conversion vers CHF décimal
 * n'a lieu qu'à l'affichage ou à l'export.
 */
export type Cents = number;

export const chfToCents = (chf: number): Cents => Math.round(chf * 100);
export const centsToChf = (c: Cents): number => c / 100;

/** Arrondi commercial au centime (half away from zero). */
export function roundCents(value: number): Cents {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Arrondi suisse aux 5 centimes (ordonnance sur l'indication des prix).
 * Appliqué uniquement au total d'un document (offre, facture), jamais aux lignes.
 */
export function roundToFiveCents(c: Cents): Cents {
  return Math.round(c / 5) * 5;
}

/** Applique un pourcentage (ex. 8.1) à un montant en centimes et arrondit au centime. */
export function applyPercent(c: Cents, percent: number): Cents {
  return roundCents((c * percent) / 100);
}

/** Applique un facteur multiplicatif (ex. 1.2) et arrondit au centime. */
export function applyFactor(c: Cents, factor: number): Cents {
  return roundCents(c * factor);
}

export function formatChf(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${sign}CHF ${grouped}.${frac}`;
}
