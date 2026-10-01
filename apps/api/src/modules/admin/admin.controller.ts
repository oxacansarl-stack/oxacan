import { Controller, Get, Query } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { ValidationError } from '@oxacan/shared-types';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { ADMIN_ONLY, Roles } from '../../common/decorators/roles.decorator';
import { isCalendarDate } from '../../common/validation/decorators';
import { parsePaging } from '../timekeeping/access-scope.service';
import { AuditService } from './audit.service';
import { RetentionService } from './retention.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

function uuidParam(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!UUID_RE.test(value)) throw new ValidationError(`${name} must be a UUID`, { field: name });
  return value.toLowerCase();
}

function nameParam(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!NAME_RE.test(value)) throw new ValidationError(`${name} is not a valid value`, { field: name });
  return value;
}

/** A YYYY-MM-DD day or a full ISO 8601 timestamp. */
function dateParam(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) ? isCalendarDate(value) : isISO8601(value, { strict: true });
  if (!ok) throw new ValidationError(`${name} must be a date (YYYY-MM-DD) or an ISO 8601 timestamp`, { field: name });
  return value;
}

@Controller('admin')
@Roles(...ADMIN_ONLY)
export class AdminController {
  constructor(
    private readonly audit: AuditService,
    private readonly retention: RetentionService,
  ) {}

  /**
   * The company's audit trail, newest first. Filters: entityType (first path segment, e.g.
   * "clients"), entityId, userId, action (CREATE / UPDATE / DELETE / EXPORT / RETENTION…),
   * from / to (YYYY-MM-DD in Swiss time, or ISO timestamps). Paginated with page / limit.
   */
  @Get('audit-log')
  async auditLog(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const filters = {
      ...parsePaging(page, limit),
      entityType: nameParam('entityType', entityType),
      entityId: uuidParam('entityId', entityId),
      userId: uuidParam('userId', userId),
      action: nameParam('action', action)?.toUpperCase(),
      from: dateParam('from', from),
      to: dateParam('to', to),
    };
    if (filters.from && filters.to && filters.from > filters.to && filters.from.length === filters.to.length) {
      throw new ValidationError('from must not be after to', { field: 'from' });
    }
    return this.audit.list(companyId, filters);
  }

  /**
   * What the scheduled retention job (config/run-retention.ts) would anonymise or delete for this
   * company right now, rule by rule, with the retention period and legal basis. Changes nothing.
   */
  @Get('retention/dry-run')
  async retentionDryRun(@CompanyId() companyId: string) {
    return this.retention.previewForCompany(companyId);
  }
}
