import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { OxacanError } from '@oxacan/shared-types';

// Postgres errors caused by bad client input; anything else (incl. RLS violations) stays a 500.
const CLIENT_DB_ERRORS: Record<string, [number, string, string]> = {
  '23502': [400, 'VALIDATION_ERROR', 'A required field is missing.'],
  '23503': [400, 'VALIDATION_ERROR', 'A referenced record does not exist.'],
  '23505': [409, 'CONFLICT', 'A record with these values already exists.'],
  '23514': [400, 'VALIDATION_ERROR', 'A field has a value that is not allowed.'],
  '22P02': [400, 'VALIDATION_ERROR', 'A field has an invalid format.'],
  '22007': [400, 'VALIDATION_ERROR', 'A date or time field has an invalid format.'],
  '22008': [400, 'VALIDATION_ERROR', 'A date or time field is out of range.'],
};

const HTTP_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** http-errors instances flagged safe to expose (status 4xx, `expose: true`). */
function isClientHttpError(e: unknown): e is { status: number; message: string } {
  const err = e as { status?: unknown; expose?: unknown };
  return typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.expose === true;
}

export interface RenderedError {
  status: number;
  body: { data: null; error: { code: string; message: string; details?: Record<string, unknown> } };
  /** Not a known client/HTTP error: logged and reported as a 500. */
  unexpected: boolean;
}

/**
 * The status and body the API sends for an exception. Pure, so the idempotency interceptor can
 * store exactly what the filter will send for the same exception.
 */
export function renderException(exception: unknown): RenderedError {
  let status: number;
  let code: string;
  let message: string;
  let details: Record<string, unknown> | undefined;
  let unexpected = false;

  if (exception instanceof OxacanError) {
    status = exception.statusCode;
    code = exception.code;
    message = exception.message;
    details = exception.details;
  } else if (exception instanceof QueryFailedError && CLIENT_DB_ERRORS[(exception as any).driverError?.code]) {
    const pg = (exception as any).driverError;
    [status, code, message] = CLIENT_DB_ERRORS[pg.code];
    details = {
      ...(pg.column ? { field: pg.column } : {}),
      ...(pg.constraint ? { constraint: pg.constraint } : {}),
    };
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    const exResponse = exception.getResponse();
    const raw = typeof exResponse === 'string' ? exResponse : (exResponse as any).message;
    code = HTTP_CODES[status] ?? 'HTTP_ERROR';
    if (Array.isArray(raw)) {
      // class-validator failures from ValidationPipe
      message = raw.join('; ');
      details = { errors: raw };
    } else {
      message = raw || exception.message;
    }
  } else if (isClientHttpError(exception)) {
    // body-parser errors (too large, bad encoding…) are http-errors thrown before Nest's pipes
    status = exception.status;
    code = HTTP_CODES[status] ?? 'HTTP_ERROR';
    message = exception.message;
  } else {
    status = HttpStatus.INTERNAL_SERVER_ERROR;
    code = 'INTERNAL_ERROR';
    message = 'An unexpected error occurred';
    unexpected = true;
  }

  return {
    status,
    body: { data: null, error: { code, message, ...(details ? { details } : {}) } },
    unexpected,
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body, unexpected } = renderException(exception);

    if (unexpected) {
      this.logger.error('Unhandled exception', exception);
      try {
        const Sentry = require('@sentry/node');
        Sentry.captureException(exception);
      } catch {}
    }

    response.status(status).json(body);
  }
}
