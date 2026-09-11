#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { Ledger } = require('../src/ledger');
const { project } = require('../src/projection');
const { sha256File } = require('../src/hash');
const { canonicalize } = require('../src/canonical');
const { sha256 } = require('../src/hash');
const exporters = require('../src/export');
const recovery = require('../src/recovery');
const checkpointStore = require('../src/checkpoint-store');
const statusModule = require('../src/status');

const DATA_FILE = process.env.TII_LEDGER || path.join(__dirname, '..', 'data', 'ledger.jsonl');

function load() {
  return new Ledger(DATA_FILE).load();
}

const [, , cmd, ...args] = process.argv;

function usage() {
  console.log(`tii — Transition-Ignition Identifier CLI (PROVISIONAL / test identifiers)

  tii issue [--recorder ID] [--note TEXT]
  tii append --file event.json           # {tii,event_type,recorder,content,...}
  tii show <tii>                         # projected view (JSON)
  tii events <tii>
  tii list
  tii verify                            # ledger CHAIN INTEGRITY only (VALID/INVALID) — not authenticity, see checkpoint
  tii hash-file <path>                  # SHA-256 of a file
  tii export <json|jsonl|csv>           # to stdout
  tii rebuild-static [outDir]           # reconstruct static site from ledger.jsonl

  tii status                            # all operational states, reported separately (§35)

  tii checkpoint create [--dir DIR]     # sign the CURRENT ledger head (fails closed: no key => error)
  tii checkpoint verify [--dir DIR] [--file FILE]
  tii checkpoint list [--dir DIR]
  tii checkpoint keygen [--out-dir DIR] # explicit key generation — never automatic, never committed

  tii recover inspect                   # non-destructive diagnostic
  tii recover truncate-tail             # DESTRUCTIVE: removes exactly the malformed tail, backs up first
  tii recover commit-journal            # completes a pending write-ahead journal entry, if safe
  tii recover discard-journal           # removes an orphaned journal WITHOUT applying it

Env: TII_LEDGER, TII_CHECKPOINT_DIR, TII_CHECKPOINT_PRIVATE_KEY(_FILE), TII_ADMIN_TOKEN
`);
}

function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

