import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

// Notifications are per-user: every query in the service filters by companyId AND userId.
@Controller('notifications')
@Roles(...ALL_ROLES)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async findAll(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isRead') isRead?: string,
  ) {
    return this.service.findAll(companyId, user.id, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, 200),
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
    });
  }

  @Get('unread-count')
  async getUnreadCount(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.getUnreadCount(companyId, user.id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.markAsRead(companyId, user.id, id);
  }

  @Post('read-all')
  async markAllAsRead(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.markAllAsRead(companyId, user.id);
  }
}
