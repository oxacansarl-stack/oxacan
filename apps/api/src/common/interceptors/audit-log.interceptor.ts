import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../modules/admin/entities/audit-log.entity';

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (!METHOD_TO_ACTION[method]) return next.handle();

    return next.handle().pipe(
      tap((responseBody) => {
        const companyId = request.companyId;
        if (!companyId) return;

        const routePath = request.route?.path || request.url;
        const pathParts = routePath.split('/').filter(Boolean);
        const entityType = pathParts[0] || 'unknown';
        const entityId = request.params?.id || responseBody?.id || null;

        const entry = new AuditLog();
        entry.companyId = companyId;
        entry.userId = request.userId || null;
        entry.action = METHOD_TO_ACTION[method];
        entry.entityType = entityType;
        entry.entityId = entityId;
        entry.newValues = method !== 'DELETE' ? request.body : null;
        entry.ipAddress = request.ip || null;
        entry.userAgent = request.headers['user-agent'] || null;

        this.dataSource.getRepository(AuditLog).save(entry).catch(() => {});
      }),
    );
  }
}