try {
  switch (cmd) {
    case 'issue': {
      const ledger = load();
      const { tii, event } = ledger.issueTII({
        recorder: flag('--recorder', 'cli'),
        content: flag('--note') ? { tracking_started_note: flag('--note') } : {},
        idempotency_key: flag('--idempotency-key'),
      });
      console.log(JSON.stringify({ tii, event }, null, 2));
      break;
    }
    case 'append': {
      const file = flag('--file');
      if (!file) throw new Error('--file required');
      const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ledger = load();
      const event = ledger.append(spec);
      console.log(JSON.stringify(event, null, 2));
      break;
    }
    case 'show': {
      const ledger = load();
      console.log(JSON.stringify(project(ledger.forTII(args[0])), null, 2));
      break;
    }
    case 'events': {
      const ledger = load();
      console.log(JSON.stringify(ledger.forTII(args[0]), null, 2));
      break;
    }
    case 'list': {
      const ledger = load();
      for (const t of ledger.listTIIs()) console.log(t);
      break;
    }
    case 'verify': {
      // LEDGER CHAIN INTEGRITY ONLY. This is claim (A), not claim (B) — see
      // `tii checkpoint verify` and spec/checkpoint-operation.md §1. A green
      // result here does NOT mean the history was never fully rewritten.
      const ledger = load();
      const v = ledger.verify();
      console.log(JSON.stringify({ claim: 'ledger_chain_integrity', status: v.ok ? 'VALID' : 'INVALID', ...v }, null, 2));
      process.exit(v.ok ? 0 : 1);
      break;
    }
    case 'hash-file': {
      console.log(sha256File(args[0]));
      break;
    }
    case 'export': {
      const ledger = load();
      const fmt = args[0];
      if (fmt === 'json') process.stdout.write(exporters.toJSON(ledger) + '\n');
      else if (fmt === 'jsonl') process.stdout.write(exporters.toJSONL(ledger));
      else if (fmt === 'csv') process.stdout.write(exporters.toCSV(ledger));
      else throw new Error('format must be json|jsonl|csv');
      break;
    }
    case 'rebuild-static': {
      const ledger = load();
      const out = args[0] || path.join(__dirname, '..', 'dist');
      const result = exporters.buildStaticSite(ledger, out);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const status = statusModule.getOperationalStatus({
        ledgerFile: DATA_FILE,
        checkpointDir: flag('--checkpoint-dir'),
        adminTokenConfigured: !!process.env.TII_ADMIN_TOKEN,
      });
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'checkpoint': {
      const sub = args[0];
      const dir = flag('--dir');
      if (sub === 'create') {
        const ledger = load();
        const result = checkpointStore.createCheckpoint(ledger, { dir });
        console.log(
          JSON.stringify(
            { action: 'checkpoint create', file: result.file, checkpoint: result.signed.checkpoint, key_id: result.signed.key_id, ledger_chain_integrity: result.ledger_chain_valid ? 'VALID' : 'INVALID' },
            null,
            2
          )
        );
        break;
      }
      if (sub === 'verify') {
        const ledger = load();
        const result = checkpointStore.verifyCheckpoint(ledger, { dir, file: flag('--file') });
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.status === 'VERIFIED' ? 0 : 1);
        break;
      }
      if (sub === 'list') {
        console.log(JSON.stringify(checkpointStore.listCheckpoints(dir), null, 2));
        break;
      }
      if (sub === 'keygen') {
        const { generateKeypair } = require('../src/checkpoint');
        const kp = generateKeypair();
        const outDir = flag('--out-dir', dir || checkpointStore.checkpointsDir());
        fs.mkdirSync(outDir, { recursive: true });
        const privPath = path.join(outDir, `signing-key-${kp.keyId}.private.pem`);
        const pubPath = path.join(outDir, `signing-key-${kp.keyId}.public.pem`);
        fs.writeFileSync(privPath, kp.privateKeyPem, { mode: 0o600 });
        fs.writeFileSync(pubPath, kp.publicKeyPem);
        console.log(
          JSON.stringify(
            {
              action: 'checkpoint keygen',
              key_id: kp.keyId,
              private_key_file: privPath,
              public_key_file: pubPath,
              note:
                'PRIVATE KEY — do not commit to git; keep out of the repository. ' +
                'Set TII_CHECKPOINT_PRIVATE_KEY_FILE to the private key file path ' +
                '(or paste its PEM contents into TII_CHECKPOINT_PRIVATE_KEY) to enable `tii checkpoint create`.',
            },
            null,
            2
          )
        );
        break;
      }
      throw new Error('usage: tii checkpoint <create|verify|list|keygen>');
    }

    case 'recover': {
      const sub = args[0];
      const report = recovery.inspect(DATA_FILE);
      if (sub === 'inspect' || !sub) {
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      if (sub === 'truncate-tail') {
        if (!report.malformed_tail) throw new Error('no malformed ledger tail detected — nothing to truncate');
        const backupFile = `${DATA_FILE}.damaged-${Date.now()}`;
        fs.copyFileSync(DATA_FILE, backupFile);
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const lines = raw.split('\n');
        const validLines = lines.slice(0, report.malformed_tail.line_number - 1);
        const newContent = validLines.length ? validLines.join('\n') + '\n' : '';
        const removedBytes = Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(newContent, 'utf8');
        fs.writeFileSync(DATA_FILE, newContent);
        console.log(
          JSON.stringify(
            {
              action: 'recover truncate-tail',
              ledger_file: DATA_FILE,
              backup_file: backupFile,
              removed_from_line: report.malformed_tail.line_number,
              removed_bytes: removedBytes,
              valid_prefix_events: report.expected_next_seq,
              note: 'Only the malformed tail was removed. Every byte before it is unchanged — compare against the backup.',
            },
            null,
            2
          )
        );
        break;
      }
      if (sub === 'commit-journal') {
        if (!report.journal) throw new Error('no journal file present — nothing to commit');
        if (report.journal.already_committed) {
          fs.unlinkSync(report.journal.path);
          console.log(JSON.stringify({ action: 'recover commit-journal', result: 'already committed; journal removed', event_id: report.journal.event.event_id }, null, 2));
          break;
        }
        if (!report.journal.parses) {
          throw new Error('the journal file is itself malformed and cannot be safely committed — inspect it manually, then `tii recover discard-journal` if appropriate');
        }
        const ev = report.journal.event;
        const ledger = new Ledger(DATA_FILE); // do not .load() (would re-trip the recovery gate) — read the valid prefix directly
        const { events } = recovery.parseLedgerTolerant(fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '');
        if (ev.seq !== events.length) {
          throw new Error(`journaled event seq (${ev.seq}) does not match the expected next seq (${events.length}) — refusing to commit; inspect manually`);
        }
        const currentHead = events.length ? events[events.length - 1].hash : '0'.repeat(70);
        if (ev.prev_hash !== currentHead) {
          throw new Error('journaled event prev_hash does not match the current ledger head — refusing to commit; inspect manually');
        }
        const { hash, ...body } = ev;
        if (sha256(ev.prev_hash + canonicalize(body)) !== hash) {
          throw new Error('journaled event hash does not match its own recomputed content — the journal itself may be corrupted; consider `tii recover discard-journal`');
        }
        fs.appendFileSync(DATA_FILE, JSON.stringify(ev) + '\n');
        fs.unlinkSync(report.journal.path);
        console.log(JSON.stringify({ action: 'recover commit-journal', committed_event_id: ev.event_id }, null, 2));
        break;
      }
      if (sub === 'discard-journal') {
        if (!report.journal) throw new Error('no journal file present — nothing to discard');
        const backupFile = `${report.journal.path}.discarded-${Date.now()}`;
        fs.copyFileSync(report.journal.path, backupFile);
        fs.unlinkSync(report.journal.path);
        console.log(
          JSON.stringify(
            { action: 'recover discard-journal', discarded_backup: backupFile, event_id: report.journal.event ? report.journal.event.event_id : null, note: 'The journaled event was NOT applied to the ledger.' },
            null,
            2
          )
        );
        break;
      }
      throw new Error('usage: tii recover <inspect|truncate-tail|commit-journal|discard-journal>');
    }

    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
