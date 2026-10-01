import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortalToken } from './entities/portal-token.entity';
import { PortalComment } from './entities/portal-comment.entity';
import { PortalOfferDecision } from './entities/portal-offer-decision.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectLot } from '../projects/entities/project-lot.entity';
import { ProjectMilestone } from '../projects/entities/project-milestone.entity';
import { Task } from '../projects/entities/task.entity';
import { DailyReport } from '../timekeeping/entities/daily-report.entity';
import { Offer } from '../offers/entities/offer.entity';
import { OfferLine } from '../offers/entities/offer-line.entity';
import { OfferAssumption } from '../offers/entities/offer-assumption.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { Plan } from '../plans/entities/plan.entity';
import { PlanFile } from '../plans/entities/plan-file.entity';
import { SiteMeeting } from '../meetings/entities/site-meeting.entity';
import { OffersModule } from '../offers/offers.module';
import { NotificationsModule } from '../notifications/notifications.module';
// DocumentsModule does not export its service; it only needs the DataSource, so it is provided here too.
import { DocumentsService } from '../documents/documents.service';
import { PortalService } from './portal.service';
import { PortalClientService } from './portal-client.service';
import { PortalGuessLimiter } from './portal-access.guard';
import { PortalController } from './portal.controller';
import { PortalClientController } from './portal-client.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortalToken,
      PortalComment,
      PortalOfferDecision,
      Project,
      ProjectLot,
      ProjectMilestone,
      Task,
      DailyReport,
      Offer,
      OfferLine,
      OfferAssumption,
      Invoice,
      Plan,
      PlanFile,
      SiteMeeting,
    ]),
    OffersModule,
    NotificationsModule,
  ],
  providers: [PortalService, PortalClientService, PortalGuessLimiter, DocumentsService],
  controllers: [PortalController, PortalClientController],
  exports: [PortalService],
})
export class PortalModule {}
