FROM node:22-bookworm-slim

# The server is Postgres 16. Bookworm's default client is 15 and cannot dump it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates openssl curl age rclone \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
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
