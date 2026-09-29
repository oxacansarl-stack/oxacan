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
import { NotificationsService } from './notifications.service';

@Controller('notifications')
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
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
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
