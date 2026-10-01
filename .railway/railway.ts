import { defineRailway, github, preserve, project, service } from "railway/iac";

// Secrets are preserve(): their values live only in Railway (set with `railway variable set --stdin`).
const repo = github("oxacansarl-stack/oxacan", { branch: "main" });

export default defineRailway(() => {
  const api = service("api", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/api/Dockerfile",
      watchPatterns: ["apps/api/**", "packages/shared-types/**", "package-lock.json"],
    },
    preDeploy: "node apps/api/dist/config/predeploy.js",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: {
      NODE_ENV: "production",
      PORT: "8080",
      // Supabase session pooler (Zurich); the direct db.* host is IPv6-only.
      DB_HOST: "aws-0-eu-central-2.pooler.supabase.com",
      DB_PORT: "5432",
      DB_NAME: "postgres",
      DB_USERNAME: "oxacan_app.vxldcsgbgfnknlmuxvdw",
      DB_PASSWORD: preserve(),
      DB_MIGRATION_USERNAME: "postgres.vxldcsgbgfnknlmuxvdw",
      DB_MIGRATION_PASSWORD: preserve(),
      SUPABASE_URL: "https://vxldcsgbgfnknlmuxvdw.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      JWT_SECRET: preserve(),
      RLS_CONTEXT_SECRET: preserve(),
      JWT_EXPIRATION: "3600",
      SENTRY_DSN: preserve(),
      WEB_URL: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  const web = service("web", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/web/Dockerfile",
      watchPatterns: ["apps/web/**", "package-lock.json"],
    },
    healthcheck: "/",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: {
      PORT: "3000",
      // Build-time (compiled into the browser bundle) — public values only.
      SUPABASE_URL: "https://vxldcsgbgfnknlmuxvdw.supabase.co",
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_VIA_PROXY: "true",
      API_UPSTREAM: "http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080",
    },
  });

  return project("oxacan", { resources: [api, web] });
});
