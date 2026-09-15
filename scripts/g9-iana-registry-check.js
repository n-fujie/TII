#!/usr/bin/env node
'use strict';
/**
 * G9 — read-only check of the official IANA URI Schemes registry for an
 * exact `tii` entry. No production side effects: makes one HTTPS GET
 * request, parses the response, prints a JSON verdict, exits. Never writes
 * to any file, never touches the ledger, never mutates repo state.
 *
 * Usage: node scripts/g9-iana-registry-check.js
 *
 * This does NOT, by itself, make G9 PASS. It only reports what the
 * registry currently shows. Recording G9 = PASS is a separate,
 * deliberate documentation step (spec/post-iana-enablement-runbook.md
 * step 2), performed only after a human has seen this result.
 */

const REGISTRY_URL = 'https://www.iana.org/assignments/uri-schemes/uri-schemes.xhtml';

async function main() {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) {
    console.log(JSON.stringify({ ok: false, error: `registry fetch failed: HTTP ${res.status}`, checked_at: new Date().toISOString() }, null, 2));
    process.exitCode = 1;
    return;
  }
  const html = await res.text();

  // The registry is a plain HTML table; each row's first cell is the
  // scheme name. Match table rows and pull the first <td>/<th> text.
  const rowRe = /<tr[^>]*>\s*<t[dh][^>]*>([^<]*)<\/t[dh]>/gi;
  const exactMatches = [];
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cell = m[1].trim();
    if (cell.toLowerCase() === 'tii') exactMatches.push(cell);
  }

  const containsTiiSubstring = /(^|>)\s*tii\s*(<|$)/im.test(html);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked_at: new Date().toISOString(),
        registry_url: REGISTRY_URL,
        exact_tii_entry_found: exactMatches.length > 0,
        exact_match_count: exactMatches.length,
        note: exactMatches.length > 0
          ? 'tii found as an exact scheme-name entry -- read the live page yourself to confirm its Status column before treating G9 as PASS'
          : 'no exact "tii" entry found -- submission is not yet reflected in the registry (or IANA has not processed it yet)',
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message, checked_at: new Date().toISOString() }, null, 2));
  process.exitCode = 1;
});
