ARG NODE_IMAGE=node:24.1.0-bookworm-slim@sha256:5ae787590295f944e7dc200bf54861bac09bf21b5fdb4c9b97aee7781b6d95a2
ARG NGINX_IMAGE=nginx:1.28.0-bookworm@sha256:552e7481ca93ffccd046aa658dbbed22caefbc09c66fa7cd247cbb90b8a5c609

FROM ${NODE_IMAGE} AS node-base
ENV COREPACK_HOME=/pnpm/corepack \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable \
    && corepack prepare pnpm@10.12.3 --activate \
    && chmod -R a+rX /pnpm
WORKDIR /app

FROM node-base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
COPY . .
RUN pnpm build

FROM dependencies AS worker-build
COPY . .
RUN pnpm build:worker

FROM dependencies AS test
COPY . .
CMD ["pnpm", "test"]

# Worker is fully bundled except native better-sqlite3. Install only that runtime
# dependency so the image does not ship next/react/UI packages (~800MB+).
FROM node-base AS production-dependencies
WORKDIR /app
COPY package.json ./package.root.json
RUN VERSION="$(node -p "require('./package.root.json').dependencies['better-sqlite3']")" \
    && test -n "$VERSION" \
    && pnpm init \
    && pnpm pkg set pnpm.onlyBuiltDependencies[0]=better-sqlite3 \
    && pnpm add "better-sqlite3@${VERSION}" \
    && rm package.root.json

FROM ${NGINX_IMAGE} AS runtime

RUN groupadd --gid 10001 nginx-manager \
    && useradd --uid 10001 --gid nginx-manager --home-dir /opt/nginx-manager --shell /usr/sbin/nologin nginx-manager

COPY --from=node-base /usr/local/ /usr/local/

WORKDIR /opt/nginx-manager

# Ownership is set at COPY time so we never chown -R tens of thousands of files.
COPY --from=production-dependencies --chown=nginx-manager:nginx-manager /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=nginx-manager:nginx-manager /app/package.json ./package.json
COPY --from=web-build --chown=nginx-manager:nginx-manager /app/out ./ui
COPY --from=worker-build --chown=nginx-manager:nginx-manager /app/dist/worker.mjs ./worker/serve.mjs
COPY --chown=nginx-manager:nginx-manager drizzle ./drizzle
COPY docker/nginx/nginx.conf.template /etc/nginx/templates/nginx-manager.conf.template
COPY docker/scripts/start.mjs /usr/local/bin/start-nginx-manager.mjs
COPY docker/scripts/runtime-root.mjs /usr/local/bin/runtime-root.mjs

RUN mkdir -p /data/acme /data/certs /data/db /data/logs /data/nginx /data/secrets /run/nginx \
    && chown nginx-manager:nginx-manager \
      /opt/nginx-manager \
      /data /data/acme /data/certs /data/db /data/logs /data/nginx /data/secrets \
      /run/nginx

ENV APP_ENV=production \
    DB_ENGINE=sqlite \
    DB_SQLITE_DIR=/data/db \
    NGINX_LOG_DIR=/data/logs \
    NGINX_MANAGER_MASTER_KEY_FILE=/run/secrets/nginx_manager_master_key \
    PORT=8787 \
    RUNTIME_MODE=nginx-manager

USER nginx-manager

EXPOSE 8080 8443

# nginx base image sets STOPSIGNAL SIGQUIT for the master process. Our PID 1 is
# the Node supervisor, which only implements graceful drain on SIGTERM/SIGINT.
# Without this override, docker stop/recreate waits the full stop_grace_period.
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8082/internal/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "/usr/local/bin/start-nginx-manager.mjs"]
