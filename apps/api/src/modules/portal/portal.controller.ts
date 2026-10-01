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
import { PortalService } from './portal.service';
import { PortalClientService } from './portal-client.service';
import { CreatePortalTokenDto } from './dto/portal-token.dto';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

/** Office side of the client portal: links, and what clients did with them. The public routes are in PortalClientController. */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly service: PortalService,
    private readonly client: PortalClientService,
  ) {}

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

  /** The client's comments left on the project's portal (oldest first), with name, IP and time. */
  @Get('projects/:projectId/comments')
  @Roles(...OFFICE_ROLES)
  async projectComments(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.client.officeComments(companyId, projectId);
  }

  /** The signature evidence of the offers the client accepted or refused on the portal. */
  @Get('projects/:projectId/offer-decisions')
  @Roles(...OFFICE_ROLES)
  async projectOfferDecisions(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.client.officeOfferDecisions(companyId, projectId);
  }
}
