import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Observable, mergeMap } from 'rxjs';
import { AuditService } from '../../modules/admin/audit.service';
import { sanitiseForAudit } from '../../modules/admin/audit-redaction';
import type { AuditLog } from '../../modules/admin/entities/audit-log.entity';

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPTS = 2;

const asUuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * Records every successful mutation (POST / PUT / PATCH / DELETE) of an authenticated company in
 * audit_log, with the request body as new_values.
 *
 * - The body is read after the handler ran, so a handler can replace request.body with a safe
 *   summary (the plan upload puts the file's metadata there instead of its bytes). It is then
 *   redacted (passwords, tokens, secrets, IBANs, keys, signatures — at any depth, IBANs also
 *   inside text) and capped in size (see audit-redaction.ts).
 * - The entry is written before the response is sent, so the trail is complete when the client
 *   sees success. Handlers commit their own transactions, so this insert cannot join them; a
 *   service that needs the entry to be atomic with its change calls AuditService.log() with its
 *   transaction's manager. If the insert still fails after a retry, the request is NOT failed (its
 *   change is already committed and a 5xx would make an Idempotency-Key retry execute it again):
 *   the redacted entry is logged in full, so it can be replayed from the logs, and reported to
 *   Sentry.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const action = METHOD_TO_ACTION[request.method];
    if (!action) return next.handle();

    return next.handle().pipe(
      mergeMap(async (responseBody) => {
        if (request.companyId) await this.record(request, action, responseBody);
        return responseBody;
      }),
    );
  }

  private async record(request: any, action: string, responseBody: any): Promise<void> {
    let entry: Partial<AuditLog> | undefined;
    try {
      entry = buildEntry(request, action, responseBody);
    } catch (err) {
      this.report(err, { action, path: request.route?.path ?? null });
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await this.audit.log(entry);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    this.logger.error(
      `Audit entry could not be stored; entry follows for replay: ${JSON.stringify(entry)}`,
      lastError instanceof Error ? lastError.stack : String(lastError),
    );
    this.report(lastError, {
      action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      companyId: entry.companyId,
    });
  }

  private report(err: unknown, extra: Record<string, unknown>) {
    try {
      Sentry.captureException(err, { tags: { component: 'audit-log' }, extra });
    } catch {
      // Sentry not initialised or failing: the error log above is the record.
    }
  }
}

function buildEntry(request: any, action: string, responseBody: any): Partial<AuditLog> {
  const routePath: string = request.route?.path || request.originalUrl?.split('?')[0] || request.url || '';
  const entityType = routePath.split('/').filter(Boolean)[0] || 'unknown';

  // The route's :id, else the created / returned row's id, else the last UUID route parameter
  // (nested routes such as /projects/:projectId/tasks/:taskId). Never a non-UUID: the column is uuid.
  const params: Record<string, unknown> = request.params ?? {};
  const uuidParams = Object.values(params).map(asUuid).filter((v): v is string => !!v);
  const entityId =
    asUuid(params.id) ?? asUuid(responseBody?.id) ?? uuidParams[uuidParams.length - 1] ?? null;

  return {
    companyId: request.companyId,
    userId: asUuid(request.userId),
    action,
    entityType,
    entityId,
    newValues: action === 'DELETE' ? null : sanitiseForAudit(request.body),
    ipAddress: request.ip || null,
    userAgent: typeof request.headers?.['user-agent'] === 'string'
      ? request.headers['user-agent'].slice(0, 500)
      : null,
  };
}
