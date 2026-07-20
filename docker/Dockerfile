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

FROM node-base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM ${NGINX_IMAGE} AS runtime

RUN groupadd --gid 10001 nginx-manager \
    && useradd --uid 10001 --gid nginx-manager --home-dir /opt/nginx-manager --shell /usr/sbin/nologin nginx-manager

COPY --from=node-base /usr/local/ /usr/local/

WORKDIR /opt/nginx-manager

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=web-build /app/out ./ui
COPY --from=worker-build /app/dist/worker.mjs ./worker/serve.mjs
COPY package.json ./package.json
COPY drizzle ./drizzle
COPY docker/nginx/nginx.conf.template /etc/nginx/templates/nginx-manager.conf.template
COPY docker/scripts/start.mjs /usr/local/bin/start-nginx-manager.mjs
COPY docker/scripts/runtime-root.mjs /usr/local/bin/runtime-root.mjs

RUN mkdir -p /data/acme /data/certs /data/db /data/logs /data/nginx /data/secrets /run/nginx \
    && chown -R nginx-manager:nginx-manager /data /opt/nginx-manager /run/nginx

ENV APP_ENV=production \
    DB_ENGINE=sqlite \
    DB_SQLITE_DIR=/data/db \
    MANAGER_TLS_CERT_FILE=/run/secrets/manager.crt \
    MANAGER_TLS_KEY_FILE=/run/secrets/manager.key \
    NGINX_LOG_DIR=/data/logs \
    NGINX_MANAGER_MASTER_KEY_FILE=/run/secrets/nginx_manager_master_key \
    PORT=8787 \
    RUNTIME_MODE=nginx-manager

USER nginx-manager

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8082/internal/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "/usr/local/bin/start-nginx-manager.mjs"]
