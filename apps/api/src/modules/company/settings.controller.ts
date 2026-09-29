import { Controller, Get, Put, Body } from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyService } from './company.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @Roles('ADMIN')
  async getSettings(@CompanyId() companyId: string) {
    const company = await this.companyService.findById(companyId);
    return {
      logo: company.logoUrl,
      defaultVatRate: company.defaultVatRate,
      defaultRetentionRate: company.defaultRetentionRate,
      defaultMarginFactor: company.defaultMarginFactor,
      geolocationEnabled: company.geolocationEnabled,
    };
  }

  @Put()
  @Roles('ADMIN')
  async updateSettings(
    @CompanyId() companyId: string,
    @Body()
    body: {
      logo?: string;
      documentTemplate?: string;
      enabledModules?: string[];
      geolocationEnabled?: boolean;
      defaultVatRate?: number;
      defaultRetentionRate?: number;
      defaultMarginFactor?: number;
    },
  ) {
    const data: Record<string, unknown> = {};

    if (body.logo !== undefined) data.logoUrl = body.logo;
    if (body.geolocationEnabled !== undefined)
      data.geolocationEnabled = body.geolocationEnabled;
    if (body.defaultVatRate !== undefined)
      data.defaultVatRate = body.defaultVatRate;
    if (body.defaultRetentionRate !== undefined)
      data.defaultRetentionRate = body.defaultRetentionRate;
    if (body.defaultMarginFactor !== undefined)
      data.defaultMarginFactor = body.defaultMarginFactor;

    return this.companyService.update(companyId, data);
  }
}
