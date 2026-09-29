import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

@Injectable()
export class RlsContextMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const companyId = (req as any).companyId;
    if (!companyId) {
      next();
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.query(
        `SELECT set_config('app.company_id', $1, false)`,
        [companyId],
      );
      await queryRunner.query(`SELECT set_config('app.user_id', $1, false)`, [
        (req as any).userId || '',
      ]);
      await queryRunner.query(
        `SELECT set_config('app.user_role', $1, false)`,
        [(req as any).userRole || ''],
      );
    } catch {
      await queryRunner.release();
      next();
      return;
    }

    res.on('finish', () => {
      queryRunner
        .query(`SELECT set_config('app.company_id', '', false)`)
        .catch(() => {})
        .finally(() => queryRunner.release());
    });

    next();
  }
}
