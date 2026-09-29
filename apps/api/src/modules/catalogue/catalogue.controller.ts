import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogueService } from './catalogue.service';

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  @Get('articles')
  async listArticles(
    @CompanyId() companyId: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalogueService.findAllArticles(companyId, {
      search,
      category,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('articles/:id')
  async getArticle(
    @CompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.catalogueService.findArticleById(companyId, id);
  }

  @Post('articles')
  @Roles('ADMIN', 'MANAGER')
  async createArticle(
    @CompanyId() companyId: string,
    @Body() body: {
      npkNumber?: string;
      description: string;
      unit: string;
      category?: string;
      isComposed?: boolean;
      composedComponents?: Array<{
        articleId: string;
        quantity: number;
        unitPriceCents: number;
      }>;
    },
  ) {
    return this.catalogueService.createArticle(companyId, body);
  }

  @Patch('articles/:id')
  @Roles('ADMIN', 'MANAGER')
  async updateArticle(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: {
      npkNumber?: string;
      description?: string;
      unit?: string;
      category?: string;
      isComposed?: boolean;
      composedComponents?: Array<{
        articleId: string;
        quantity: number;
        unitPriceCents: number;
      }>;
      isActive?: boolean;
    },
  ) {
    return this.catalogueService.updateArticle(companyId, id, body);
  }

  @Post('import')
  @Roles('ADMIN', 'MANAGER')
  async importCsv(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: {
      filename: string;
      projectName?: string;
      projectYear?: number;
      entrepreneurName?: string;
      documentType?: string;
      rows: Array<{
        lineNumber: number;
        rawText: string;
        npkNumber?: string;
        description?: string;
        unit?: string;
        quantity?: number;
        unitPriceCents?: number;
        totalPriceCents?: number;
        roomType?: string;
        floor?: string;
      }>;
    },
  ) {
    return this.catalogueService.importCsv(companyId, user.id, body);
  }

  @Get('articles/:id/prices')
  async getPriceStats(
    @CompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.catalogueService.getPriceStats(companyId, id);
  }
}
