# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20.20.2

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/fe/package.json packages/fe/
COPY packages/be/package.json packages/be/
COPY packages/shared/package.json packages/shared/
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
RUN pnpm install --frozen-lockfile

FROM deps AS build-fe
WORKDIR /app
COPY packages/fe packages/fe
COPY packages/shared packages/shared
RUN pnpm --filter fe build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/be/package.json packages/be/
COPY packages/shared/package.json packages/shared/
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/packages/be/node_modules /app/packages/be/node_modules
COPY --from=deps /app/packages/shared/node_modules /app/packages/shared/node_modules
COPY packages/be packages/be
COPY packages/shared packages/shared
COPY --from=build-fe /app/packages/fe/dist /app/packages/fe/dist

EXPOSE 4000
CMD ["sh", "-c", "cd /app/packages/be && npx tsx --env-file=/app/.env src/index.ts"]

FROM nginx:1.27-alpine AS fe-static
COPY --from=build-fe /app/packages/fe/dist /usr/share/nginx/html
