-- Creates/updates the non-superuser role the API connects as, so RLS policies apply.
-- Run as the schema owner, once per database:
--   psql -d <db> -v app_password="$DB_PASSWORD" -f scripts/db/app-role.sql
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE oxacan_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxacan_app') \gexec
SELECT format('ALTER ROLE oxacan_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :'app_password') \gexec

GRANT USAGE ON SCHEMA public TO oxacan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oxacan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oxacan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oxacan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO oxacan_app;

REVOKE INSERT, UPDATE, DELETE ON migrations FROM oxacan_app;
REVOKE UPDATE, DELETE ON audit_log FROM oxacan_app;
