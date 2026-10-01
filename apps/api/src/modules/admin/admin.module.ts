import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { RetentionService } from './retention.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AdminController],
  providers: [AuditService, RetentionService],
  exports: [AuditService, RetentionService],
})
export class AdminModule {}
