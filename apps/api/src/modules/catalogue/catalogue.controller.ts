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
import { hidesMoneyFor, stripMoney } from '../../common/util/strip-money';
import { CreateArticleDto, UpdateArticleDto, ImportCsvDto, ImportPdfDto } from './dto/catalogue.dto';
import { PDF_LIMITS } from './pdf-text.extractor';

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

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
   * A soumission PDF imported as is (multipart/form-data, field "file"). Kept in memory only,
   * one file, 10 MB at most; the content must be a real PDF whatever its name or MIME type says.
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
    return this.catalogueService.importPdf(companyId, user.id, file, body);
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
