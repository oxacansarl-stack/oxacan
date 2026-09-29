import { Controller, Get, Patch, Body } from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Roles, ALL_ROLES, ADMIN_ONLY } from '../../common/decorators/roles.decorator';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/company.dto';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('me')
  @Roles(...ALL_ROLES)
  async getMyCompany(@CompanyId() companyId: string) {
    return this.companyService.findById(companyId);
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
