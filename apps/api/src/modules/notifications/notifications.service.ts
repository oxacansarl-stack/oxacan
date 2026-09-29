import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { NotFoundError } from '@oxacan/shared-types';

interface NotificationFilters {
  page?: number;
  limit?: number;
  isRead?: boolean;
}

interface CreateNotificationDto {
  userId: string;
  type: string;
  title: string;
  body?: string;
  referenceType?: string;
  referenceId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(PushDevice)
    private readonly pushDeviceRepo: Repository<PushDevice>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(
    companyId: string,
    userId: string,
    filters: NotificationFilters = {},
  ) {
    const { page = 1, limit = 25, isRead } = filters;

    const where: Record<string, unknown> = { companyId, userId };
    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    const [data, total] = await this.notificationRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ───────────── Mark as Read ───────────── */

  async markAsRead(
    companyId: string,
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId, companyId, userId },
    });
    if (!notification) throw new NotFoundError('Notification', notificationId);

    notification.isRead = true;
    notification.readAt = new Date();

    return this.notificationRepo.save(notification);
  }

  /* ───────────── Mark All as Read ───────────── */

  async markAllAsRead(companyId: string, userId: string): Promise<{ affected: number }> {
    const result = await this.notificationRepo.update(
      { companyId, userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return { affected: result.affected || 0 };
  }

  /* ───────────── Unread Count ───────────── */

  async getUnreadCount(companyId: string, userId: string): Promise<{ count: number }> {
    const count = await this.notificationRepo.count({
      where: { companyId, userId, isRead: false },
    });

    return { count };
  }

  /* ───────────── Create (internal use) ───────────── */

  async createNotification(
    companyId: string,
    dto: CreateNotificationDto,
  ): Promise<Notification> {
    const notification = this.notificationRepo.create({
      companyId,
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      body: dto.body || null,
      referenceType: dto.referenceType || null,
      referenceId: dto.referenceId || null,
      isRead: false,
    });

    return this.notificationRepo.save(notification);
  }

  /* ───────────── Delete Old Notifications ───────────── */

  async deleteOldNotifications(
    companyId: string,
    olderThanDays = 90,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.notificationRepo.delete({
      companyId,
      createdAt: LessThan(cutoff),
    });

    return { deleted: result.affected || 0 };
  }
}
