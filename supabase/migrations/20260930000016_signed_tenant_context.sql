-- The RLS context is only honoured when signed: app.context_sig = HMAC-SHA256(secret, "company|user|bypass").
-- The secret is written into app_private.context_key by the API's predeploy step (RLS_CONTEXT_SECRET).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
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
