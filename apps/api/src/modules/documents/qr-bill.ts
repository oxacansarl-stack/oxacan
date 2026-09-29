import type { Data } from 'swissqrbill/types';
import { calculateQRReferenceChecksum, isIBANValid, isQRIBAN } from 'swissqrbill/utils';
import type { Party } from './pdf-layout';

export interface QrBillInput {
  iban: string | null;
  creditor: Party;
  debtor: Party | null;
  amountCents: number;
  invoiceNumber: string;
}

export type QrBillResult = { data: Data } | { unavailable: string };

/**
 * Builds Swiss QR-bill data. A QR-IBAN requires a QR reference (derived from the invoice number,
 * unique per creditor); a regular IBAN carries the invoice number as unstructured message.
 */
export function buildQrBill(input: QrBillInput): QrBillResult {
  const { iban, creditor, debtor, amountCents, invoiceNumber } = input;
  if (!iban || !isIBANValid(iban)) {
    return { unavailable: "QR-facture indisponible : saisissez l'IBAN de l'entreprise dans les paramètres." };
  }
  const creditorAddress = toQrAddress(creditor);
  if (!creditorAddress) {
    return { unavailable: "QR-facture indisponible : complétez l'adresse de l'entreprise (rue, NPA, localité)." };
  }
  if (amountCents <= 0) {
    return { unavailable: 'Aucun montant à payer.' };
  }

  const data: Data = {
    currency: 'CHF',
    amount: amountCents / 100,
    creditor: { ...creditorAddress, account: iban },
    message: `Facture ${invoiceNumber}`,
  };
  const debtorAddress = debtor ? toQrAddress(debtor) : null;
  if (debtorAddress) data.debtor = debtorAddress;
  if (isQRIBAN(iban)) data.reference = qrReference(invoiceNumber);
  return { data };
}

/** 27-digit QR reference: invoice number digits, zero-padded to 26, plus the mod-10 check digit. */
export function qrReference(invoiceNumber: string): string {
  const digits = invoiceNumber.replace(/\D/g, '').slice(-26);
  const base = digits.padStart(26, '0');
  return base + calculateQRReferenceChecksum(base);
}

function toQrAddress(p: Party) {
  if (!p.addressLine1 || !p.postalCode || !p.city) return null;
  return {
    name: p.name.slice(0, 70),
    address: p.addressLine1.slice(0, 70),
    zip: p.postalCode,
    city: p.city.slice(0, 35),
    country: (p.country || 'CH').toUpperCase(),
  };
}
