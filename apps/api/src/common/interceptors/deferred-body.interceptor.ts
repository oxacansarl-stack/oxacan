import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { parseDeferredBody } from '../middleware/deferred-body.middleware';

/**
 * Parses a body deferred by deferBody() (main.ts), now that the guards have authenticated and
 * authorised the request. Registered as the outermost interceptor, so the idempotency
 * fingerprint and the audit log see the parsed body; pipes (validation) run after interceptors.
 * A no-op for every other request.
 */
@Injectable()
export class DeferredBodyInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      // Awaited, so the handler continues in this request's async context (tenant, Sentry scope).
      await parseDeferredBody(http.getRequest<Request>(), http.getResponse<Response>());
    }
    return next.handle();
  }
}
