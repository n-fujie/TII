# TII Domain Failure & Recovery

> Audits the Succession Policy against **permanent-domain failure** specifically.
> Makes **no** claim that the resolver domain is eternally permanent. Production
> issuance remains **DISABLED**; this document describes behaviour for a future
> production system.

## 0. Four kinds of continuity — kept separate

| Continuity | What it means | Depends on |
|---|---|---|
| **Identifier persistence** | `tii:<token>` keeps meaning what it meant | the append-only ledger + non-reuse rule — nothing else |
| **Resolver continuity** | some resolver answers `/tii/<token>` | a running service somewhere (any domain) |
| **Domain continuity** | that resolver is at the *same* domain | one registration, one registrar, one DNS zone |
| **Institutional continuity** | a particular organization still operates TII | that organization existing |

Only **identifier persistence** is an obligation. The other three can each break
and be restored without touching any identifier. The permanent domain is
*domain continuity* — the most fragile of the four, and the least important.

## 1. The recovery kit

Everything needed to restore resolution, all plain files, no proprietary
dependency (same as `succession-policy.md` §1):

- `ledger.jsonl` — the append-only record of authority;
- all signed checkpoint files (Ed25519 over RFC 8785 JCS);
- the keyset file (public keys + validity windows);
- the frozen identifier + data specifications;
- the domain/registrar/DNS operational record (registrar account, auth-code
  custody, DNS zone file, DNSSEC keys) — held by more than one steward
  representative;
- this document and `governance-candidate.md`.

Archived registry exports + signed checkpoints + at least one independent mirror
MUST always be sufficient to reconstruct resolution.

## 2. Scenario answers

### 2.1 The domain expires

- **Identifiers:** unaffected.
- **Immediate:** resolution at that domain stops; existing mirrors and cached
  exports still resolve; the identifier is still valid.
- **Recovery, in order of preference:**
  1. **Redemption / renewal.** `.org` has a ~30-day Redemption Grace Period
     after expiry during which the *same* registrant can restore it (a fee
     applies). Auto-renew + independent reminders (`resolver-domain-decision.md`
     §11) should make this the only case that ever occurs, and it is fully
     recoverable.
  2. If it drops and is re-registered by someone else: **do not buy it back
     under pressure and do not trust it.** Publish a signed checkpoint and a
     steward statement announcing a **new** resolver domain; update
     `TII_RESOLVER_BASE_URL`; announce via the source repository, the IANA
     registration record, and every mirror. A resolver at the lapsed domain
     operated by a third party is **not** authoritative (§4).
- **Prevention:** register for the maximum term; auto-renew; reminders held by
  ≥2 people; a funded renewal reserve noted in the succession kit.

### 2.2 The registrar disappears

- **Identifiers:** unaffected.
- ICANN has an emergency de-accreditation / bulk-transfer process; registrations
  are moved to a gaining registrar and remain valid.
- **Steward action:** confirm the transfer completed, re-enable registrar-lock
  and DNSSEC at the new registrar, update the operational record. No identifier
  or resolver URL changes.
- **Prevention:** hold the transfer **authorization code** in the succession kit
  so a manual transfer is possible even without registrar cooperation.

### 2.3 DNS control is lost (zone hijack, operator compromise, lost account)

- **Identifiers:** unaffected.
- **Immediate:** treat resolver output at the domain as untrusted until
  recovered. Clients can still verify a ledger head from any mirror against the
  latest **signed checkpoint** — DNS compromise cannot forge a valid signature.
- **Recovery:** regain the registrar account (registrar support + auth code +
  account recovery path in the kit), repoint nameservers, re-sign the zone,
  rotate DNSSEC keys, publish a signed checkpoint and a steward statement.
- If the registrar account itself is unrecoverable: move to §2.1 case 2 (new
  domain).

### 2.4 P/A Institute ceases operation

- **Identifiers:** unaffected.
- The Succession Policy applies: stewardship transfers to a successor
  organization or governance body, or the community continues in **read-only
  archival mode** from the recovery kit.
- The successor takes over the domain (registrar transfer via the auth code in
  the kit), the signing keyset (rotates in its own key; old checkpoints stay
  valid), and the IANA change-controller role (registry update).
- If no successor exists: a read-only mirror served from the static export is an
  acceptable indefinite steady state. Every identifier keeps resolving and
  keeps explaining its status.

### 2.5 The steward transfers (planned)

- Append `stewardship.transferred` (previous, new, effective time, evidence,
  authorization/signature, contestation).
- Hand over the recovery kit; co-sign a final checkpoint; the incoming steward
  rotates its signing key and files the IANA change-controller update.
- The domain either transfers to the new steward's control or a new domain is
  adopted at the new steward's discretion — **either way no identifier
  changes**, and the resolution-URL change (if any) is a configuration update
  announced through the mirrors and the IANA record.

### 2.6 The resolver must move to another domain

- Stand up the resolver (dependency-free; static export or the Node server) at
  the new domain.
- Set `TII_RESOLVER_BASE_URL=https://<new-domain>`; redeploy.
- Publish a signed checkpoint from the new domain; update the IANA registration
  record's specification/contact URLs; update the source repository and every
  mirror; where feasible, serve a redirect from the old domain for a
  transition period.
- `tii:<token>` is **unchanged**. Anyone holding an old resolution URL can
  recover the token (the 26 characters after `/tii/`) and re-resolve it
  anywhere.

## 3. Emergency migration mechanism (design)

Even with a chosen permanent domain, the system MUST be able to migrate
resolvers on short notice:

1. **Always-current export.** The ledger, signed checkpoints, and keyset are
   published continuously to at least: the source repository, one archival
   service, and one independent mirror.
2. **Reconstruction procedure** (documented, tested by
   `test/ledger-integrity.test.js` and `test/candidate-checkpoint.test.js`):
   - obtain `ledger.jsonl` + checkpoints + keyset from any surviving source;
   - verify the SHA-256 event chain;
   - verify the latest checkpoint's Ed25519 signature (RFC 8785 JCS of the
     checkpoint) against the keyset;
   - rebuild derived state / the static site (`node bin/tii.js rebuild-static`);
   - deploy anywhere; set `TII_RESOLVER_BASE_URL`.
3. **Authority statement.** A steward (or successor) publishes a signed
   checkpoint plus a plain-text statement naming the new authoritative resolver.
   The signature — not the domain — is what establishes authority.
4. **No identifier reissuance.** Migration never mints, retires, or rewrites an
   identifier.

Another steward could execute this today from the current public repository
alone.

## 4. Designated resolver vs. independent mirrors (restated)

- A **mirror** resolving a TII does **not** become authoritative. Authority is
  established by the current steward's signed checkpoints and the IANA
  registration record, not by the fact that a host answers.
- The **designated resolver** is not the identity of a TII. If it is gone,
  compromised, or replaced, the identifiers are intact and any conforming
  resolver — rebuilt from the recovery kit — serves them.
- Clients SHOULD surface which resolver they are using and SHOULD be able to
  check a resolver's ledger head against an independently obtained signed
  checkpoint.

## 5. What is *not* promised

- That any resolver is always online at any particular address.
- That the domain is renewed forever, or that a specific registrar persists.
- That any organization operates TII forever.
- That the referenced material persists.
- Any metaphysical or absolute permanence.

What **is** promised: `tii:<token>` and its recorded history remain recoverable
and verifiable from an exported recovery kit through every scenario in §2,
without changing any issued identifier.
