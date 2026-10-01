import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Pool, PoolClient } from 'pg';
import { tenantStorage, TenantStore } from './tenant-context';
import { SET_CONTEXT_SQL, contextSecret, signedContext } from './context-signature';

/**
 * Applies the RLS session variables on every pool checkout. The store is captured when
 * connect() is called, not when the client is handed over, because a waiting checkout is
 * fulfilled from inside another request's release() and would otherwise inherit its tenant.
 */
@Injectable()
export class TenantConnectionHook implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    const secret = contextSecret();
    const pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const originalConnect = pool.connect.bind(pool) as (
      cb: (err: Error | undefined, client: PoolClient, done: (release?: unknown) => void) => void,
    ) => void;

    (pool as any).connect = (callback?: (...args: any[]) => void) => {
      const store = tenantStorage.getStore();
      if (callback) {
        originalConnect((err, client, done) => {
          if (err) return callback(err, client, done);
          applyContext(client, store, secret).then(
            () => callback(undefined, client, done),
            (e) => {
              done(e);
              callback(e, undefined, () => undefined);
            },
          );
        });
        return undefined;
      }
      return new Promise<PoolClient>((resolve, reject) => {
        originalConnect((err, client) => {
          if (err) return reject(err);
          applyContext(client, store, secret).then(
            () => resolve(client),
            (e) => {
              client.release(e);
              reject(e);
            },
          );
        });
      });
    };
  }
}

/**
 * The settings are session-level, so a pooled client still carries the previous checkout's
 * (validly signed) context. If setting the new one fails the client is destroyed, never reused.
 * Values travel as bind parameters, so neither they nor the signature show in pg_stat_activity.
 */
async function applyContext(client: PoolClient, store: TenantStore | undefined, secret: string) {
  await client.query(
    SET_CONTEXT_SQL,
    signedContext(secret, store?.companyId ?? '', store?.userId ?? '', store?.system ? 'on' : 'off'),
  );
}
