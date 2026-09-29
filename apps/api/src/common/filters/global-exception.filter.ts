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
  429: 'RATE_LIMITED',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let code: string;
    let message: string;
    let details: Record<string, unknown> | undefined;

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
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      this.logger.error('Unhandled exception', exception);

      try {
        const Sentry = require('@sentry/node');
        Sentry.captureException(exception);
      } catch {}
    }

    response.status(status).json({
      data: null,
      error: { code, message, ...(details ? { details } : {}) },
    });
  }
}
