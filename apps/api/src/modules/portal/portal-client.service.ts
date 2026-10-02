import { createHash } from 'crypto';
import { todayInZurich } from '../../common/util/business-date';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { BusinessRuleError, NotFoundError, ValidationError } from '@oxacan/shared-types';
import { OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { Project } from '../projects/entities/project.entity';
import { Offer } from '../offers/entities/offer.entity';
import { OfferLine } from '../offers/entities/offer-line.entity';
import { OfferAssumption } from '../offers/entities/offer-assumption.entity';
import { OffersService } from '../offers/offers.service';
import { sellingLineCents, sellingUnitCents } from '../offers/offer-pricing';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { Plan } from '../plans/entities/plan.entity';
import { PlanFile } from '../plans/entities/plan-file.entity';
import { SiteMeeting } from '../meetings/entities/site-meeting.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService, RenderedDocument } from '../documents/documents.service';
import { addDays, chf } from '../documents/pdf-layout';
import { PortalComment } from './entities/portal-comment.entity';
import { PortalOfferDecision } from './entities/portal-offer-decision.entity';
import { PortalCommentDto, PortalOfferDecisionDto, OfferDecision } from './dto/portal-client.dto';
import type { PortalClientInfo, PortalContext } from './portal-access.guard';

/** Offer statuses the client has received. Drafts are internal; archived ones were superseded. */
export const PORTAL_OFFER_STATUSES = ['submitted', 'accepted', 'rejected'];
/** Line types printed with a price on the offer PDF; the others are listed without one. */
const PRICED_LINE_TYPES = ['BASE', 'OPTION', 'VARIANTE'];
/** Drafts never reached the client; only drafts can be cancelled. Credit notes stay 'draft' but are issued on creation. */
const UNISSUED_INVOICE_STATUSES = ['draft', 'cancelled'];
/** Comments a single link may post per hour (each one notifies the office). */
export const PORTAL_COMMENTS_PER_HOUR = 20;
/** The client is not an app user: the offer's updated_by stays empty, the decision row names the signer. */
const NO_APP_USER = null as unknown as string;


const isUniqueViolation = (err: unknown) => (err as { driverError?: { code?: string } })?.driverError?.code === '23505';

@Injectable()
export class PortalClientService {
  private readonly logger = new Logger(PortalClientService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(Offer) private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferLine) private readonly offerLineRepo: Repository<OfferLine>,
    @InjectRepository(OfferAssumption) private readonly assumptionRepo: Repository<OfferAssumption>,
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(PlanFile) private readonly planFileRepo: Repository<PlanFile>,
    @InjectRepository(SiteMeeting) private readonly meetingRepo: Repository<SiteMeeting>,
    @InjectRepository(PortalComment) private readonly commentRepo: Repository<PortalComment>,
    @InjectRepository(PortalOfferDecision) private readonly decisionRepo: Repository<PortalOfferDecision>,
    private readonly offers: OffersService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────────── Offers ───────────── */

  async listOffers(ctx: PortalContext) {
    const offers = await this.visibleOffers(ctx);
    if (offers.length === 0) return [];
    const ids = offers.map((o) => o.id);
    const [lines, assumptions, decisions] = await Promise.all([
      this.offerLineRepo.find({
        where: { companyId: ctx.companyId, offerId: In(ids) },
        order: { sortOrder: 'ASC', positionNumber: 'ASC' },
      }),
      this.assumptionRepo.find({ where: { companyId: ctx.companyId, offerId: In(ids) }, order: { createdAt: 'ASC' } }),
      this.decisionRepo.find({ where: { companyId: ctx.companyId, offerId: In(ids) } }),
    ]);
    return offers.map((o) => {
      const document = clientOffer(
        o,
        lines.filter((l) => l.offerId === o.id),
        assumptions.filter((a) => a.offerId === o.id),
      );
      const decision = decisions.find((d) => d.offerId === o.id) ?? null;
      const canRespond = o.status === 'submitted' && !decision;
      return {
        ...document,
        decision: decision
          ? {
              decision: decision.decision,
              signerName: decision.signerName,
              comment: decision.comment,
              decidedAt: decision.decidedAt,
              // The declaration that was agreed to: without it an answered offer cannot show the
              // client what their signature covered (§8.2).
              consentText: decision.consentText,
            }
          : null,
        canRespond,
        canAccept: canRespond && !isExpired(document.validUntil),
        // The declarations to show next to the consent box; the one agreed to is stored with the answer.
        consentTexts: canRespond ? { accepted: consentText(o, 'accepted'), rejected: consentText(o, 'rejected') } : null,
      };
    });
  }

  async offerPdf(ctx: PortalContext, offerId: string): Promise<RenderedDocument> {
    const [offer] = await this.visibleOffers(ctx, offerId);
    if (!offer) throw new NotFoundError('Offer', offerId);
    return this.documents.offerPdf(ctx.companyId, offer.id);
  }

  /**
   * Accepts or refuses a sent offer. The answer is stored first (one per offer: a concurrent second
   * answer fails on the unique key before touching the offer), then the offer goes through
   * OffersService.updateStatus and its transition rules; if that refuses, the answer is removed.
   */
  async decideOffer(ctx: PortalContext, offerId: string, dto: PortalOfferDecisionDto, client: PortalClientInfo) {
    const signerName = dto.signerName.trim().replace(/\s+/g, ' ');
    if (signerName.length < 2) throw new ValidationError('signerName must contain the signer’s name.');
    const comment = dto.comment?.trim() || null;

    const [offer] = await this.visibleOffers(ctx, offerId);
    if (!offer) throw new NotFoundError('Offer', offerId);
    if (offer.status !== 'submitted') {
      throw new BusinessRuleError(
        'OFFER_NOT_PENDING',
        `This offer is ${offer.status}: only a sent offer awaiting an answer can be accepted or refused.`,
      );
    }
    const [lines, assumptions] = await Promise.all([
      this.offerLineRepo.find({ where: { companyId: ctx.companyId, offerId }, order: { sortOrder: 'ASC', positionNumber: 'ASC' } }),
      this.assumptionRepo.find({ where: { companyId: ctx.companyId, offerId }, order: { createdAt: 'ASC' } }),
    ]);
    const document = clientOffer(offer, lines, assumptions);
    if (dto.decision === 'accepted' && isExpired(document.validUntil)) {
      throw new BusinessRuleError(
        'OFFER_EXPIRED',
        `This offer was valid until ${document.validUntil}. Ask for an updated offer.`,
      );
    }

    let decision: PortalOfferDecision;
    try {
      decision = await this.decisionRepo.save(
        this.decisionRepo.create({
          companyId: ctx.companyId,
          projectId: ctx.projectId,
          offerId,
          portalTokenId: ctx.tokenId,
          decision: dto.decision,
          signerName,
          consentText: consentText(offer, dto.decision),
          comment,
          offerReference: offer.reference,
          offerVersion: offer.version,
          offerTotalTtcCents: offer.totalTtcCents,
          offerDigest: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
          ipAddress: client.ip,
          userAgent: client.userAgent,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BusinessRuleError('OFFER_ALREADY_ANSWERED', 'This offer has already been answered.');
      }
      throw err;
    }

    let updated: Offer;
    try {
      updated = await this.offers.updateStatus(ctx.companyId, offerId, NO_APP_USER, dto.decision);
    } catch (err) {
      await this.decisionRepo.delete({ id: decision.id, companyId: ctx.companyId });
      throw err;
    }

    const label = offerLabel(offer);
    const verb = dto.decision === 'accepted' ? 'accepté' : 'refusé';
    await this.notifyOfficeSafely(ctx, {
      type: dto.decision === 'accepted' ? 'portal_offer_accepted' : 'portal_offer_rejected',
      title: `Offre ${label} ${dto.decision === 'accepted' ? 'acceptée' : 'refusée'} par le client`,
      body:
        `${signerName} a ${verb} l'offre ${label} (CHF ${chf(offer.totalTtcCents)} TTC) sur le portail client.` +
        (comment ? ` Commentaire : ${excerpt(comment)}` : ''),
      referenceType: 'offer',
      referenceId: offerId,
    });

    return {
      id: decision.id,
      offerId,
      decision: decision.decision,
      signerName: decision.signerName,
      comment: decision.comment,
      decidedAt: decision.decidedAt,
      consentText: decision.consentText,
      offerStatus: updated.status,
    };
  }

  /**
   * The project's offers as the client received them: the offer its contract was signed on, plus
   * the other versions / offers for the same client and project name, in a status the client saw.
   */
  private async visibleOffers(ctx: PortalContext, offerId?: string): Promise<Offer[]> {
    const project = await this.project(ctx);
    const names = [project.name];
    let contractOfferId: string | null = null;
    if (project.contractId) {
      const [row] = await this.dataSource.query(
        `SELECT o.id, o.project_name FROM contract c
           JOIN offer o ON o.company_id = c.company_id AND o.id = c.offer_id
          WHERE c.id = $1 AND c.company_id = $2`,
        [project.contractId, ctx.companyId],
      );
      if (row) {
        contractOfferId = row.id;
        names.push(row.project_name);
      }
    }

    const qb = this.offerRepo
      .createQueryBuilder('o')
      .where('o.company_id = :companyId', { companyId: ctx.companyId })
      .andWhere('o.status IN (:...statuses)', { statuses: PORTAL_OFFER_STATUSES })
      .andWhere(
        new Brackets((w) => {
          w.where('o.client_id = :clientId AND o.project_name IN (:...names)', { clientId: project.clientId, names });
          if (contractOfferId) w.orWhere('o.id = :contractOfferId', { contractOfferId });
        }),
      );
    if (offerId) qb.andWhere('o.id = :offerId', { offerId });
    return qb.orderBy('o.createdAt', 'DESC').getMany();
  }

  /* ───────────── Invoices & situations ───────────── */

  async listInvoices(ctx: PortalContext) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('i')
      .leftJoin('i.referenceInvoice', 'ref')
      .addSelect(['ref.id', 'ref.invoiceNumber'])
      .where('i.company_id = :companyId AND i.project_id = :projectId', ctx)
      .andWhere(`(i.type = 'credit_note' OR i.status NOT IN (:...unissued))`, { unissued: UNISSUED_INVOICE_STATUSES })
      .orderBy('i.issueDate', 'DESC')
      .addOrderBy('i.invoiceNumber', 'DESC')
      .getMany();
    const termsDays = await this.paymentTermsDays(ctx.companyId);
    const now = todayInZurich();

    return invoices.map((i) => {
      const isCredit = i.type === 'credit_note';
      const dueDate = isCredit ? null : addDays(i.dueDate ?? i.issueDate, i.dueDate ? 0 : termsDays);
      const paid = i.amountPaidCents ?? 0;
      return {
        id: i.id,
        type: i.type,
        invoiceNumber: i.invoiceNumber,
        situationNumber: i.situationNumber,
        referenceInvoiceNumber: i.referenceInvoice?.invoiceNumber ?? null,
        issueDate: addDays(i.issueDate, 0),
        dueDate,
        sentAt: i.sentAt,
        paidAt: i.paidAt,
        vatRate: i.vatRate,
        subtotalHtCents: i.subtotalHtCents,
        vatAmountCents: i.vatAmountCents,
        retentionAmountCents: i.retentionAmountCents ?? 0,
        priorAcomptesCents: i.priorAcomptesCents ?? 0,
        totalTtcCents: i.totalTtcCents,
        amountPaidCents: paid,
        amountDueCents: isCredit ? 0 : Math.max(0, i.totalTtcCents - paid),
        paymentStatus: paymentStatus(i, dueDate, now),
      };
    });
  }

  async invoicePdf(ctx: PortalContext, invoiceId: string): Promise<RenderedDocument> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, companyId: ctx.companyId, projectId: ctx.projectId },
      select: { id: true, type: true, status: true },
    });
    if (!invoice || (invoice.type !== 'credit_note' && UNISSUED_INVOICE_STATUSES.includes(invoice.status))) {
      throw new NotFoundError('Invoice', invoiceId);
    }
    return this.documents.invoicePdf(ctx.companyId, invoiceId);
  }

  /* ───────────── Shared documents ───────────── */

  /** Plans of the project that have an uploaded file, and the minutes (PV) of completed site meetings. */
  async listDocuments(ctx: PortalContext) {
    const [plans, meetings] = await Promise.all([
      this.dataSource.query(
        `SELECT p.id, p.name, p.version, p.floor, p.scale,
                f.content_type AS "contentType", f.size_bytes AS "sizeBytes", f.uploaded_at AS "uploadedAt"
           FROM plan p JOIN plan_file f ON f.company_id = p.company_id AND f.plan_id = p.id
          WHERE p.company_id = $1 AND p.project_id = $2
          ORDER BY p.name, p.version DESC`,
        [ctx.companyId, ctx.projectId],
      ),
      this.meetingRepo.find({
        where: { companyId: ctx.companyId, projectId: ctx.projectId, status: 'completed' },
        select: { id: true, meetingNumber: true, meetingDate: true, location: true },
        order: { meetingNumber: 'DESC' },
      }),
    ]);
    return { plans, meetings };
  }

  async planFile(ctx: PortalContext, planId: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    const plan = await this.planRepo.findOne({
      where: { id: planId, companyId: ctx.companyId, projectId: ctx.projectId },
      select: { id: true, name: true },
    });
    if (!plan) throw new NotFoundError('Plan', planId);
    const file = await this.planFileRepo
      .createQueryBuilder('f')
      .addSelect('f.data')
      .where('f.plan_id = :planId AND f.company_id = :companyId', { planId, companyId: ctx.companyId })
      .getOne();
    if (!file) throw new NotFoundError('PlanFile', planId);
    return { name: plan.name, contentType: file.contentType, data: file.data };
  }

  async meetingPdf(ctx: PortalContext, meetingId: string): Promise<RenderedDocument> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId, companyId: ctx.companyId, projectId: ctx.projectId, status: 'completed' },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundError('SiteMeeting', meetingId);
    return this.documents.meetingPdf(ctx.companyId, meetingId);
  }

  /* ───────────── Comments ───────────── */

  async listComments(ctx: PortalContext) {
    const rows = await this.commentRepo.find({
      where: { companyId: ctx.companyId, projectId: ctx.projectId },
      select: { id: true, authorName: true, body: true, createdAt: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.reverse();
  }

  async addComment(ctx: PortalContext, dto: PortalCommentDto, client: PortalClientInfo) {
    const authorName = dto.authorName.trim().replace(/\s+/g, ' ');
    const body = dto.body.trim();
    if (!authorName || !body) throw new ValidationError('authorName and body must not be blank.');
    const project = await this.project(ctx);

    return this.dataSource.transaction(async (m) => {
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM portal_comment
          WHERE company_id = $1 AND portal_token_id = $2 AND created_at > now() - interval '1 hour'`,
        [ctx.companyId, ctx.tokenId],
      );
      if (n >= PORTAL_COMMENTS_PER_HOUR) {
        throw new BusinessRuleError('COMMENT_LIMIT', 'Too many comments for now. Please try again later.');
      }
      const comment = await m.save(
        m.create(PortalComment, {
          companyId: ctx.companyId,
          projectId: ctx.projectId,
          portalTokenId: ctx.tokenId,
          authorName,
          body,
          ipAddress: client.ip,
          userAgent: client.userAgent,
        }),
      );
      await this.notifyOffice(m, ctx.companyId, project.managerId, {
        type: 'portal_comment',
        title: `Nouveau commentaire du client sur le projet ${[project.reference, project.name].filter(Boolean).join(' – ')}`,
        body: `${authorName} : ${excerpt(body)}`,
        referenceType: 'project',
        referenceId: project.id,
      });
      return { id: comment.id, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt };
    });
  }

  /* ───────────── Office side ───────────── */

  async officeComments(companyId: string, projectId: string) {
    await this.assertProject(companyId, projectId);
    return this.commentRepo.find({ where: { companyId, projectId }, order: { createdAt: 'ASC' } });
  }

  async officeOfferDecisions(companyId: string, projectId: string) {
    await this.assertProject(companyId, projectId);
    return this.decisionRepo.find({ where: { companyId, projectId }, order: { decidedAt: 'ASC' } });
  }

  /* ───────────── Helpers ───────────── */

  private async project(ctx: PortalContext): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: ctx.projectId, companyId: ctx.companyId },
      select: { id: true, reference: true, name: true, clientId: true, contractId: true, managerId: true },
    });
    if (!project) throw new NotFoundError('Project', ctx.projectId);
    return project;
  }

  private async assertProject(companyId: string, projectId: string) {
    const exists = await this.projectRepo.exists({ where: { id: projectId, companyId } });
    if (!exists) throw new NotFoundError('Project', projectId);
  }

  private async paymentTermsDays(companyId: string): Promise<number> {
    const [row] = await this.dataSource.query('SELECT default_payment_terms_days AS d FROM company WHERE id = $1', [companyId]);
    return Number(row?.d ?? 30);
  }

  /** The company's admins plus the project's manager (when an active office user), as for alerts. */
  private async notifyOffice(
    m: EntityManager,
    companyId: string,
    managerId: string | null,
    n: { type: string; title: string; body: string; referenceType: string; referenceId: string },
  ) {
    const office: { id: string; role: string }[] = await m.query(
      `SELECT id, role FROM app_user
        WHERE company_id = $1 AND is_active AND deactivated_at IS NULL AND role = ANY($2::text[])`,
      [companyId, OFFICE_ROLES],
    );
    for (const u of office) {
      if (u.role === 'ADMIN' || u.id === managerId) {
        await this.notifications.createNotification(companyId, { userId: u.id, ...n }, m);
      }
    }
  }

  /** After an offer answer is committed a failed notification must not turn it into an error. */
  private async notifyOfficeSafely(
    ctx: PortalContext,
    n: { type: string; title: string; body: string; referenceType: string; referenceId: string },
  ) {
    try {
      const project = await this.project(ctx);
      await this.dataSource.transaction((m) => this.notifyOffice(m, ctx.companyId, project.managerId, n));
    } catch (err) {
      this.logger.error(`Portal notification ${n.type} for ${n.referenceId} failed`, err instanceof Error ? err.stack : String(err));
    }
  }
}

/** The offer as its PDF shows it: selling prices only, never costs, margin or pricing internals. */
function clientOffer(o: Offer, lines: OfferLine[], assumptions: OfferAssumption[]) {
  const date = o.submittedAt ?? o.createdAt;
  return {
    id: o.id,
    reference: o.reference,
    version: o.version,
    projectName: o.projectName,
    status: o.status,
    submittedAt: o.submittedAt,
    acceptedAt: o.acceptedAt,
    validityDays: o.validityDays,
    validUntil: o.validityDays ? addDays(date, o.validityDays) : null,
    vatRate: o.vatRate,
    totalHtCents: o.totalHtCents,
    totalVatCents: o.totalVatCents,
    totalTtcCents: o.totalTtcCents,
    remarks: o.notes,
    lines: lines.map((l) => {
      const priced = PRICED_LINE_TYPES.includes(l.variantType) && l.unitPriceCents != null;
      return {
        id: l.id,
        positionNumber: l.positionNumber,
        description: l.description,
        roomType: l.roomType,
        unit: l.unit,
        quantity: Number(l.quantity),
        variantType: l.variantType,
        unitPriceHtCents: priced ? sellingUnitCents(l.unitPriceCents!, o.marginFactor) : null,
        totalHtCents: priced ? sellingLineCents(l.quantity, l.unitPriceCents!, o.marginFactor) : null,
      };
    }),
    assumptions: assumptions
      .filter((a) => a.status !== 'rejected')
      .map((a) => ({ id: a.id, type: a.type, description: a.description, impactAmountCents: a.impactAmountCents, status: a.status })),
  };
}

function offerLabel(o: Offer): string {
  return [o.reference, o.version > 1 ? `v${o.version}` : null].filter(Boolean).join(' ') || o.projectName;
}

function consentText(o: Offer, decision: OfferDecision): string {
  const label = offerLabel(o);
  return decision === 'accepted'
    ? `J'accepte l'offre ${label} « ${o.projectName} » pour un montant de CHF ${chf(o.totalTtcCents)} TTC. ` +
        `La saisie de mon nom et cette confirmation valent signature électronique simple.`
    : `Je refuse l'offre ${label} « ${o.projectName} ». ` +
        `La saisie de mon nom et cette confirmation valent signature électronique simple.`;
}

function isExpired(validUntil: string | null): boolean {
  return validUntil != null && todayInZurich() > validUntil;
}

function paymentStatus(i: Invoice, dueDate: string | null, now: string) {
  if (i.type === 'credit_note') return 'credit_note';
  if (i.status === 'paid') return 'paid';
  // A situation whose prior acomptes exceed the work billed claims nothing: the balance is in the
  // client's favour and comes off the next invoice. Reporting it as unpaid (or overdue, once its
  // due date passes) would tell the client to pay a negative amount.
  if (i.totalTtcCents <= 0) return 'nothing_due';
  if (i.status === 'overdue' || (dueDate != null && dueDate < now)) return 'overdue';
  if ((i.amountPaidCents ?? 0) > 0) return 'partially_paid';
  return 'unpaid';
}

function excerpt(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
