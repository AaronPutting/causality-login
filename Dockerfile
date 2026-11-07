# syntax=docker/dockerfile:1
#
# Two stages: `build` compiles the Next.js standalone output for apps/login (needs the full
# pnpm workspace, devDependencies, and a writable filesystem). The final stage is the stock
# zitadel/zitadel apps/login/Dockerfile unchanged except for the COPY --from=build source, so
# a later rebase only has to reconcile the first stage against README "Rebasing".
#
# apps/login depends on @zitadel/client and @zitadel/proto as workspace:* packages, same as
# upstream -- NOT pinned npm versions. Confirmed live (2026-11-07): the published npm
# @zitadel/client/@zitadel/proto versions are cut independently of zitadel/zitadel's own git
# tags (via changesets, no 1:1 mapping to a server tag), and neither 1.2.0 nor 1.3.1 matches
# what apps/login @ v4.20.1 actually expects (missing `Code`/`ConnectError` from the main
# export, missing `verifyJwt` from the /node subpath -- a real build failure, not a lint
# nit). Building both packages from this repo's own vendored `proto/` + buf, exactly like
# upstream's own CI does, is the only version-skew-free option for a trimmed sparse-checkout
# repo like this one. See README "Rebasing" step 4 before ever changing this back to an npm
# pin.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY proto ./proto
COPY packages/zitadel-client ./packages/zitadel-client
COPY packages/zitadel-proto ./packages/zitadel-proto
COPY apps/login ./apps/login
# No lockfile is carried in this repo (see README "Rebasing onto a new Zitadel release"):
# pnpm resolves the workspace fresh on every build.
RUN pnpm install --no-frozen-lockfile
# buf generate needs its own binary (downloaded by @bufbuild/buf's postinstall, already
# fetched above) and the vendored ../../proto sources copied in above.
RUN pnpm --filter @zitadel/proto run generate
RUN pnpm --filter @zitadel/client run build
WORKDIR /repo/apps/login
RUN pnpm run build

# --- everything below is the stock apps/login/Dockerfile from zitadel/zitadel @ v4.20.1 ---
FROM node:24-alpine
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
# If /.env-file/.env is mounted into the container, its variables are made available to the server before it starts up.
RUN mkdir -p /.env-file && touch /.env-file/.env && chown -R nextjs:nodejs /.env-file

COPY --from=build --chown=nextjs:nodejs /repo/apps/login/.next/standalone ./

USER nextjs
ENV HOSTNAME="::" \
    PORT="3000" \
    NODE_ENV="production" \
    NODE_OPTIONS="--use-openssl-ca --require /app/load-ssl-cert-dir.cjs" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt" \
    ZITADEL_TLS_ENABLED="false" \
    OTEL_SERVICE_NAME="causality-login" \
    OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/node", "/app/healthcheck.mjs", "/ui/v2/login/ready"]
ENTRYPOINT ["/app/entrypoint.sh", "node", "apps/login/server.js"]
