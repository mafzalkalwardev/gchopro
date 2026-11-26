FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates openssl postgresql-client age rclone \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

COPY . .

# The build needs a valid env file. It is created and removed in this layer.
# Migrations run from TypeScript source, so tsx stays installed.
RUN pnpm install --frozen-lockfile \
  && node scripts/write-ci-env.mjs \
  && pnpm build \
  && rm -f .env \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV HOME=/tmp
USER node
