import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(entry: Partial<AuditLog>): Promise<void> {
    const auditEntry = this.auditRepo.create(entry);
    await this.auditRepo.save(auditEntry);
  }
}
