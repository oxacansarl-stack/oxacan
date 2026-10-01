import { Controller, Get, Patch, Body } from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { hidesMoneyFor } from '../../common/util/strip-money';
import { Roles, ALL_ROLES, ADMIN_ONLY } from '../../common/decorators/roles.decorator';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/company.dto';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('me')
  @Roles(...ALL_ROLES)
  async getMyCompany(@CompanyId() companyId: string, @CurrentUser() user: { role: string }) {
    const company = await this.companyService.findById(companyId);
    if (!hidesMoneyFor(user.role)) return company;
    // Field roles get the company identity, not its commercial terms or bank account.
    const { defaultMarginFactor: _m, defaultRetentionRate: _r, iban: _i, ...visible } = company;
    return visible;
  }

  @Patch('me')
  @Roles(...ADMIN_ONLY)
  async updateMyCompany(
    @CompanyId() companyId: string,
    @Body() body: UpdateCompanyDto,
  ) {
    return this.companyService.update(companyId, body);
  }
}
