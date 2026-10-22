# One Dockerfile for every app in the monorepo. Build context: monorepo root.
#   docker build --build-arg APP=gmd-quotation-process -t gmd-quotation-process .
#   docker build --build-arg APP=gmd-tender-dashboard -t gmd-tender-dashboard .
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# stage 1: keep only this app and the workspace packages it depends on
FROM base AS prune
ARG APP
RUN test -n "$APP" || (echo "pass --build-arg APP=<app folder name>" && exit 1)
COPY . .
RUN pnpm dlx turbo@2.11.7 prune ${APP} --docker

# stage 2: install (cached on lockfile) then build
FROM base AS build
ARG APP
COPY --from=prune /app/out/json/ .
# The root postinstall runs this script; prune does not copy it.
COPY scripts/link-env.mjs scripts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
ENV NODE_OPTIONS="--max-old-space-size=4096"
# Dummy URLs so Prisma and Next.js can generate and build without a database.
ENV QUOTATION_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV TENDER_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV STOCK_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm turbo run build --filter=${APP}

# stage 3: runtime
FROM node:${NODE_VERSION} AS runner
ARG APP

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium \
       ca-certificates \
       fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Standalone output mirrors the monorepo layout and server.js runs from the app
# folder, so runtime files (credentials.json, token.json, data/) live there too.
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP}/public ./apps/${APP}/public

WORKDIR /app/apps/${APP}
USER node
EXPOSE 3000
CMD ["node", "server.js"]
