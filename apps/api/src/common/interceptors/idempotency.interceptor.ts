import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Stream } from 'node:stream';
import type { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { OxacanError, ValidationError } from '@oxacan/shared-types';
import { renderException } from '../filters/global-exception.filter';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Set on a response served from the store instead of executing the request. */
export const REPLAYED_HEADER = 'Idempotent-Replayed';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Keys live long enough for an offline phone to come back over a weekend night. */
const TTL_HOURS = 48;
/** A 'pending' key older than this belongs to a request that died (crash, deploy): take it over. */
const STALE_PENDING_SECONDS = 120;
/** Larger responses are not stored; a retry then gets 409 IDEMPOTENCY_KEY_ALREADY_USED. */
const MAX_STORED_CHARS = 1_000_000;

interface Scope {
  companyId: string;
  userId: string;
  key: string;
}

interface Fingerprint {
  method: string;
  path: string;
  hash: string;
}

type Claim = { kind: 'owner' } | { kind: 'replay'; status: number; body: unknown };

interface StoredRow {
  method: string;
  path: string;
  request_hash: string;
  status: 'pending' | 'completed';
  response_status: number | null;
  response_body: unknown;
  no_body: boolean;
  stale: boolean;
}

/**
 * Idempotency-Key support for mutating requests (Build Strategy §10.4).
 *
 * A key (UUID) is scoped to company + user. The first request with a key inserts a 'pending'
 * row and executes; the response is stored before it is sent. A retry with the same key,
 * method, path and body gets the stored status and body back without re-executing; with a
 * different method, path or body it gets 422. While the first request is still running a
 * retry gets 409 IDEMPOTENCY_KEY_IN_PROGRESS (the primary key arbitrates concurrent inserts).
 *
 * Registered as the outermost interceptor, so it stores the enveloped body the client gets
 * (ResponseEnvelopeInterceptor runs inside it) and, on errors, the body GlobalExceptionFilter
 * will send (same renderException). 5xx responses are not stored: the key is released so the
 * retry executes again. Requests without an authenticated tenant (public routes) ignore the
 * header, since there is no company/user to scope the key to.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { companyId?: string; userId?: string }>();
    const res = http.getResponse<Response>();

    const header = req.headers[IDEMPOTENCY_HEADER];
    if (header === undefined || !MUTATING.has(req.method)) return next.handle();
    if (!req.companyId || !req.userId) return next.handle();
    if (typeof header !== 'string' || !UUID_RE.test(header.trim())) {
      return throwError(() => new ValidationError('The Idempotency-Key header must be a single UUID.'));
    }

    const scope: Scope = { companyId: req.companyId, userId: req.userId, key: header.trim().toLowerCase() };
    const fingerprint: Fingerprint = { method: req.method, path: req.originalUrl, hash: requestHash(req) };

    return from(this.claim(scope, fingerprint)).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          res.status(claim.status);
          res.setHeader(REPLAYED_HEADER, 'true');
          return of(claim.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            // Nest sets the route's status (201 / @HttpCode) before interceptors run.
            await this.complete(scope, res.statusCode, serialise(body));
            return body;
          }),
          catchError((err) =>
            from(this.settleError(scope, err)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  /** Becomes the owner of the key, or returns the stored response; throws 409/422 otherwise. */
  private async claim(scope: Scope, fp: Fingerprint): Promise<Claim> {
    const pk = [scope.companyId, scope.userId, scope.key];
    // Opportunistic cleanup: this user's expired keys (this one included, so it starts over).
    await this.rows(
      `DELETE FROM idempotency_key WHERE company_id = $1 AND user_id = $2 AND expires_at < now()`,
      [scope.companyId, scope.userId],
    );

    // A row can vanish between the INSERT and the SELECT (released after a 5xx): try again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await this.rows(
        `INSERT INTO idempotency_key (company_id, user_id, key, method, path, request_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))
         ON CONFLICT DO NOTHING
         RETURNING key`,
        [...pk, fp.method, fp.path, fp.hash, TTL_HOURS],
      );
      if (inserted.length > 0) return { kind: 'owner' };

      const [row] = await this.rows<StoredRow>(
        `SELECT method, path, request_hash, status, response_status, response_body,
                response_body IS NULL AS no_body,
                locked_at < now() - make_interval(secs => $4) AS stale
           FROM idempotency_key
          WHERE company_id = $1 AND user_id = $2 AND key = $3`,
        [...pk, STALE_PENDING_SECONDS],
      );
      if (!row) continue;

      if (row.method !== fp.method || row.path !== fp.path || row.request_hash !== fp.hash) {
        throw new OxacanError(
          'IDEMPOTENCY_KEY_MISMATCH',
          'This Idempotency-Key was already used for a different request.',
          422,
        );
      }
      if (row.status === 'completed') {
        if (row.no_body) {
          throw new OxacanError(
            'IDEMPOTENCY_KEY_ALREADY_USED',
            'This request was already processed; its response cannot be replayed.',
            409,
            { responseStatus: row.response_status },
          );
        }
        return { kind: 'replay', status: row.response_status!, body: row.response_body };
      }
      if (row.stale) {
        const taken = await this.rows(
          `WITH t AS (
             UPDATE idempotency_key SET locked_at = now()
              WHERE company_id = $1 AND user_id = $2 AND key = $3 AND status = 'pending'
                AND locked_at < now() - make_interval(secs => $4)
             RETURNING key)
           SELECT key FROM t`,
          [...pk, STALE_PENDING_SECONDS],
        );
        if (taken.length > 0) return { kind: 'owner' };
      }
      throw new OxacanError(
        'IDEMPOTENCY_KEY_IN_PROGRESS',
        'A request with this Idempotency-Key is still being processed. Retry later.',
        409,
      );
    }
    throw new OxacanError(
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      'A request with this Idempotency-Key is being retried concurrently. Retry later.',
      409,
    );
  }

  /** Stores the response; `body` null means it is not replayable (stream, too large). */
  private async complete(scope: Scope, status: number, body: string | null): Promise<void> {
    try {
      await this.rows(
        `WITH t AS (
           UPDATE idempotency_key
              SET status = 'completed', response_status = $4, response_body = $5::jsonb, completed_at = now()
            WHERE company_id = $1 AND user_id = $2 AND key = $3 AND status = 'pending'
           RETURNING key)
         SELECT key FROM t`,
        [scope.companyId, scope.userId, scope.key, status, body],
      );
    } catch (err) {
      // The request itself succeeded; the key stays pending and is taken over once stale.
      this.logger.error(`Could not store the response for idempotency key ${scope.key}`, err as Error);
    }
  }

  /** 4xx outcomes are stored like any response; on a 5xx the key is released for a retry. */
  private async settleError(scope: Scope, err: unknown): Promise<void> {
    const rendered = renderException(err);
    if (rendered.status < 500) {
      await this.complete(scope, rendered.status, JSON.stringify(rendered.body));
      return;
    }
    try {
      await this.rows(
        `WITH t AS (
           DELETE FROM idempotency_key
            WHERE company_id = $1 AND user_id = $2 AND key = $3 AND status = 'pending'
           RETURNING key)
         SELECT key FROM t`,
        [scope.companyId, scope.userId, scope.key],
      );
    } catch (e) {
      this.logger.error(`Could not release idempotency key ${scope.key}`, e as Error);
    }
  }

  /** Runs a statement that yields rows (UPDATE/DELETE are wrapped in a CTE for that reason). */
  private async rows<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    return (await this.dataSource.query(sql, params)) as T[];
  }
}

/** Body (and, for non-JSON bodies parsed later by route interceptors, the length) as SHA-256. */
function requestHash(req: Request): string {
  const type = String(req.headers['content-type'] ?? '');
  const parts: Record<string, unknown> = { body: req.body ?? null };
  if (type && !type.startsWith('application/json')) {
    parts.contentType = type;
    parts.contentLength = req.headers['content-length'] ?? null;
  }
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

/** JSON with sorted object keys, so the hash does not depend on property order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** The handler result as stored JSON, or null when it cannot be replayed faithfully. */
function serialise(body: unknown): string | null {
  if (body === undefined || body === null) return 'null';
  if (body instanceof StreamableFile || body instanceof Stream || Buffer.isBuffer(body)) return null;
  try {
    const json = JSON.stringify(body);
    return json !== undefined && json.length <= MAX_STORED_CHARS ? json : null;
  } catch {
    return null;
  }
}
