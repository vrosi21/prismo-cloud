FROM node:22-alpine AS web
WORKDIR /src
RUN corepack enable
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ ./
RUN pnpm build

FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /src/dist /srv
