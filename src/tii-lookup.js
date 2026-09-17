'use strict';

/**
 * The single, shared, profile-agnostic primitive for LOOSE, best-effort
 * interpretation of a user- or operator-supplied TII reference — used
 * wherever a human types or pastes a `tii:` string and expects it to
 * resolve, tolerant of case and a trailing RFC 3986 fragment.
 *
 * This is NOT the normative syntax validator for either identifier
 * profile — that role stays exactly where it already correctly lives:
 *   - src/identifier.js: the frozen PRODUCTION profile (26-char Base32),
 *     with its own strict parseCanonicalTII/parseTIIReference — rejects
 *     whitespace/case anomalies with specific error codes. Do not route
 *     that parser's input through splitFragment() first; doing so would
 *     silently forgive exactly the anomalies it exists to reject.
 *   - src/id.js: the PROVISIONAL test profile (12-char Crockford-ish),
 *     with its own isWellFormedTII.
 * Neither profile's alphabet/length rules are duplicated here, and this
 * module must never be extended to also perform strict validation —
 * that would re-create the exact drift this module exists to eliminate.
 *
 * splitFragment() exists because THREE independent call sites each need
 * exactly this generic step (trim, lowercase, split off a `#fragment`
 * per RFC 3986 §3.5 — "everything from the first # to the end") and,
 * before this module existed, each reimplemented it by hand and drifted:
 *   - src/server.js `resolveIdentifier()` (the dynamic resolver)
 *   - the client-side resolve script src/views.js embeds into the
 *     homepage — the ACTUAL code path the deployed static site runs,
 *     since it never executes src/server.js at all. That copy embeds
 *     this exact function's source via splitFragment.toString(), so the
 *     static build and the dynamic server run byte-identical logic, not
 *     merely equivalent logic (see test/tii-lookup.test.js).
 *   - bin/tii.js `show`/`events` (CLI convenience lookup)
 *
 * Written in old-style function/var syntax (no arrow functions, no
 * destructuring, no template literals) specifically so it degrades
 * correctly wherever it is embedded — including as inline `<script>`
 * text on the static site, where the served bytes must run in any
 * browser the site supports, not just current Node.
 */
function splitFragment(input) {
  var v = String(input || '').trim().toLowerCase();
  var h = v.indexOf('#');
  return h === -1 ? { base: v, fragment: null } : { base: v.slice(0, h), fragment: v.slice(h + 1) };
}

module.exports = { splitFragment };
