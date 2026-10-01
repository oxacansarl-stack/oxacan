import './pg-types';
import dataSource from './data-source';
import { syncContextKey } from './context-key';
import { contextSecret } from '../common/tenant/context-signature';

/**
 * Runs before each release (Railway preDeployCommand), connected as the schema owner:
 * 1. applies pending migrations and stores the RLS context signing key (RLS_CONTEXT_SECRET);
 * 2. creates/updates the non-superuser role the API runs as, so RLS applies;
 * 3. on Supabase, removes the default grants that expose public tables via the REST API.
 */
async function main() {
  // Fail before migrating: once SignedTenantContext is applied, a release without the key would
  // leave the running API's unsigned context invalid and every tenant table empty.
  contextSecret();
  await dataSource.initialize();

  const applied = await dataSource.runMigrations({ transaction: 'each' });
  console.log(applied.length ? `applied ${applied.map((m) => m.name).join(', ')}` : 'no pending migrations');
  await syncContextKey(dataSource);

  // With Supabase's pooler the login is "<role>.<project-ref>"; the database role is the first part.
  const appRole = (process.env.DB_USERNAME ?? '').split('.')[0];
  const ownerRole = (process.env.DB_MIGRATION_USERNAME ?? '').split('.')[0];
  const appPassword = process.env.DB_PASSWORD;
  if (!appRole || appRole === ownerRole || !appPassword) {
    throw new Error('DB_USERNAME must be a dedicated app role (not the migration role) with DB_PASSWORD set');
  }

  // Supabase's supautils rejects NOSUPERUSER / NOBYPASSRLS clauses from a non-superuser owner, so
  // the attributes are verified instead of re-asserted: the app role must never bypass RLS.
  const [existing] = await dataSource.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [appRole],
  );
  if (existing && (existing.rolsuper || existing.rolbypassrls)) {
    throw new Error(`app role ${appRole} must not be SUPERUSER or BYPASSRLS`);
  }
  await runGenerated(
    existing
      ? `SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql`
      : `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS sql`,
    [appRole, appPassword],
  );
  const grants = [
    'GRANT USAGE ON SCHEMA public TO %I',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
    'REVOKE INSERT, UPDATE, DELETE ON migrations FROM %I',
    'REVOKE UPDATE, DELETE ON audit_log FROM %I',
  ];
  for (const g of grants) await runGenerated(`SELECT format('${g}', $1::text) AS sql`, [appRole]);
  console.log(`app role ${appRole} ready`);

  // OXACAN never uses Supabase's REST API; don't expose any table to its anon/authenticated roles.
  const restRoles: { rolname: string }[] = await dataSource.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
  );
  for (const { rolname } of restRoles) {
    for (const stmt of [
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I',
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
    ]) {
      await runGenerated(`SELECT format('${stmt}', $1::text) AS sql`, [rolname]);
    }
    console.log(`revoked public-schema access from ${rolname}`);
  }

  await dataSource.destroy();
}

/**
 * DDL can't take bind parameters, so identifiers/literals are quoted by format() in SQL. The
 * generated statement can hold the app role's password, so a failure reports only the error,
 * never the query.
 */
async function runGenerated(generator: string, params: string[]) {
  const [{ sql }] = await dataSource.query(generator, params);
  try {
    await dataSource.query(sql);
  } catch (err) {
    const e = err as { code?: string; message?: string; detail?: string };
    throw new Error(`${sql.split(' ').slice(0, 2).join(' ')} failed: ${e.code ?? ''} ${e.message ?? ''} ${e.detail ?? ''}`.trim());
  }
}

main().catch((err) => {
  // TypeORM errors carry the failed query (and its parameters); print only the message.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
