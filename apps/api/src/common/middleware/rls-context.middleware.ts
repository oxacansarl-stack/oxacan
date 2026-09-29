import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantStorage } from '../tenant/tenant-context';

/** Opens an empty per-request tenant scope; CompanyContextGuard fills it after authentication. */
@Injectable()
export class RlsContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    tenantStorage.run({}, () => next());
  }
}
