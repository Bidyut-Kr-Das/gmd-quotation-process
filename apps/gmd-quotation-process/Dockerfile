ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS stage1

WORKDIR /app

# ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm i --no-audit --no-fund; \
    else \ 
        echo "no lock file" && exit 1; \
    fi

# stage 2
FROM node:${NODE_VERSION} AS stage2

WORKDIR /app

COPY --from=stage1 /app/node_modules ./node_modules 
COPY --from=stage1 /app/prisma ./prisma

COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
# 🟢 FIX: Dummy DATABASE_URL so Prisma & Next.js can generate types & build
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
# 🟢 FIX: Generate Prisma Client before building
RUN npx prisma generate

RUN if [ -f package-lock.json ]; then \
        npm run build; \
    else \
        echo "build failed" && exit 1; \
    fi



# stage 3
FROM node:${NODE_VERSION} AS stage3

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# ENV PUPPETEER_SKIP_DOWNLOAD=true


RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium \
       ca-certificates \
       fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
# Tell Puppeteer to use system Chromium
# ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=stage2 --chown=node:node /app/public ./public

RUN mkdir .next
RUN chown node:node .next

COPY --from=stage2 --chown=node:node /app/.next/standalone ./
COPY --from=stage2 --chown=node:node /app/.next/static ./.next/static


USER node 

EXPOSE 4173

CMD ["node", "server.js"]