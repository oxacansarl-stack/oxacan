import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, OFFICE_ROLES, SITE_LEAD_ROLES } from '../../common/decorators/roles.decorator';
import { CatalogueService } from './catalogue.service';
import { MatchingService } from './matching.service';
import { hidesMoneyFor, stripMoney } from '../../common/util/strip-money';
import { CreateArticleDto, UpdateArticleDto, ImportCsvDto, ImportPdfDto } from './dto/catalogue.dto';
import {
  ConfirmDraftDto,
  ListDraftsQueryDto,
  UpdateDraftDto,
  UpdateDraftRowDto,
} from './dto/import-review.dto';
import { ImportReviewService } from './import-review.service';
import { PDF_LIMITS } from './pdf-text.extractor';

@Controller('catalogue')
export class CatalogueController {
  constructor(
    private readonly catalogueService: CatalogueService,
    private readonly matching: MatchingService,
    private readonly review: ImportReviewService,
  ) {}

  /**
   * Candidate articles for the imported lines the catalogue could not place by code. Suggestions
   * only: nothing is written and a project manager confirms each one (PRD §18.6). Answers
   * `enabled: false` when no AI provider is configured, which is the default.
   */
  @Get('unmatched/suggestions')
  @Roles(...OFFICE_ROLES)
  async suggestMatches(@CompanyId() companyId: string, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : NaN;
    return this.matching.suggestForUnmatched(companyId, Number.isInteger(n) && n >= 1 ? n : undefined);
  }

  // Catalogue reads show unit prices, so workers are excluded (product decision 2026-10-01);
  // team leaders still read it with prices stripped by the financial redaction.
  @Get('articles')
  @Roles(...SITE_LEAD_ROLES)
  async listArticles(
    @CompanyId() companyId: string,
    @CurrentUser() user: { role: string },
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.catalogueService.findAllArticles(companyId, {
      search,
      category,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return hidesMoneyFor(user.role) ? stripMoney(result) : result;
  }

  @Get('articles/:id')
  @Roles(...SITE_LEAD_ROLES)
  async getArticle(
    @CompanyId() companyId: string,
    @CurrentUser() user: { role: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const article = await this.catalogueService.findArticleById(companyId, id);
    if (!hidesMoneyFor(user.role)) return article;
    const { priceStats: _prices, ...rest } = stripMoney(article);
    return rest;
  }

  @Post('articles')
  @Roles(...OFFICE_ROLES)
  async createArticle(
    @CompanyId() companyId: string,
    @Body() body: CreateArticleDto,
  ) {
    return this.catalogueService.createArticle(companyId, body);
  }

  @Patch('articles/:id')
  @Roles(...OFFICE_ROLES)
  async updateArticle(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateArticleDto,
  ) {
    return this.catalogueService.updateArticle(companyId, id, body);
  }

  @Post('import')
  @Roles(...OFFICE_ROLES)
  async importCsv(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: ImportCsvDto,
  ) {
    return this.catalogueService.importCsv(companyId, user.id, body);
  }

  /**
   * A soumission PDF read into a draft for review (multipart/form-data, field "file"). Kept in
   * memory only, one file, 10 MB at most; the content must be a real PDF whatever its name or MIME
   * type says.
   *
   * This does NOT import anything. What the reader made of the document is parked, with a flag on
   * every line that deserves a look, until a human confirms it (PRD §7.3 step 10). A reading of a
   * printed layout is the one place in the product where the data can be wrong without anybody
   * having typed it wrong, so it is the one place that gets a second pair of eyes by default.
   */
  @Post('import/pdf')
  @Roles(...OFFICE_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PDF_LIMITS.maxBytes, files: 1, fields: 10, fieldSize: 1024, parts: 12 },
    }),
  )
  async importPdf(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: ImportPdfDto,
  ) {
    return this.review.draftFromPdf(companyId, user.id, file, body);
  }

  /* ───────────── Import review (PRD §7.3 step 10) ───────────── */

  @Get('drafts')
  @Roles(...OFFICE_ROLES)
  async listDrafts(@CompanyId() companyId: string, @Query() query: ListDraftsQueryDto) {
    return this.review.list(companyId, query.status);
  }

  @Get('drafts/:id')
  @Roles(...OFFICE_ROLES)
  async getDraft(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.get(companyId, id);
  }

  /** Corrects what the document said about itself (project, year, date) before confirming. */
  @Patch('drafts/:id')
  @Roles(...OFFICE_ROLES)
  async updateDraft(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDraftDto,
  ) {
    return this.review.updateDraft(companyId, id, body);
  }

  /** Corrects one read line, or drops it from the import. */
  @Patch('drafts/:id/rows/:rowId')
  @Roles(...OFFICE_ROLES)
  async updateDraftRow(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() body: UpdateDraftRowDto,
  ) {
    return this.review.updateRow(companyId, id, rowId, body);
  }

  /** Imports the reviewed lines: the only path by which a read document reaches the catalogue. */
  @Post('drafts/:id/confirm')
  @Roles(...OFFICE_ROLES)
  async confirmDraft(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmDraftDto,
  ) {
    return this.review.confirm(companyId, user.id, id, body);
  }

  @Post('drafts/:id/discard')
  @Roles(...OFFICE_ROLES)
  async discardDraft(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.review.discard(companyId, id, user.id);
  }

  @Get('articles/:id/prices')
  @Roles(...OFFICE_ROLES)
  async getPriceStats(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalogueService.getPriceStats(companyId, id);
  }
}
