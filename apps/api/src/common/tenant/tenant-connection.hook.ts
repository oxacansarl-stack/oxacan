import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Pool, PoolClient } from 'pg';
import { tenantStorage, TenantStore } from './tenant-context';

const SET_CONTEXT_SQL = `SELECT set_config('app.company_id', $1, false),
       set_config('app.user_id', $2, false),
       set_config('app.rls_bypass', $3, false)`;

/**
 * Applies the RLS session variables on every pool checkout. The store is captured when
 * connect() is called, not when the client is handed over, because a waiting checkout is
 * fulfilled from inside another request's release() and would otherwise inherit its tenant.
 */
@Injectable()
export class TenantConnectionHook implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    const pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const originalConnect = pool.connect.bind(pool) as (
      cb: (err: Error | undefined, client: PoolClient, done: (release?: unknown) => void) => void,
    ) => void;

    (pool as any).connect = (callback?: (...args: any[]) => void) => {
      const store = tenantStorage.getStore();
      if (callback) {
        originalConnect((err, client, done) => {
          if (!err) applyContext(client, store);
          callback(err, client, done);
        });
        return undefined;
      }
      return new Promise<PoolClient>((resolve, reject) => {
        originalConnect((err, client) => {
          if (err) return reject(err);
          applyContext(client, store);
          resolve(client);
        });
      });
    };
  }
}

function applyContext(client: PoolClient, store: TenantStore | undefined) {
  // Queued on the client ahead of the caller's first query; pg runs a client's queries in order.
  client
    .query(SET_CONTEXT_SQL, [
      store?.companyId ?? '',
      store?.userId ?? '',
      store?.system ? 'on' : 'off',
    ])
    .catch(() => undefined);
}
