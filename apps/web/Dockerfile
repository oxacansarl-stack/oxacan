# Build context: repository root (npm workspaces monorepo).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @oxacan/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/web apps/web
# Public values only: they are compiled into the browser bundle.
ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG SUPABASE_VIA_PROXY=true
ENV SUPABASE_URL=$SUPABASE_URL SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY SUPABASE_VIA_PROXY=$SUPABASE_VIA_PROXY
RUN npm run build -w @oxacan/web

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
