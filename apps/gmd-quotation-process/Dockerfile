# Build context: monorepo root.
#   docker build -f apps/gmd-quotation-process/Dockerfile .
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
COPY . .
RUN pnpm dlx turbo@2.11.7 prune gmd-quotation-process --docker

# stage 2: install (cached on lockfile) then build
FROM base AS build
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
ENV NODE_OPTIONS="--max-old-space-size=4096"
# Dummy URLs so Prisma and Next.js can generate and build without a database.
ENV QUOTATION_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV TENDER_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm turbo run build --filter=gmd-quotation-process

# stage 3: runtime
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium \
       ca-certificates \
       fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Standalone output mirrors the monorepo layout; server.js chdirs into the app
# folder, so runtime files (credentials.json, token.json) live there too.
COPY --from=build --chown=node:node /app/apps/gmd-quotation-process/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/gmd-quotation-process/.next/static ./apps/gmd-quotation-process/.next/static
COPY --from=build --chown=node:node /app/apps/gmd-quotation-process/public ./apps/gmd-quotation-process/public

USER node

EXPOSE 4173

CMD ["node", "apps/gmd-quotation-process/server.js"]
