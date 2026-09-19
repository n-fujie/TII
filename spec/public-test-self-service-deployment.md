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
| `TII_TRUSTED_PROXY_HEADER` | no | unset by default (no proxy header trusted — only the TCP peer address). Set to exactly one of `x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`, `fly-client-ip` if and only if exactly one reverse proxy sits in front of this process and appends that header itself. On Fly.io specifically, prefer `fly-client-ip` over `x-forwarded-for` — Fly sets it itself as a single trustworthy value, whereas Fly's own docs describe `X-Forwarded-For` there as a client-influenceable chain |
| `TII_TRUSTED_PROXY_CIDRS` | **yes, when `TII_TRUSTED_PROXY_HEADER=cf-connecting-ip`** (startup refuses an empty/unset value in that combination) | comma-separated CIDR allowlist (IPv4 and/or IPv6) of the proxy source networks allowed to make `CF-Connecting-IP` trustworthy — see §9a. Ignored/not required in `fly-client-ip` mode. A malformed entry, in any mode, fails startup immediately (mirrors `TII_TRUSTED_PROXY_HEADER`'s own eager validation) |
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

## 8. Selected host and provisioning runbook

**SELECTED TEST HOST: Fly.io.** A Fly Volume attaches to exactly one Fly
Machine in one region — the platform itself enforces the single-writer
constraint (§4) rather than relying only on `src/writer-lock.js` and
operator discipline. It deploys directly from the repository's `Dockerfile`,
`fly.toml` supports a native HTTP health check against `/healthz`, pricing
is fixed per allocated resource (no request-based billing surprises), and
volume snapshots give built-in backup. `fly.toml` is prepared at the
repository root (deliberately left uncommitted pending review).

Everything below is **prepared, not yet executed** — no Fly.io app, volume,
or DNS record exists yet as of this writing. Commands are given so an
operator with Fly.io account access can run them; none has been run from
this environment, which has no Fly.io credentials.

Target architecture actually being provisioned:

```
Public Internet → Cloudflare (DNS + proxy, free tier) → Fly.io app (single Machine) → Fly Volume (/data)
```

Cloudflare (proxied/orange-cloud DNS) is the CDN/reverse-proxy layer: it
terminates the edge, offers a free-tier WAF and Bot Fight Mode, gives
edge-level rate limiting, and — critically for Phase 9's "fast route-level
emergency block" requirement — a Cloudflare rule can block or challenge
`/self-service/issue` instantly without touching the application or
redeploying it. `TII_TRUSTED_PROXY_HEADER=cf-connecting-ip` matches this
arrangement (Cloudflare sets `CF-Connecting-IP` to the true client
regardless of hops before it). If Fly's own edge is ever used with no
separate CDN in front, `fly-client-ip` is also a supported allowlist entry.

### Phase 6 — persistent storage

```bash
fly volumes create tii_test_data --region iad --size 1 --app tii-public-test
```

One volume, one region, matching `fly.toml`'s `[[mounts]]` `source`. Fly
enforces at most one Machine attaching a given volume, satisfying "only the
TEST service mounts it." No production artifact is placed on it — the
initial directory structure (`/data/ledger/`, `/data/checkpoints/`) is
created by the container's own startup path (`fs.mkdtempSync`-equivalent
directory creation is not needed; `Ledger` creates its file lazily and
`checkpoints/` is created by `checkpointStore` on first use), not seeded
with anything copied from this repository or from `~/.tii-production`.
Per the task's explicit instruction, no identifier is issued merely to
initialize the volume — an empty ledger is valid startup state (confirmed:
`new Ledger(file).load()` on a nonexistent file starts at zero events, see
`src/ledger.js` and the existing test suite's own fresh-ledger fixtures).

### Phase 7 — deploy with issuance disabled

```bash
fly launch --copy-config --name tii-public-test --no-deploy   # first time only; reuses the prepared fly.toml
fly deploy --app tii-public-test
```

`fly.toml` already pins `TII_SELF_SERVICE_ENABLED = "false"`. Post-deploy
checks (run against the assigned `*.fly.dev` hostname before any custom
domain is attached):

```bash
curl -s https://tii-public-test.fly.dev/healthz
curl -s -H 'Accept: application/json' https://tii-public-test.fly.dev/verify
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tii-public-test.fly.dev/self-service/issue   # expect 404 (disabled)
curl -s -o /dev/null -w '%{http_code}\n' https://tii-public-test.fly.dev/admin                          # expect 404 (public-self-service mode)
```

Confirm via `fly ssh console --app tii-public-test -C 'cat /proc/1/environ'`-free means (avoid printing secrets/env over SSH in a transcript) or simply via the `/healthz` JSON body (`ledger_readable`, `chain_valid`, `deployment_mode`) that the TEST ledger path is the mounted volume and checkpoint auto-signing is inactive — both already guaranteed structurally by `TII_DEPLOYMENT_MODE=public-self-service` (§1-§2), independent of what this specific host happens to report.

### Phase 8 — restart persistence

```bash
fly machine list --app tii-public-test               # note the Machine ID
fly machine restart <machine-id>                      # in-place restart, same volume
curl -s https://tii-public-test.fly.dev/verify         # event_count/head_hash must be identical before/after
fly deploy --app tii-public-test                       # a full redeploy, distinct from a restart
curl -s https://tii-public-test.fly.dev/verify         # re-check after redeploy too
```

An empty ledger's `event_count: 0` / a fixed `head_hash` for the empty-chain
case is sufficient to prove persistence — no disposable TEST event needs to
be issued for this check. (Per the task's explicit instruction: if at some
point a real issued event were judged necessary to demonstrate persistence
beyond what the empty-chain case shows, that would be flagged and held for
a separate explicit decision, not issued silently. It was not needed here.)

### Phase 9 — CDN / reverse proxy (Cloudflare)

1. Add the `transition-ignition-id.org` zone to Cloudflare if not already
   there for DNS purposes — **only the new TEST subdomain record is
   touched (§10); the existing production A/CNAME record for the bare
   domain is left exactly as it is.**
2. Create `test.transition-ignition-id.org` as a CNAME to
   `tii-public-test.fly.dev`, proxied (orange cloud) — this is what makes
   Cloudflare the edge instead of exposing the Fly hostname directly.
3. Enable Bot Fight Mode (free tier) and a WAF rate-limiting rule scoped to
   `POST /self-service/issue` (e.g., N requests per IP per minute — this is
   the *edge* rate limit; the application's own per-IP/global/storage
   limiters in `src/server.js` remain as defense-in-depth behind it, not a
   replacement for it).
4. Prepare (do not yet enable) one emergency WAF rule that blocks or
   challenges all requests to `/self-service/issue` — this is the "fast
   route-level emergency block" kill-switch, togglable in seconds without a
   deploy.
5. Confirm Cloudflare's proxy status is the only public-facing edge — the
   Fly `*.fly.dev` hostname still resolves directly, which is a normal Fly
   characteristic; there is no way to fully hide it, so the application's
   own controls (rate limits, quotas, deployment-mode gating) must hold
   regardless of which hostname a request arrives through. This is already
   true, since none of `src/server.js`'s checks depend on which hostname
   was used.

### Phase 9a — trusted proxy origin validation (why step 5 above is not optional)

**Cloudflare edge controls are not a security boundary by themselves.**
Nothing stops a request from reaching the Fly origin directly at its
`*.fly.dev` hostname, entirely bypassing Cloudflare's WAF, Bot Fight Mode,
and edge rate limiting — Fly does not offer a way to make an app's origin
network-unreachable to the public internet, and this document does not
claim otherwise unless real infrastructure configuration later proves it
(e.g. a Fly private-networking-only setup, which v1 does not use). A
request built by hand can set `CF-Connecting-IP` to any value it likes; the
header's mere presence proves nothing about whether Cloudflare actually
touched the request.

**Application-level trusted-origin validation is therefore required for the
public write endpoint.** `src/server.js` implements this: in
`public-self-service` mode with `TII_TRUSTED_PROXY_HEADER=cf-connecting-ip`,
`CF-Connecting-IP` is trusted only after confirming that the immediate peer
Fly itself reports (`Fly-Client-IP`) belongs to one of the networks listed
in `TII_TRUSTED_PROXY_CIDRS`. A request whose `Fly-Client-IP` peer is
outside that allowlist — i.e. one that reached the Fly origin without
passing through Cloudflare — has its `POST /self-service/issue` call
rejected with `403 proxy-origin-untrusted`, never silently treated as an
ordinary (if untrusted) client IP. Read-only routes (`/healthz`, `/verify`,
resolution pages) are unaffected by this check; only the write path enforces
it, per the smallest-necessary-change principle for this hardening pass.

**Two supported, unambiguous topologies** (see §2's config table and
`src/server.js`'s `selfServiceClientIp()`):

| | `TII_TRUSTED_PROXY_HEADER` | `TII_TRUSTED_PROXY_CIDRS` | Behavior |
|---|---|---|---|
| **A. Fly-direct** | `fly-client-ip` | not required | `Fly-Client-IP` used directly as client identity; no Cloudflare edge protection exists in this topology — do not deploy this way if edge abuse protection (Phase 9) matters, since there is then no CDN layer at all. Any `CF-Connecting-IP` header is ignored outright. |
| **B. Fly + Cloudflare** | `cf-connecting-ip` | **required, non-empty** (startup fails otherwise) | `CF-Connecting-IP` accepted only once `Fly-Client-IP` is confirmed to be a Cloudflare edge address; otherwise the write is rejected. |

These two modes cannot be combined ambiguously — the deployment sets
exactly one `TII_TRUSTED_PROXY_HEADER` value, and the CIDR check only ever
activates for `cf-connecting-ip`.

**Obtaining and maintaining the Cloudflare CIDR allowlist.** The value
baked into `fly.toml`'s `TII_TRUSTED_PROXY_CIDRS` was copied by hand from
Cloudflare's own published pages,
[cloudflare.com/ips-v4](https://www.cloudflare.com/ips-v4) and
[cloudflare.com/ips-v6](https://www.cloudflare.com/ips-v6), on 2026-09-19.
**This application does not fetch, cache, or auto-update this list at
startup or at request time** — there is no outbound network call anywhere
in this code path, by design (per this task's explicit instruction not to
silently download Cloudflare's ranges at runtime). Operationally:

- Before each deploy, re-fetch both pages and diff against the current
  `fly.toml` value; Cloudflare's ranges change infrequently but not never.
- A stale allowlist fails safe, not open: an address Cloudflare has since
  added that is missing from the list is simply treated as an untrusted
  peer (requests routed through it get a false-positive 403), never as an
  unauthenticated bypass. An address Cloudflare has since retired that is
  still in the list is a narrow residual trust window, not an open bypass
  by itself (an attacker would additionally need to originate from that
  now-unassigned address range).
- There is no dependency on this repository or its own release cadence to
  keep the list current — it lives entirely in deployment configuration
  (`fly.toml` / Fly secrets), not in source code, so it can be updated
  without a code change or a new commit.

### Phase 10 — DNS

`test.transition-ignition-id.org` (Phase 9, step 2) is the only DNS change.
The existing bare-domain record for `transition-ignition-id.org` (the
Vercel-hosted static production mirror) is not touched, repointed, or
otherwise modified by any of this — different provider, different record,
different zone entry.

### Phase 11 — public route exposure (Cloudflare rule)

A Cloudflare "WAF custom rule" or "Configuration Rule" restricting which
paths reach the origin at all is optional (the application already 404s
`/admin` in this mode — §Phase 10 of the prior hardening commit), but as
defense-in-depth, prepare a rule blocking any request path matching
`^/admin` before it reaches Fly. No filesystem or debug endpoint exists in
this codebase to additionally block (confirmed: `src/server.js`'s route
table has no such route).

### Phase 12 — abuse controls (inventory)

| Layer | Control | Where |
|---|---|---|
| Edge | IP rate limit on `/self-service/issue` | Cloudflare WAF rule (Phase 9) |
| Edge | Bot Fight Mode | Cloudflare |
| Edge | Emergency block rule (prepared, disabled) | Cloudflare |
| Application | Per-IP quota | `TII_SELF_SERVICE_RATE_LIMIT_MAX`/`_WINDOW_MS` |
| Application | Global quota | `TII_SELF_SERVICE_GLOBAL_QUOTA_MAX`/`_WINDOW_MS` |
| Application | Storage quota | `TII_SELF_SERVICE_MAX_LEDGER_BYTES`/`_MAX_EVENT_COUNT` |
| Application | Body limit | 2KB, hardcoded in `src/server.js` |
| Application | HTTP timeouts | `headersTimeout`/`requestTimeout`/`keepAliveTimeout`, hardcoded |
| Platform | Upstream request/body limit | Fly's proxy has its own default request size ceiling ahead of the app |

Values in `fly.toml` are deliberately conservative (5/hour per IP, 200/hour
global, 50MB/100k-event storage ceiling) — this is a TEST issuance service,
not a throughput target.

### Phase 13 — backup

```bash
fly volumes snapshots list <volume-id> --app tii-public-test   # Fly takes automatic daily snapshots of volumes by default
fly volumes snapshots create <volume-id> --app tii-public-test  # on-demand snapshot, e.g. right after initial provisioning
```

Fly volume snapshots are read-only copies; taking one does not modify the
live volume. Restore-to-scratch verification: `fly volumes create` a new
scratch volume from a snapshot, attach it to a throwaway Machine, run
`node bin/tii.js verify` against it, and only then consider promoting it —
matching §6's never-restore-fewer-events invariant. This uses Fly's own
snapshot credentials/mechanism, entirely separate from whatever backup
system (if any) protects the historical production ledger in this git
repository. Retention: Fly's default snapshot retention (currently ~5 days
on the free/shared tier) is the starting policy; document any change if the
operator configures a longer retention window later.

### Phase 14 — monitoring

Minimum viable, using Fly's built-in surfaces plus the app's own
`/healthz`:

- Fly's platform already tracks Machine health-check status (the
  `[[services.http_checks]]` block in `fly.toml`) and restart counts —
  visible via `fly status --app tii-public-test` and Fly's dashboard.
- `fly logs --app tii-public-test` for request-level 5xx/429 rates (Fly's
  proxy access logs include status codes; no ledger note content is logged
  by the application itself — confirmed in the prior hardening pass, §18
  abuse/privacy invariants).
- Volume usage: `fly volumes list --app tii-public-test` reports allocated
  vs. used size.
- Ledger-verification-failure and quota-exhaustion signals are already
  exposed read-only via `/healthz` (`chain_valid`) and `/verify`
  (`registry_status`) — an external uptime check (even a simple periodic
  `curl` from any monitoring service) against `/healthz` covers
  process-health, disk-readability, and chain-validity in one call.
- No production secret of any kind is sent to Fly's or Cloudflare's
  logging/monitoring surfaces, since none is ever loaded by this process in
  this deployment mode (§1-§3).

## 9. Network isolation

`TEST → PRODUCTION MUTATION PATH: NONE` — established as follows:

- No production volume is mounted on the Fly Machine (only `tii_test_data`,
  §6).
- No production filesystem path exists inside the container image (§3;
  `data/` and `checkpoints/` are excluded via `.dockerignore`).
- No production SSH/host credential is placed on the Fly Machine — `fly
  ssh console` (if ever used) authenticates via the operator's own Fly
  account, not any credential stored on the box, and nothing on the box
  grants access to the operator's laptop or its `~/.tii-production`
  directory.
- No production signing key or passphrase is set as a Fly secret or `env`
  value (§5; `fly.toml` and this runbook never reference
  `TII_CHECKPOINT_PRIVATE_KEY(_FILE)` or `TII_CHECKPOINT_KEY_PASSPHRASE(_FILE)`).
- The production gate (`src/production-gate.js`) is never imported by
  anything reachable from this deployment; `src/production-issuance.js` is
  never imported by `src/server.js` at all (permanent regression test,
  `test/production-gate.test.js` §0).
- No production checkpoint directory is reachable — `TII_CHECKPOINT_DIR`
  points at the Fly volume, and startup validation independently refuses
  the repository's own `checkpoints/` path regardless.
- This deployment's Fly and Cloudflare accounts have no API scope over the
  Vercel project (`tiiarchive`) that serves the production static mirror —
  they are entirely separate providers/accounts with no shared credential,
  so nothing on the TEST host can mutate the Vercel deployment.
