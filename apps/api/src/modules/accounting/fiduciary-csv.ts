/**
 * Fiduciary export CSV format (PRD §17.2–17.5). Pure functions: no DB access.
 *
 *  - UTF-8 with BOM, ';' separator, '.' decimal separator, ISO 8601 dates, CRLF line endings
 *  - text quoted with "…" when it contains ';' (also '"' / line breaks, so the file stays parseable)
 *  - text that a spreadsheet would run as a formula is neutralised (OWASP CSV injection)
 */

export const CSV_BOM = '﻿';
export const CSV_EOL = '\r\n';
export const CSV_SEPARATOR = ';';

/** §17.3 `heures_employes_YYYY-MM.csv` */
export const HEURES_COLUMNS = [
  'date',
  'employe_nom',
  'employe_id',
  'projet_ref',
  'projet_nom',
  'heures_normales',
  'heures_supplementaires',
  'heures_deplacement',
  'heures_total',
  'taux_horaire',
  'montant_total',
  'remarque',
] as const;

/** §17.4 `frais_debours_YYYY-MM.csv` */
export const FRAIS_COLUMNS = [
  'date',
  'employe_nom',
  'employe_id',
  'projet_ref',
  'projet_nom',
  'categorie',
  'description',
  'montant_ht',
  'tva_taux',
  'tva_montant',
  'montant_ttc',
  'ref_justificatif',
] as const;

/** §17.5 `resume_projets_YYYY-MM.csv` */
export const RESUME_COLUMNS = [
  'projet_ref',
  'projet_nom',
  'periode',
  'total_heures',
  'cout_main_oeuvre',
  'cout_materiel',
  'cout_deplacement',
  'cout_sous_traitance',
  'cout_divers',
  'cout_total',
] as const;

export const FIDUCIARY_FILES = ['heures_employes', 'frais_debours', 'resume_projets'] as const;
export type FiduciaryFile = (typeof FIDUCIARY_FILES)[number];

/** §17.4 `categorie` enum. */
export const FIDUCIARY_CATEGORIES = ['materiel', 'deplacement', 'equipement', 'sous-traitance', 'divers'] as const;
export type FiduciaryCategory = (typeof FIDUCIARY_CATEGORIES)[number];

/**
 * expense.category (DB CHECK constraint) → §17.4 enum. Per diem (indemnités de repas en
 * déplacement) is a travel cost for the fiduciary; anything unknown falls back to `divers`.
 */
export const EXPENSE_CATEGORY_MAP: Record<string, FiduciaryCategory> = {
  material: 'materiel',
  travel: 'deplacement',
  per_diem: 'deplacement',
  equipment_rental: 'equipement',
  subcontractor: 'sous-traitance',
  other: 'divers',
};

export function toFiduciaryCategory(dbCategory: string): FiduciaryCategory {
  return EXPENSE_CATEGORY_MAP[dbCategory] ?? 'divers';
}

/** DB categories that map to one of the given §17.4 categories (used for the ?category filter). */
export function dbCategoriesFor(category: FiduciaryCategory): string[] {
  return Object.entries(EXPENSE_CATEGORY_MAP)
    .filter(([, c]) => c === category)
    .map(([k]) => k);
}

/** Cents → "1234.50" (dot decimal separator, no thousands separator). */
export function formatAmount(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Minutes → decimal hours with two decimals ("7.50"). */
export function formatHours(minutes: number): string {
  return formatAmount(Math.round(((Number(minutes) || 0) * 100) / 60));
}

/**
 * Text cell. Text that a spreadsheet would read as a formula (=, +, -, @, tab, CR) gets a
 * leading apostrophe so Excel shows it instead of running it (OWASP CSV injection).
 */
export function escapeCsvField(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (v.includes(';') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** BOM + header + rows, every line (header included) terminated by CRLF. */
export function buildCsv(columns: readonly string[], rows: string[][]): string {
  return CSV_BOM + [columns.join(CSV_SEPARATOR), ...rows.map((r) => r.join(CSV_SEPARATOR))].join(CSV_EOL) + CSV_EOL;
}

/**
 * Period label used in file names (§17.3–17.5 `_YYYY-MM`). A range inside one calendar month
 * gives `2026-09`; a longer range gives `2026-01_2026-03`.
 */
export function periodLabel(dateFrom: string, dateTo: string): string {
  const a = dateFrom.slice(0, 7);
  const b = dateTo.slice(0, 7);
  return a === b ? a : `${a}_${b}`;
}

export function fiduciaryFilename(file: FiduciaryFile, dateFrom: string, dateTo: string): string {
  return `${file}_${periodLabel(dateFrom, dateTo)}.csv`;
}
