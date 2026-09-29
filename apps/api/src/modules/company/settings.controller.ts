import { Controller, Get, Put, Body } from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, ADMIN_ONLY, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { CompanyService } from './company.service';
import { DataExportService } from './data-export.service';
import { Company } from './entities/company.entity';
import { UpdateSettingsDto } from './dto/company.dto';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly dataExport: DataExportService,
  ) {}

  @Get('export')
  @Roles(...ADMIN_ONLY)
  async exportData(@CompanyId() companyId: string, @CurrentUser() user: { id: string }) {
    return this.dataExport.exportCompany(companyId, user.id);
  }

  @Get()
  @Roles(...OFFICE_ROLES)
  async getSettings(@CompanyId() companyId: string) {
    const company = await this.companyService.findById(companyId);
    const address = [
      company.addressLine1,
      company.addressLine2,
      [company.postalCode, company.city].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      companyName: company.name,
      legalName: company.legalName,
      address: address || null,
      vatNumber: company.vatNumber,
      logo: company.logoUrl,
      defaultVatRate: company.defaultVatRate,
      defaultRetentionRate: company.defaultRetentionRate,
      defaultMarginFactor: company.defaultMarginFactor,
      geolocationEnabled: company.geolocationEnabled,
      iban: company.iban,
      defaultPaymentTermsDays: company.defaultPaymentTermsDays,
    };
  }

  @Put()
  @Roles(...ADMIN_ONLY)
  async updateSettings(
    @CompanyId() companyId: string,
    @Body() body: UpdateSettingsDto,
  ) {
    const data: Partial<Company> = {};

    if (body.logo !== undefined) data.logoUrl = body.logo;
    if (body.geolocationEnabled !== undefined)
      data.geolocationEnabled = body.geolocationEnabled;
    if (body.defaultVatRate !== undefined)
      data.defaultVatRate = body.defaultVatRate;
    if (body.defaultRetentionRate !== undefined)
      data.defaultRetentionRate = body.defaultRetentionRate;
    if (body.defaultMarginFactor !== undefined)
      data.defaultMarginFactor = body.defaultMarginFactor;
    if (body.iban !== undefined) data.iban = body.iban || null;
    if (body.defaultPaymentTermsDays !== undefined)
      data.defaultPaymentTermsDays = body.defaultPaymentTermsDays;

    return this.companyService.update(companyId, data);
  }
}
