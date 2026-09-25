-- Isolation multi-tenant en profondeur : Row-Level Security PostgreSQL.
-- L'API filtre déjà chaque requête par tenantId ; ces politiques garantissent qu'une erreur
-- applicative ne peut pas exposer les données d'une autre entreprise lorsque l'API se connecte
-- avec le rôle applicatif (oxacan_app) et positionne `app.tenant_id` (SET LOCAL) dans la transaction.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxacan_app') THEN
    CREATE ROLE oxacan_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO oxacan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oxacan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oxacan_app;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.tenant_id', true) $$;

-- Tables portant directement tenantId
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['User','CatalogueItem','ComposedArticle','Offer','Project','Invoice','DocumentSequence','AuditLog'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO oxacan_app USING ("tenantId" = current_tenant_id()) WITH CHECK ("tenantId" = current_tenant_id())', t);
  END LOOP;
END $$;

-- Tables enfants : isolation par jointure vers leur parent
ALTER TABLE "Zone" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Zone" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = "offerId" AND o."tenantId" = current_tenant_id()));
ALTER TABLE "Cfc" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Cfc" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Zone" z JOIN "Offer" o ON o.id = z."offerId" WHERE z.id = "zoneId" AND o."tenantId" = current_tenant_id()));
ALTER TABLE "Chapter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Chapter" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Cfc" c JOIN "Zone" z ON z.id = c."zoneId" JOIN "Offer" o ON o.id = z."offerId" WHERE c.id = "cfcId" AND o."tenantId" = current_tenant_id()));
ALTER TABLE "OfferLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OfferLine" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Chapter" ch JOIN "Cfc" c ON c.id = ch."cfcId" JOIN "Zone" z ON z.id = c."zoneId" JOIN "Offer" o ON o.id = z."offerId" WHERE ch.id = "chapterId" AND o."tenantId" = current_tenant_id()));
ALTER TABLE "ComposedComponent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ComposedComponent" TO oxacan_app USING (EXISTS (SELECT 1 FROM "ComposedArticle" a WHERE a.id = "composedId" AND a."tenantId" = current_tenant_id()));
ALTER TABLE "WorkLot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkLot" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Project" p WHERE p.id = "projectId" AND p."tenantId" = current_tenant_id()));
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task" TO oxacan_app USING (EXISTS (SELECT 1 FROM "WorkLot" l JOIN "Project" p ON p.id = l."projectId" WHERE l.id = "lotId" AND p."tenantId" = current_tenant_id()));
ALTER TABLE "Situation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Situation" TO oxacan_app USING (EXISTS (SELECT 1 FROM "Project" p WHERE p.id = "projectId" AND p."tenantId" = current_tenant_id()));
-- Tenant : lecture de sa propre ligne uniquement
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant" TO oxacan_app USING (id = current_tenant_id());
