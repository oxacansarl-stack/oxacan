import { MigrationInterface, QueryRunner } from 'typeorm';

// The RLS context (app.company_id / app.user_id / app.rls_bypass) is a session setting any role
// can change with set_config(), so a SQL injection could switch company or enable the bypass.
// From now on the API also sets app.context_sig = HMAC-SHA256(secret, "company|user|bypass") and
// the policy functions only honour a context with a valid signature. The secret lives in a private
// schema the app role cannot read; predeploy / run-migrations write it from RLS_CONTEXT_SECRET.
// Without a stored secret no context is valid: tenant tables look empty rather than open.
export class SignedTenantContext1727500000019 implements MigrationInterface {
  name = 'SignedTenantContext1727500000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE SCHEMA IF NOT EXISTS app_private;
      REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
      -- Needed to call app_private.context_valid(); the table itself gets no grants.
      GRANT USAGE ON SCHEMA app_private TO PUBLIC;

      CREATE TABLE IF NOT EXISTS app_private.context_key (
        id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
        secret TEXT NOT NULL CHECK (length(secret) >= 32)
      );
      REVOKE ALL ON app_private.context_key FROM PUBLIC;

      -- hmac() is called schema-qualified and search_path holds only pg_catalog: pgcrypto sits in
      -- "extensions" on Supabase and in "public" locally, and a SECURITY DEFINER function must not
      -- resolve it through a schema other roles can create objects in.
      DO $do$
      DECLARE crypto_schema text;
      BEGIN
        SELECT n.nspname INTO STRICT crypto_schema
          FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pgcrypto';
        EXECUTE format($f$
          CREATE FUNCTION app_private.context_valid() RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
          AS $body$
            SELECT coalesce(
              current_setting('app.context_sig', true) = encode(%I.hmac(
                coalesce(current_setting('app.company_id', true), '') || '|' ||
                coalesce(current_setting('app.user_id', true), '') || '|' ||
                coalesce(current_setting('app.rls_bypass', true), ''),
                (SELECT secret FROM app_private.context_key), 'sha256'), 'hex'),
              false)
          $body$
        $f$, crypto_schema);
      END
      $do$;
      REVOKE ALL ON FUNCTION app_private.context_valid() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION app_private.context_valid() TO PUBLIC;

      CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT CASE WHEN app_private.context_valid()
          THEN NULLIF(current_setting('app.company_id', true), '')::uuid END
      $$;
      CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on' AND app_private.context_valid()
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
      $$;
      CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on'
      $$;
      DROP SCHEMA app_private CASCADE;
    `);
  }
}
