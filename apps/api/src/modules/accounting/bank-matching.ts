import { qrReference } from '../documents/qr-bill';
import { normalizeReference } from './bank-statement-parser';

/**
 * Suggested matches between incoming bank statement lines and receivables (PRD §16.2
 * "Rapprochement — lettrage des paiements avec les factures"). Pure functions.
 *
 * Two kinds of candidates for a credit line (amount > 0, CHF):
 *  - a payment already recorded on an invoice and not yet linked to a bank line: same amount,
 *    payment date within PAYMENT_DATE_WINDOW_DAYS of the booking (or value) date;
 *  - an open invoice (sent / partially paid / overdue, outstanding > 0): its QR reference equals
 *    the line's structured reference, or its invoice number appears in the remittance text, or the
 *    amount equals the outstanding amount exactly (booked on or after the issue date). A line never
 *    exceeds the outstanding amount (that would be an overpayment the invoicing service refuses).
 * An invoice that already has a matching unlinked payment for the line is offered as that payment
 * only, so confirming cannot record the same receipt twice.
 */

export const PAYMENT_DATE_WINDOW_DAYS = 10;
export const MAX_CANDIDATES = 5;

const SCORE = {
  qrReference: 100,
  invoiceNumber: 70,
  exactAmount: 40,
  paymentAmount: 50,
  paymentDateClose: 30, // ≤ 2 days
  paymentDateNear: 15, // ≤ PAYMENT_DATE_WINDOW_DAYS
  dueDateNear: 10, // amount-only invoice match booked within 15 days of the due date
} as const;

export type MatchReason = 'qr_reference' | 'invoice_number' | 'amount' | 'date';
export type MatchConfidence = 'high' | 'medium' | 'low';

export interface MatchLine {
  id: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string | null;
  reference: string | null;
  remittanceInfo: string | null;
}

export interface MatchPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  paymentDate: string;
  reference: string | null;
}

export interface MatchInvoice {
  id: string;
  invoiceNumber: string;
  clientName: string | null;
  issueDate: string;
  dueDate: string | null;
  totalTtcCents: number;
  outstandingCents: number;
}

export interface MatchCandidate {
  kind: 'payment' | 'invoice';
  paymentId: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string | null;
  /** Payment amount, or the invoice's outstanding amount. */
  amountCents: number;
  /** Payment date, or the invoice's due date (issue date when there is none). */
  date: string;
  score: number;
  confidence: MatchConfidence;
  reasons: MatchReason[];
}

export interface LineSuggestion {
  lineId: string;
  candidates: MatchCandidate[];
  /** The best candidate when it is high-confidence and not tied with the next one. */
  best: MatchCandidate | null;
}

const DAY_MS = 86_400_000;
function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

function confidence(score: number): MatchConfidence {
  if (score >= 100) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

/** QR reference the invoicing prints for an invoice number (null when the number has no digits). */
export function invoiceQrReference(invoiceNumber: string): string | null {
  return /\d/.test(invoiceNumber) ? qrReference(invoiceNumber) : null;
}

/** True when `text` contains the invoice number as a whole token (case-insensitive). */
export function mentionsInvoiceNumber(text: string | null, invoiceNumber: string): boolean {
  if (!text || !invoiceNumber.trim()) return false;
  const escaped = invoiceNumber.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, 'i').test(text);
}

export function isMatchableLine(line: MatchLine): boolean {
  return line.amountCents > 0 && (!line.currency || line.currency.toUpperCase() === 'CHF');
}

export function suggestMatches(
  lines: MatchLine[],
  payments: MatchPayment[],
  invoices: MatchInvoice[],
): LineSuggestion[] {
  const qrOf = new Map(invoices.map((inv) => [inv.id, invoiceQrReference(inv.invoiceNumber)]));
  const clientOf = new Map(invoices.map((inv) => [inv.id, inv.clientName]));

  return lines.map((line) => {
    if (!isMatchableLine(line)) return { lineId: line.id, candidates: [], best: null };
    const ref = normalizeReference(line.reference);
    const candidates: MatchCandidate[] = [];

    /* ── Recorded payments not yet linked to a bank line ── */
    for (const p of payments) {
      if (p.amountCents !== line.amountCents) continue;
      const days = Math.min(
        daysBetween(line.bookingDate, p.paymentDate),
        line.valueDate ? daysBetween(line.valueDate, p.paymentDate) : Infinity,
      );
      if (days > PAYMENT_DATE_WINDOW_DAYS) continue;
      const reasons: MatchReason[] = ['amount', 'date'];
      let score = SCORE.paymentAmount + (days <= 2 ? SCORE.paymentDateClose : SCORE.paymentDateNear);
      const qr = qrOf.get(p.invoiceId) ?? invoiceQrReference(p.invoiceNumber);
      if (ref && (ref === qr || ref === normalizeReference(p.reference))) {
        score += SCORE.qrReference;
        reasons.unshift('qr_reference');
      } else if (mentionsInvoiceNumber(line.remittanceInfo, p.invoiceNumber)) {
        score += SCORE.invoiceNumber;
        reasons.unshift('invoice_number');
      }
      candidates.push({
        kind: 'payment', paymentId: p.id, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber,
        clientName: clientOf.get(p.invoiceId) ?? null, amountCents: p.amountCents, date: p.paymentDate,
        score, confidence: confidence(score), reasons,
      });
    }
    const coveredByPayment = new Set(candidates.map((c) => c.invoiceId));

    /* ── Open invoices ── */
    for (const inv of invoices) {
      if (coveredByPayment.has(inv.id)) continue;
      if (line.amountCents > inv.outstandingCents) continue;
      const refMatch = !!ref && ref === qrOf.get(inv.id);
      const numberMatch = !refMatch && mentionsInvoiceNumber(line.remittanceInfo, inv.invoiceNumber);
      const exact = line.amountCents === inv.outstandingCents;
      if (!refMatch && !numberMatch && !exact) continue;

      const reasons: MatchReason[] = [];
      let score = 0;
      if (refMatch) {
        score += SCORE.qrReference;
        reasons.push('qr_reference');
      }
      if (numberMatch) {
        score += SCORE.invoiceNumber;
        reasons.push('invoice_number');
      }
      if (exact) {
        score += SCORE.exactAmount;
        reasons.push('amount');
      }
      if (!refMatch && !numberMatch) {
        // Amount only: a receipt booked before the invoice was issued is not its payment.
        if (line.bookingDate < inv.issueDate) continue;
        if (inv.dueDate && daysBetween(line.bookingDate, inv.dueDate) <= 15) {
          score += SCORE.dueDateNear;
          reasons.push('date');
        }
      }
      candidates.push({
        kind: 'invoice', paymentId: null, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        clientName: inv.clientName, amountCents: inv.outstandingCents, date: inv.dueDate ?? inv.issueDate,
        score, confidence: confidence(score), reasons,
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.invoiceNumber.localeCompare(b.invoiceNumber));
    const top = candidates.slice(0, MAX_CANDIDATES);
    const best = top[0] && top[0].confidence === 'high' && (!top[1] || top[1].score < top[0].score) ? top[0] : null;
    return { lineId: line.id, candidates: top, best };
  });
}
