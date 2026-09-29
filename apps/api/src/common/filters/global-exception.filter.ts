import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { OxacanError } from '@oxacan/shared-types';

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
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      code = 'HTTP_ERROR';
      message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as any).message || exception.message;
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
