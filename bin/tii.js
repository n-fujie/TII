#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { Ledger } = require('../src/ledger');
const { project } = require('../src/projection');
const { sha256File } = require('../src/hash');
const exporters = require('../src/export');

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
  tii verify                            # hash-chain integrity
  tii hash-file <path>                  # SHA-256 of a file
  tii export <json|jsonl|csv>           # to stdout
  tii rebuild-static [outDir]           # reconstruct static site from ledger.jsonl
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
      const ledger = load();
      const v = ledger.verify();
      console.log(JSON.stringify(v, null, 2));
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
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
