import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ZodError) {
      return res.status(400).json({ error: 'validation', issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      return res.status(exception.getStatus()).json(typeof body === 'string' ? { error: body } : body);
    }
    const message = exception instanceof Error ? exception.message : 'internal error';
    // Erreurs métier du moteur (ex. situation négative) remontent en 422.
    if (/avoir|must be|out of range|negative/.test(message)) return res.status(422).json({ error: message });
    console.error(exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'internal error' });
  }
}
