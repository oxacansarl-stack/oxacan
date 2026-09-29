import { Controller, Get, Patch, Body } from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyService } from './company.service';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('me')
  async getMyCompany(@CompanyId() companyId: string) {
    return this.companyService.findById(companyId);
  }

  @Patch('me')
  @Roles('ADMIN')
  async updateMyCompany(
    @CompanyId() companyId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.companyService.update(companyId, body);
  }
}
