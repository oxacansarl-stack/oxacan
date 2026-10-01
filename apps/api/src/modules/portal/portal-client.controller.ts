import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { RenderedDocument } from '../documents/documents.service';
import { PLAN_UPLOAD_TYPES, PlanUploadType } from '../plans/dto/plan.dto';
import { PortalService } from './portal.service';
import { PortalClientService } from './portal-client.service';
import { PortalCommentDto, PortalOfferDecisionDto } from './dto/portal-client.dto';
import {
  ClientInfo,
  Portal,
  PORTAL_THROTTLE,
  PortalAccessGuard,
  PortalClientInfo,
  PortalContext,
} from './portal-access.guard';

const pdf = ({ filename, content }: RenderedDocument) =>
  new StreamableFile(content, {
    type: 'application/pdf',
    disposition: `inline; filename="${filename}"`,
    length: content.length,
  });

/** Quoted-string-safe ASCII filename plus the RFC 5987 UTF-8 form. */
function attachment(name: string, ext: string): string {
  const base = name.trim() || 'plan';
  const ascii = base.replace(/[^A-Za-z0-9 ._-]+/g, '_').slice(0, 150);
  const utf8 = encodeURIComponent(base).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${utf8}.${ext}`;
}

/**
 * The public client portal (PRD §21): no account, the link's token is the credential. Every
 * route is resolved by PortalAccessGuard to the link's company (RLS) and project, shares one
 * per-IP throttle bucket, and only ever returns client-facing data (selling prices as on the
 * client's PDFs; no costs, margins or internal notes).
 */
@Controller('portal/view/:token')
@UseGuards(PortalAccessGuard)
export class PortalClientController {
  constructor(
    private readonly portal: PortalService,
    private readonly client: PortalClientService,
  ) {}

  /** Project progress (lots, milestones, tasks, recent site reports); no financial data. */
  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Get()
  async view(@Portal() ctx: PortalContext) {
    return this.portal.getPortalData(ctx);
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Get('offers')
  async offers(@Portal() ctx: PortalContext) {
    return this.client.listOffers(ctx);
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @SkipEnvelope()
  @Get('offers/:offerId/pdf')
  async offerPdf(@Portal() ctx: PortalContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return pdf(await this.client.offerPdf(ctx, offerId));
  }

  /** Accept or refuse a sent offer: typed name + consent box (simple electronic signature). */
  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Post('offers/:offerId/decision')
  async decideOffer(
    @Portal() ctx: PortalContext,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() body: PortalOfferDecisionDto,
    @ClientInfo() client: PortalClientInfo,
  ) {
    return this.client.decideOffer(ctx, offerId, body, client);
  }

  /** Invoices, situations, acomptes and credit notes issued for the project, with payment status. */
  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Get('invoices')
  async invoices(@Portal() ctx: PortalContext) {
    return this.client.listInvoices(ctx);
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @SkipEnvelope()
  @Get('invoices/:invoiceId/pdf')
  async invoicePdf(@Portal() ctx: PortalContext, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return pdf(await this.client.invoicePdf(ctx, invoiceId));
  }

  /** Shared documents: the project's uploaded plans and completed site-meeting minutes (PV). */
  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Get('documents')
  async documents(@Portal() ctx: PortalContext) {
    return this.client.listDocuments(ctx);
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @SkipEnvelope()
  @Get('plans/:planId/file')
  async planFile(@Portal() ctx: PortalContext, @Param('planId', ParseUUIDPipe) planId: string) {
    const file = await this.client.planFile(ctx, planId);
    return new StreamableFile(file.data, {
      type: file.contentType,
      disposition: attachment(file.name, PLAN_UPLOAD_TYPES[file.contentType as PlanUploadType] ?? 'bin'),
      length: file.data.length,
    });
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @SkipEnvelope()
  @Get('meetings/:meetingId/pdf')
  async meetingPdf(@Portal() ctx: PortalContext, @Param('meetingId', ParseUUIDPipe) meetingId: string) {
    return pdf(await this.client.meetingPdf(ctx, meetingId));
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Get('comments')
  async comments(@Portal() ctx: PortalContext) {
    return this.client.listComments(ctx);
  }

  @Public()
  @Throttle(PORTAL_THROTTLE)
  @Post('comments')
  async addComment(
    @Portal() ctx: PortalContext,
    @Body() body: PortalCommentDto,
    @ClientInfo() client: PortalClientInfo,
  ) {
    return this.client.addComment(ctx, body, client);
  }
}
