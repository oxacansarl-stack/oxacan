import { describe, it, expect } from 'vitest';
import { isQRReferenceValid } from 'swissqrbill/utils';
import { buildQrBill, qrReference } from '../src/modules/documents/qr-bill';

const creditor = { name: 'Demo Bau AG', addressLine1: 'Avenue de la Gare 12', postalCode: '1003', city: 'Lausanne', country: 'CH' };

describe('QR-bill data', () => {
  it('derives a valid, distinct 27-digit QR reference from the invoice number', () => {
    for (const n of ['2026-001', '2026-1000', '2027-042']) {
      const ref = qrReference(n);
      expect(ref).toHaveLength(27);
      expect(isQRReferenceValid(ref)).toBe(true);
    }
    expect(qrReference('2026-001')).not.toBe(qrReference('2026-002'));
  });

  it('uses a QR reference with a QR-IBAN, and the invoice number as message with a plain IBAN', () => {
    const qr = buildQrBill({ iban: 'CH4431999123000889012', creditor, debtor: null, amountCents: 736135, invoiceNumber: '2026-001' });
    if (!('data' in qr)) throw new Error(qr.unavailable);
    expect(qr.data.amount).toBe(7361.35);
    expect(isQRReferenceValid(qr.data.reference!)).toBe(true);

    const plain = buildQrBill({ iban: 'CH9300762011623852957', creditor, debtor: null, amountCents: 100, invoiceNumber: '2026-001' });
    if (!('data' in plain)) throw new Error(plain.unavailable);
    expect(plain.data.reference).toBeUndefined();
    expect(plain.data.message).toBe('Facture 2026-001');
  });

  it('explains why no QR-bill can be produced', () => {
    expect(buildQrBill({ iban: null, creditor, debtor: null, amountCents: 100, invoiceNumber: 'x' })).toHaveProperty('unavailable');
    expect(
      buildQrBill({ iban: 'CH4431999123000889012', creditor: { name: 'X' }, debtor: null, amountCents: 100, invoiceNumber: 'x' }),
    ).toHaveProperty('unavailable');
    expect(buildQrBill({ iban: 'CH4431999123000889012', creditor, debtor: null, amountCents: 0, invoiceNumber: 'x' })).toHaveProperty('unavailable');
  });
});
