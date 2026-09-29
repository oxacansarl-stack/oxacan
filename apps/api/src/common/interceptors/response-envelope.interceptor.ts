import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

/** Services return lists as { data: T[], meta: PaginationMeta }; lift them into the envelope. */
function isPaginated(r: unknown): r is { data: unknown[]; meta: Record<string, unknown> } {
  return (
    !!r &&
    typeof r === 'object' &&
    Object.keys(r).length === 2 &&
    Array.isArray((r as any).data) &&
    !!(r as any).meta &&
    typeof (r as any).meta === 'object'
  );
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(
      map((result) => {
        const timestamp = new Date().toISOString();
        if (isPaginated(result)) {
          return { data: result.data, meta: { ...result.meta, timestamp }, error: null };
        }
        return { data: result, meta: { timestamp }, error: null };
      }),
    );
  }
}
