import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsService } from './alerts.service';
import { AlertsScheduler } from './alerts.scheduler';
import { AlertsController } from './alerts.controller';
import { ProjectCostSubscriber } from './project-cost.subscriber';

/** Financial alerts (PRD §15.6). Needs ScheduleModule.forRoot() in AppModule for the daily job. */
@Module({
  imports: [NotificationsModule],
  providers: [AlertsService, AlertsScheduler, ProjectCostSubscriber],
  controllers: [AlertsController],
  exports: [AlertsService],
})
export class AlertsModule {}
