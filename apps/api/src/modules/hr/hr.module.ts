import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { Company } from '../company/entities/company.entity';
import { SubscriptionModule } from '../subscription/subscription.module';
import { HrService } from './hr.service';
import { HrController } from './hr.controller';
import { EmployeeAccountsService } from './employee-accounts.service';
import { SupabaseAdminService } from './supabase-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamMember, AppUser, Company]), SubscriptionModule],
  providers: [HrService, EmployeeAccountsService, SupabaseAdminService],
  controllers: [HrController],
  exports: [HrService],
})
export class HrModule {}
