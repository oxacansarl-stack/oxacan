import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** An incoming id is kept only if it is short and harmless to log (UUIDs, ULIDs, trace ids…). */
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Not logged: polled by Railway's healthcheck and uptime monitors. */
const UNLOGGED_PATHS = new Set(['/health']);

export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID_RE.test(value) ? value : randomUUID();
}

/**
 * First middleware of the app (registered in main.ts before any body parser):
 *
 * - Correlation id: the caller's X-Request-Id when well-formed, else a new UUID. It is returned
 *   in the X-Request-Id response header, set as the `request_id` tag of the request's Sentry
 *   isolation scope, and added to error bodies as `error.requestId`, so a user can quote it.
 *   Exception: requests with an Idempotency-Key, whose stored body is replayed verbatim to the
 *   retry; they get the id in the header only, so the replay's body equals the original.
 * - One JSON log line per request on stdout when the response is sent (or the client goes away):
 *   method, route pattern (never the raw URL: portal tokens and ids travel in paths), status,
 *   duration, request id, and the user and company once authentication identified them.
 *   Never bodies, headers or tokens.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = requestIdFrom(req.headers['x-request-id']);
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  if (!req.headers['idempotency-key']) addIdToErrorBodies(res, requestId);
  if (!UNLOGGED_PATHS.has(req.path)) logWhenDone(req, res, requestId);

  if (Sentry.isInitialized()) {
    // A fresh isolation scope per request, carried by async context into the exception filter.
    Sentry.withIsolationScope((scope) => {
      scope.setTag('request_id', requestId);
      next();
    });
  } else {
    next();
  }
}

/** The error envelope { data: null, error: { code, message } } gains error.requestId. */
function addIdToErrorBodies(res: Response, requestId: string): void {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      const error = (body as { error?: unknown }).error;
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        return json({ ...(body as object), error: { ...(error as object), requestId } });
      }
    }
    return json(body);
  };
}

function logWhenDone(req: Request, res: Response, requestId: string): void {
  const started = process.hrtime.bigint();
  let logged = false;
  const log = (aborted: boolean) => {
    if (logged) return;
    logged = true;
    const r = req as Request & { user?: { id?: string; companyId?: string } };
    const status = res.statusCode;
    const line: Record<string, unknown> = {
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      message: 'request',
      time: new Date().toISOString(),
      requestId,
      method: req.method,
      // The matched route pattern, e.g. /plans/:id/file; null when no route matched.
      route: req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : null,
      status,
      durationMs: Number((process.hrtime.bigint() - started) / 1000n) / 1000,
      userId: r.user?.id ?? null,
      companyId: r.user?.companyId ?? null,
    };
    if (aborted) line.aborted = true;
    process.stdout.write(`${JSON.stringify(line)}\n`);
  };
  res.once('finish', () => log(false));
  res.once('close', () => log(!res.writableFinished));
}
