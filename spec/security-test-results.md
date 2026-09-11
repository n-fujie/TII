# TII — Input Security Test Results

Generated 2026-09-10T16:59:56.153Z by `spec/audit/security-audit.js`.
Isolated temp ledger. 22 code-shaped content payloads + 3 hostile address/external-id values,
rendered through every output surface (resolution EN/JA, registry, projection JSON,
JSON/JSONL/CSV export, static site).

## Verdict: **No execution or structural-corruption path found**

TII deliberately does **not** reject text for resembling code (spec requirement: event content is
data). The question is whether rendering or export can cause **execution** or **structural
corruption**.

## HTML surface checks

| Surface | injected script executes | unescaped `<script>` from content | `onerror` attr from content | `svg onload` from content | `javascript:` live href | `vbscript:` live href | attribute breakout | raw NUL in output | raw bidi override in output |
|---|---|---|---|---|---|---|---|---|---|
| resolution page (EN) | no | no | no | no | no | no | no | ⚠ YES | ⚠ YES |
| resolution page (JA) | no | no | no | no | no | no | no | ⚠ YES | ⚠ YES |
| registry page | no | no | no | no | no | no | no | no | no |
| static resolution html | no | no | no | no | no | no | no | ⚠ YES | ⚠ YES |

## Structural checks

```json
{
  "jsonl_line_count": 26,
  "expected_line_count": 26,
  "every_line_parses": true,
  "crlf_in_content_broke_a_line": false,
  "csv_injection_leading_equals": false
}
```

## How content reaches the page

- Every interpolation of recorder-supplied content goes through `views.esc()`, which replaces
  `& < > "`. `<script>…` from content renders as `&lt;script&gt;…` — inert text.
- Address / external-id `value` is rendered as a link **only** when it matches
  `/^https?:\/\//`; the `href` is `esc()`-quoted, so an embedded `"` becomes `&quot;` and
  cannot break out of the attribute. `javascript:`, `data:`, `vbscript:` values are shown as
  plain `<span class="mono">` text, never as an `href`.
- `rel="noopener nofollow"` is set on rendered external links.
- The resolution page's `<details>` "authored" table shows `JSON.stringify(content)` inside a
  `<code>` that is also `esc()`-escaped.

## Observations / minor issues (not execution)

1. **Raw NUL / C0 control / bidi characters pass through into HTML and JSON as inert
   characters.** No execution, no HTML/JSON structural break. Some downstream consumers (log
   pipelines, terminals, XML) dislike NUL/bidi; the system neither strips nor flags them.
2. **CSV export** puts `content` JSON in one `"`-quoted field with `"` doubled; a leading
   `=`/`+`/`-`/`@` inside that quoted JSON is not a spreadsheet formula-injection vector
   because it is inside a quoted string, but a consumer that strips quotes and re-parses could be
   at risk. Low.
3. **No Content-Security-Policy header** is set by `src/server.js`, and the static host
   (`vercel.json`) sets none. The pages contain first-party inline `<script>` (registry filter,
   homepage resolver), so a strict CSP would need nonces/hashes. With correct escaping this is
   defence-in-depth, not a live hole.
4. **`GET /admin/hash-file`** takes an arbitrary server filesystem path and returns its
   SHA-256. It is gated by `TII_ADMIN_TOKEN` when set, but **open in single-admin mode**
   (no token). An unauthenticated arbitrary-file-read primitive if the writable server is
   exposed without a token. HIGH if the writable admin server is ever public.
5. A very long content string (tested 1 MB) is stored and rendered inline with no size limit
   (the HTTP body cap is 5 MB; the CLI has no cap). See §30.

## Production-Hardening Phase 1 update (appended 2026-09-11)

**Everything above this section is the original audit, unchanged.**

Item 4 above — `GET/POST /admin/hash-file` as an unauthenticated
arbitrary-file-read primitive when `TII_ADMIN_TOKEN` is unset, rated HIGH —
is **closed** as of this phase. Two independent fixes:

1. `authorized()` in `src/server.js` now returns `false` unconditionally
   when no admin token is configured (previously it returned `true` — "open
   in single-admin mode" is exactly the bug this closes). NO ADMIN TOKEN =
   ADMIN DISABLED, with no anonymous fallback.
2. Even with a token configured, `hash-file` no longer accepts an arbitrary
   server-side path. It requires an operator-configured safe directory
   (`TII_ADMIN_HASH_DIR`) and rejects any path — absolute, or relative with
   `..` traversal — that resolves outside it (`resolveSafeHashPath()` in
   `src/server.js`). With no safe directory configured, hashing is disabled
   entirely, not merely gated by a token.

New automated coverage: `test/admin-security.test.js` — no-token → admin
disabled entirely (page shows no forms, all mutation routes return 401);
wrong token → denied; correct token → allowed; the token never appears in
any HTML page, JSON response, or ledger/export content; an absolute path and
a `../`-traversal path are both rejected with `400` and an explicit reason;
a legitimate relative path within the configured safe directory succeeds;
and a static-export build contains no admin-named file and no `POST` form
anywhere in its output.

Full detail: [production-hardening-phase1.md](production-hardening-phase1.md)
§Admin fail-closed, [checkpoint-operation.md](checkpoint-operation.md) for
the unrelated but concurrently-added signed-checkpoint mechanism that closes
the §26-class forgery gap referenced elsewhere in this audit series.

No other item in this document changed. Items 1, 2, 3, and 5 remain exactly
as found in the original audit and are not addressed by this phase.
