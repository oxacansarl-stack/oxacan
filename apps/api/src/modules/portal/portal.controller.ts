import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PortalService } from './portal.service';

@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  @Get('tokens')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAllTokens(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.findAllTokens(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      projectId,
    });
  }

  @Post('tokens')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createToken(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      expiresAt?: Date;
    },
  ) {
    return this.service.createToken(companyId, user.id, body);
  }

  @Delete('tokens/:id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async revokeToken(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.revokeToken(companyId, id);
  }

  @Get('view/:token')
  @Public()
  async getPortalData(@Param('token') token: string) {
    return this.service.getPortalData(token);
  }
}
