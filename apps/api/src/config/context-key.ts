import type { DataSource } from 'typeorm';
import type { PoolClient } from 'pg';
import { contextSecret } from '../common/tenant/context-signature';

/**
 * Stores RLS_CONTEXT_SECRET where the database's policy functions read it (app_private is
 * readable by the schema owner only). Run as the owner after migrations; the API itself cannot.
 * Goes through the raw pg client so TypeORM's query logging (on in development) never prints it.
 */
export async function syncContextKey(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    const client = (await runner.connect()) as PoolClient;
    await client.query(
      `INSERT INTO app_private.context_key (id, secret) VALUES (true, $1)
       ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret`,
      [contextSecret()],
    );
  } finally {
    await runner.release();
  }
  console.log('RLS context key in place');
}
