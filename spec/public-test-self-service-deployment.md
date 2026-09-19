# Public TEST self-service deployment

Status: deployment-readiness documentation only. This document does not
authorize deployment, and no infrastructure has been provisioned as part of
writing it. It describes how to run the code once an operator decides to
provision a host, and the operational invariants that make doing so safe.

Scope: this covers **only** a public, unauthenticated, TEST-identifier-only
self-service deployment (`TII_DEPLOYMENT_MODE=public-self-service`). It has
no bearing on the separate production issuance process
(spec/first-production-issuance-procedure.md) or the existing static-mirror
deployment at transition-ignition-id.org, and changes nothing about either.

## 1. Core invariant

A public TEST deployment must be incapable, by default and by configuration
shape, of: issuing production identifiers; modifying the historical
production ledger; reading or signing production checkpoints; loading
production signing material; or satisfying the production gate. This is
enforced in code (`validatePublicSelfServiceDeployment()` in
`src/server.js`, run at module load, fail-closed) — this document describes
the resulting operational shape, it does not itself provide the enforcement.

## 2. Required runtime configuration

| Variable | Required | Notes |
|---|---|---|
| `TII_DEPLOYMENT_MODE` | yes | must be exactly `public-self-service` |
| `TII_SELF_SERVICE_ENABLED` | yes | must be exactly `true`, or the route 404s |
| `TII_LEDGER` | yes | must NOT resolve (lexically or via symlink) to the repository's own `data/ledger.jsonl`; startup refuses otherwise |
| `TII_CHECKPOINT_DIR` | yes | must NOT resolve to the repository's own `checkpoints/`; startup refuses otherwise. Checkpoint **signing** is unconditionally disabled in this mode regardless of this value or of any signing key present in the environment |
| `TII_TRUSTED_PROXY_HEADER` | no | unset by default (no proxy header trusted — only the TCP peer address). Set to exactly one of `x-forwarded-for`, `cf-connecting-ip`, `x-real-ip` if and only if exactly one reverse proxy sits in front of this process and appends that header itself |
| `TII_REGISTRY_LABEL` | no | human-readable label shown on TEST resolution pages (Phase 11 provenance). Leave unset to omit the provenance block entirely |
| `TII_SELF_SERVICE_RATE_LIMIT_MAX` / `_WINDOW_MS` | no | per-IP issuance quota, defaults 5 / 1 hour |
| `TII_SELF_SERVICE_GLOBAL_QUOTA_MAX` / `_WINDOW_MS` | no | global issuance quota across all callers, defaults 200 / 1 hour. In-process only — see §5 |
| `TII_SELF_SERVICE_MAX_LEDGER_BYTES` / `_MAX_EVENT_COUNT` | no | storage ceiling, defaults 50MB / 100,000 events |
| `TII_ADMIN_TOKEN` | must be left unset | admin is unreachable in this mode regardless; leaving it unset also keeps it disabled in the (unsupported) event this process were ever run outside this mode |
| `TII_CHECKPOINT_PRIVATE_KEY(_FILE)`, `TII_CHECKPOINT_KEY_PASSPHRASE(_FILE)` | must not be set | not required and never consulted in this mode (checkpoint signing is force-disabled) |

## 3. What enters the deployment image (Phase 15)

The Dockerfile in the repository root copies only `package.json`, `src/`,
and `bin/`. `.dockerignore` excludes `data/` (the committed production
ledger) and `checkpoints/` from the build context entirely — the preferred
outcome, since the TEST runtime never needs either.

As defense in depth beyond the build context exclusion: even if a future
change accidentally re-included `data/ledger.jsonl` inside the image
filesystem, `TII_LEDGER` in this mode is configured to point at
`/data/ledger/ledger.jsonl` on the mounted volume, and startup validation
independently refuses to run against the repository's own default ledger
path regardless of where that path happens to physically exist. The two
protections are independent: the `.dockerignore` exclusion is the
preferred, simpler control; the runtime path check is what actually
prevents selection even if the first control were ever weakened.

The historical production ledger in the git repository itself is untouched
by any of this — nothing in this deployment path deletes, moves, or
rewrites `data/ledger.jsonl`.

## 4. Single-writer constraint (Phase 17)

v1 MUST run as exactly one process against exactly one ledger volume:

- No Node cluster mode.
- No multiple container replicas mounting the same ledger volume.
- No horizontal autoscaling of this service.

