import './pg-types';
import dataSource from './data-source';

/**
 * Runs before each release (Railway preDeployCommand), connected as the schema owner:
 * 1. applies pending migrations;
 * 2. creates/updates the non-superuser role the API runs as, so RLS applies;
 * 3. on Supabase, removes the default grants that expose public tables via the REST API.
 */
async function main() {
  await dataSource.initialize();

  const applied = await dataSource.runMigrations({ transaction: 'each' });
  console.log(applied.length ? `applied ${applied.map((m) => m.name).join(', ')}` : 'no pending migrations');

  // With Supabase's pooler the login is "<role>.<project-ref>"; the database role is the first part.
  const appRole = (process.env.DB_USERNAME ?? '').split('.')[0];
  const ownerRole = (process.env.DB_MIGRATION_USERNAME ?? '').split('.')[0];
  const appPassword = process.env.DB_PASSWORD;
  if (!appRole || appRole === ownerRole || !appPassword) {
    throw new Error('DB_USERNAME must be a dedicated app role (not the migration role) with DB_PASSWORD set');
  }

  await runGenerated(
    `SELECT format(
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
            THEN 'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS'
            ELSE 'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE' END,
       $1::text, $2::text) AS sql`,
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

/** DDL can't take bind parameters, so identifiers/literals are quoted by format() in SQL. */
async function runGenerated(generator: string, params: string[]) {
  const [{ sql }] = await dataSource.query(generator, params);
  await dataSource.query(sql);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
