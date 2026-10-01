/**
 * French texts of the financial alerts (PRD §15.6). They are shown verbatim in the UI.
 * Amounts are CHF centimes, written the Swiss way: CHF 12'345.60.
 */

export function formatChf(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const francs = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const centimes = (abs % 100).toString().padStart(2, '0');
  return `${sign}CHF ${francs}.${centimes}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

function projectLabel(p: { reference: string; name: string }): string {
  return `${p.reference} ${p.name}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function budgetDriftMessage(p: {
  reference: string;
  name: string;
  budgetCents: number;
  actualCents: number;
  thresholdPercent: number;
}) {
  const overrun = ((p.actualCents - p.budgetCents) / p.budgetCents) * 100;
  return {
    title: `Dérive financière : ${projectLabel(p)}`,
    body:
      `Les coûts réels (${formatChf(p.actualCents)}) dépassent le budget de l'offre ` +
      `(${formatChf(p.budgetCents)}) de ${formatPercent(overrun)}, ` +
      `au-delà du seuil de ${p.thresholdPercent} %.`,
  };
}

export function acompteOverdueMessage(i: {
  invoiceNumber: string;
  reference: string;
  name: string;
  totalCents: number;
  paidCents: number;
  dueDate: string;
}) {
  const due = i.totalCents - i.paidCents;
  const partial = i.paidCents > 0 ? `, dont ${formatChf(due)} restent dus` : '';
  return {
    title: `Acompte en retard : ${i.invoiceNumber}`,
    body:
      `L'acompte ${i.invoiceNumber} du projet ${projectLabel(i)} (${formatChf(i.totalCents)}${partial}) ` +
      `était échu le ${i.dueDate} et n'est pas entièrement payé.`,
  };
}

export function plusValueDetectedMessage(pv: {
  reference: string;
  name: string;
  description: string;
  amountCents: number;
}) {
  return {
    title: `Plus-value détectée : ${projectLabel(pv)}`,
    body:
      `Nouvelle plus-value de ${formatChf(pv.amountCents)} : ${truncate(pv.description, 300)}. ` +
      `Elle doit être chiffrée et validée par le client avant exécution.`,
  };
}

export function acompteDueMessage(a: {
  label: string | null;
  reference: string;
  name: string;
  contractReference: string;
  amountHtCents: number;
  dueDate: string;
}) {
  const what = a.label ? `« ${truncate(a.label, 80)} »` : 'prévu';
  return {
    title: `Acompte à émettre : ${a.reference}`,
    body:
      `L'acompte ${what} du contrat ${a.contractReference} (projet ${projectLabel(a)}, ` +
      `${formatChf(a.amountHtCents)} HT) était prévu le ${a.dueDate} et n'a pas encore été émis.`,
  };
}