`src/writer-lock.js` already provides real cross-process advisory locking
for the ledger file itself (a second writer against the *same* volume fails
closed rather than corrupting state — see
`test/writer-lock.test.js`/the concurrency regression tests), so a second
instance accidentally started against the same volume will not corrupt the
ledger. But it will contend for the lock and degrade availability, and nothing
in this v1 is designed to make multiple replicas a good idea — the
Dockerfile's `VOLUME ["/data"]` is a single-mount target, and any
orchestration wrapping this container (systemd, a single `docker run`, a
single-replica deployment on whatever platform is eventually chosen) must
be configured for exactly one running instance. This is a v1 operational
constraint to document and enforce by configuration, not a limitation the
code works around.

## 5. Abuse-resistance model (Phases 5-9)

Layered, in order the request encounters them: global issuance quota →
per-IP issuance quota → storage quota → body-size limit (2KB, enforced
before unbounded buffering, both via an early `Content-Length` check and a
hard stop mid-stream) → HTTP-level timeouts (`headersTimeout` 10s,
`requestTimeout` 15s, `keepAliveTimeout` 5s).

All of this is **in-process, single-instance defense-in-depth for v1**, not
a substitute for CDN/reverse-proxy-level rate limiting and DDoS protection
in a real public deployment. None of these limiters share state across
instances (consistent with the single-writer constraint above) or survive a
process restart. A production-grade public deployment should still sit
behind a CDN or reverse proxy that enforces its own connection- and
request-rate limits ahead of this process.

## 6. Backup and recovery (Phase 16)

The TEST ledger is an append-only, hash-chained JSONL file. Its only
special property versus an ordinary file for backup purposes is that a
**shorter file is never a safe substitute for a longer one** — every event
in the current ledger is a real, previously-issued identifier, and
restoring an older/shorter backup over it would resurrect a
"gap" that never legitimately existed, and could silently discard already-issued
identifiers' history.

**The one hard invariant:** never restore a backup over a live ledger if the
backup has fewer events than the current ledger. Always compare event
counts (or simply line counts, since this is JSONL) before considering a
restore.

Procedure:

1. **Snapshot.** Copy the ledger file (a plain file copy is safe — this is
   an append-only file, and a snapshot mid-append at worst omits the very
   last in-flight event, never corrupts an earlier one). Off-host copy the
   snapshot immediately after taking it; do not leave the only copy on the
   same volume as the live ledger.
2. **Restore-to-scratch verification.** Before ever restoring a backup over
   a live ledger, restore it to a **separate, disposable path** first and
   run `node bin/tii.js verify` (or `Ledger.verify()`) against that scratch
   copy. Confirm `status: VALID` and note its `event_count`.
3. **Compare before activating.** Compare the scratch copy's event count
   against the live ledger's current event count. If the scratch copy has
   **fewer** events, stop — do not restore; the live ledger already has
   later state that would be lost.
4. **Activate only after both checks pass** (chain valid, and
   count-not-decreasing): stop the single writer process, replace the live
   ledger file with the verified copy, then start the process again.
5. **Corrupted or incomplete backup:** if a backup fails `verify()` (a
   broken chain) or is truncated mid-line, treat it as unusable for
   restoration — do not attempt to hand-repair a hash-chained file. Fall
   back to an earlier snapshot that passes verification, accepting
   whatever event loss that implies, and document the gap.

No automated cloud backup provisioning is included in this v1 — the
schedule and off-host destination for snapshots is an operational decision
for whoever provisions the actual host, not something this document
provisions on its own.

## 7. Deployment manifest

`Dockerfile` (repository root) is the one minimal deployment artifact for
v1: a single-process, non-root, single-volume container image with a
`HEALTHCHECK` against `GET /healthz` and graceful `SIGTERM` handling (see
`src/server.js`'s shutdown handler, installed only when run as the main
module). No Kubernetes manifests, autoscaling configuration, or multi-replica
orchestration are included — see §4.

Minimal run example (illustrative only — this document does not provision
a host, network, or persistent volume):

```bash
docker build -t tii-public-test .
docker run -d \
  --name tii-public-test \
  -p 3009:3009 \
  -v tii-public-test-data:/data \
  tii-public-test
```

The named volume is what makes the TEST ledger persistent across container
restarts; without it, every restart begins from an empty ledger.
