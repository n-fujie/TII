# Deployment manifest for the PUBLIC TEST self-service deployment ONLY
# (TII_DEPLOYMENT_MODE=public-self-service). See
# spec/public-test-self-service-deployment.md for the full operational
# runbook this manifest belongs to.
#
# Scope, deliberately minimal (v1):
#   - single process, single container, single persistent volume
#   - no baked-in secrets, no production key/ledger/checkpoint material
#   - non-root runtime user
#   - one replica only — see "single-writer constraint" in the spec doc;
#     do not scale this beyond one running instance per ledger volume
#
# What is NOT in this image: the repository's own data/ledger.jsonl and
# checkpoints/ directory are excluded via .dockerignore. Even if a future
# change to .dockerignore accidentally re-included them, this mode's own
# startup validation (validatePublicSelfServiceDeployment() in
# src/server.js) refuses to run against those exact paths — the runtime
# environment below points TII_LEDGER/TII_CHECKPOINT_DIR at a dedicated
# volume instead, so there is no path by which this image could select the
# repository's own ledger even if it were present on disk inside the image.

FROM node:18-slim

WORKDIR /app

# package.json declares zero dependencies (see package.json) — nothing to
# install beyond copying the source itself.
COPY package.json ./
COPY src ./src
COPY bin ./bin

RUN useradd --system --create-home --home-dir /home/tii --shell /usr/sbin/nologin tii \
    && mkdir -p /data/ledger /data/checkpoints \
    && chown -R tii:tii /data /app

USER tii

ENV NODE_ENV=production
ENV TII_DEPLOYMENT_MODE=public-self-service
ENV TII_SELF_SERVICE_ENABLED=true
ENV TII_LEDGER=/data/ledger/ledger.jsonl
ENV TII_CHECKPOINT_DIR=/data/checkpoints
ENV PORT=3009

# Deliberately NOT set here (must be supplied by the operator, or left
# unset to keep the corresponding feature at its safe default):
#   TII_REGISTRY_LABEL, TII_TRUSTED_PROXY_HEADER,
#   TII_SELF_SERVICE_RATE_LIMIT_MAX / _WINDOW_MS,
#   TII_SELF_SERVICE_GLOBAL_QUOTA_MAX / _WINDOW_MS,
#   TII_SELF_SERVICE_MAX_LEDGER_BYTES / _MAX_EVENT_COUNT
# None of TII_CHECKPOINT_PRIVATE_KEY(_FILE), TII_CHECKPOINT_KEY_PASSPHRASE(_FILE),
# or TII_ADMIN_TOKEN are set — none are required in this mode, and admin is
# unreachable in this mode regardless of whether a token is configured.

EXPOSE 3009

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3009,path:'/healthz'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Forwards SIGTERM directly to the node process (no shell wrapper in the
# way) so the graceful-shutdown handler in src/server.js runs on `docker
# stop` / orchestrator termination.
CMD ["node", "src/server.js"]
