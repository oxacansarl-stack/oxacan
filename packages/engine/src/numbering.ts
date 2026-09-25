/**
 * Numérotation des factures (Q20) : suite chronologique sans rupture injustifiée.
 * Une facture émise ne se modifie pas : elle se corrige par un avoir.
 * Format : {préfixe}-{année}-{séquence sur 5 chiffres}, ex. F-2026-00042, AV-2026-00007.
 */
export type DocumentKind = 'invoice' | 'credit_note' | 'offer' | 'situation';

const PREFIX: Record<DocumentKind, string> = { invoice: 'F', credit_note: 'AV', offer: 'O', situation: 'S' };

export function formatDocumentNumber(kind: DocumentKind, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be a positive integer');
  return `${PREFIX[kind]}-${year}-${String(sequence).padStart(5, '0')}`;
}

/** Vérifie qu'une liste de numéros émis est continue (aucun trou). Retourne les trous détectés. */
export function findGaps(sequences: number[]): number[] {
  const sorted = [...new Set(sequences)].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!, cur = sorted[i]!;
    for (let n = prev + 1; n < cur; n++) gaps.push(n);
  }
  return gaps;
}
