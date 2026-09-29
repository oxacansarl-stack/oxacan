import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, ALL_ROLES, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { CatalogueService } from './catalogue.service';
import { hidesMoneyFor, stripMoney } from '../../common/util/strip-money';
import { CreateArticleDto, UpdateArticleDto, ImportCsvDto } from './dto/catalogue.dto';

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  /** Field staff pick materials from the catalogue, so reads are open to all roles. */
  @Get('articles')
  @Roles(...ALL_ROLES)
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
  @Roles(...ALL_ROLES)
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

  @Get('articles/:id/prices')
  @Roles(...OFFICE_ROLES)
  async getPriceStats(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalogueService.getPriceStats(companyId, id);
  }
}
