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
import { OFFICE_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PortalService } from './portal.service';
import { CreatePortalTokenDto } from './dto/portal-token.dto';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  @Get('tokens')
  @Roles(...OFFICE_ROLES)
  async findAllTokens(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.findAllTokens(companyId, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, 200),
      projectId,
    });
  }

  @Post('tokens')
  @Roles(...OFFICE_ROLES)
  async createToken(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreatePortalTokenDto,
  ) {
    return this.service.createToken(companyId, user.id, body);
  }

  @Delete('tokens/:id')
  @Roles(...OFFICE_ROLES)
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
