import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NotFoundError } from '@oxacan/shared-types';
import { Company } from '../company/entities/company.entity';
import { Client } from '../crm/entities/client.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { InvoiceLine } from '../invoicing/entities/invoice-line.entity';
import { Offer } from '../offers/entities/offer.entity';
import { OfferLine } from '../offers/entities/offer-line.entity';
import { OfferAssumption } from '../offers/entities/offer-assumption.entity';
import { SiteMeeting } from '../meetings/entities/site-meeting.entity';
import { Party, safeFilename, Sender } from './pdf-layout';
import { renderInvoice } from './invoice-document';
import { renderOffer } from './offer-document';
import { renderMeetingMinutes } from './meeting-document';

export interface RenderedDocument {
  filename: string;
  content: Buffer;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly dataSource: DataSource) {}

  async invoicePdf(companyId: string, id: string): Promise<RenderedDocument> {
    const invoice = await this.dataSource.getRepository(Invoice).findOne({
      where: { id, companyId },
      relations: ['project', 'client', 'referenceInvoice'],
    });
    if (!invoice) throw new NotFoundError('Invoice', id);
    const lines = await this.dataSource.getRepository(InvoiceLine).find({
      where: { invoiceId: id, companyId },
      order: { sortOrder: 'ASC' },
    });
    const company = await this.company(companyId);

    const content = await renderInvoice({
      sender: sender(company),
      iban: company.iban,
      paymentTermsDays: company.defaultPaymentTermsDays,
      client: invoice.client ? party(invoice.client) : null,
      project: invoice.project ? { reference: invoice.project.reference, name: invoice.project.name } : null,
      invoice: {
        ...invoice,
        vatRate: Number(invoice.vatRate),
        referenceInvoiceNumber: invoice.referenceInvoice?.invoiceNumber ?? null,
      },
      lines: lines.map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        cumulativeQuantity: l.cumulativeQuantity == null ? null : Number(l.cumulativeQuantity),
        previousQuantity: l.previousQuantity == null ? null : Number(l.previousQuantity),
        periodQuantity: l.periodQuantity == null ? null : Number(l.periodQuantity),
      })),
    });
    const prefix = invoice.type === 'credit_note' ? 'Note-de-credit' : 'Facture';
    return { filename: safeFilename(prefix, invoice.invoiceNumber), content };
  }

  async offerPdf(companyId: string, id: string): Promise<RenderedDocument> {
    const offer = await this.dataSource.getRepository(Offer).findOne({ where: { id, companyId }, relations: ['client'] });
    if (!offer) throw new NotFoundError('Offer', id);
    const [lines, assumptions, company] = await Promise.all([
      this.dataSource.getRepository(OfferLine).find({
        where: { offerId: id, companyId },
        order: { sortOrder: 'ASC', positionNumber: 'ASC' },
      }),
      this.dataSource.getRepository(OfferAssumption).find({ where: { offerId: id, companyId }, order: { createdAt: 'ASC' } }),
      this.company(companyId),
    ]);

    const content = await renderOffer({
      sender: sender(company),
      client: offer.client ? party(offer.client) : null,
      offer: {
        ...offer,
        vatRate: Number(offer.vatRate),
        marginFactor: Number(offer.marginFactor),
        date: offer.submittedAt ?? offer.createdAt,
      },
      lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
      assumptions,
    });
    return { filename: safeFilename('Offre', offer.reference ?? offer.projectName), content };
  }

  async meetingPdf(companyId: string, id: string): Promise<RenderedDocument> {
    const meeting = await this.dataSource.getRepository(SiteMeeting).findOne({
      where: { id, companyId },
      relations: ['project', 'attendees', 'actions'],
    });
    if (!meeting) throw new NotFoundError('SiteMeeting', id);
    const company = await this.company(companyId);
    const p = meeting.project;

    const content = await renderMeetingMinutes({
      sender: sender(company),
      project: {
        reference: p.reference,
        name: p.name,
        address: [p.address, [p.postalCode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      },
      meeting,
      attendees: meeting.attendees ?? [],
      actions: [...(meeting.actions ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    });
    return { filename: safeFilename('PV-chantier', meeting.meetingNumber, p.reference), content };
  }

  private async company(companyId: string): Promise<Company> {
    const company = await this.dataSource.getRepository(Company).findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundError('Company', companyId);
    return company;
  }
}

function sender(c: Company): Sender {
  return {
    name: c.legalName || c.name,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    vatNumber: c.vatNumber,
    phone: c.phone,
    email: c.email,
    website: c.website,
  };
}

function party(c: Client): Party {
  return {
    name: c.name,
    contact: c.contactPerson,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
  };
}
