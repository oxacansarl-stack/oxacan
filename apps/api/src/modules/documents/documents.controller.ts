import { Controller, Get, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { OFFICE_ROLES, Roles, SITE_LEAD_ROLES } from '../../common/decorators/roles.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { DocumentsService, RenderedDocument } from './documents.service';

const pdf = ({ filename, content }: RenderedDocument) =>
  new StreamableFile(content, {
    type: 'application/pdf',
    disposition: `inline; filename="${filename}"`,
    length: content.length,
  });

/** French PDF documents, generated on request from the current data. */
@Controller()
@SkipEnvelope()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('invoices/:id/pdf')
  @Roles(...OFFICE_ROLES)
  async invoice(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.documents.invoicePdf(companyId, id));
  }

  @Get('offers/:id/pdf')
  @Roles(...OFFICE_ROLES)
  async offer(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.documents.offerPdf(companyId, id));
  }

  @Get('meetings/:id/pdf')
  @Roles(...SITE_LEAD_ROLES)
  async meeting(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.documents.meetingPdf(companyId, id));
  }
}
