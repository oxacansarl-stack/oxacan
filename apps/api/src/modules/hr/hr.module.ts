import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { HrService } from './hr.service';
import { HrController } from './hr.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamMember, AppUser])],
  providers: [HrService],
  controllers: [HrController],
  exports: [HrService],
})
export class HrModule {}
