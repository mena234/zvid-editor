# editor/Dockerfile — Nuxt 3 SPA editor served by Nitro (editor.zvid.io)
# ssr:false, but the shell is rendered by Nitro at request time, so
# NUXT_ORCH_URL / NUXT_PUBLIC_* env vars are honored at runtime.
# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Resolve packages from the lockfile only — this layer caches until the lockfile changes
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

ENV NODE_ENV=production
RUN pnpm run build

FROM node:22-alpine

ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000

WORKDIR /app
COPY --from=build /app/.output ./.output

EXPOSE 3000
USER node

CMD ["node", "--env-file-if-exists=/app/.env.production", ".output/server/index.mjs"]
