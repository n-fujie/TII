'use strict';

/**
 * spec/production-launch-gate.md — the multi-condition production-issuance
 * gate (src/production-gate.js) and the gated issuance path
 * (src/production-issuance.js). Every test here runs against a disposable
 * ledger AND a disposable checkpoint directory under os.tmpdir(); nothing
 * here ever touches data/ledger.jsonl or the repository's checkpoints/
 * directory. This task must not issue a production TII outside the one
 * explicitly-marked test below that demonstrates the capability exists.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const gate = require('../src/production-gate');
const identifierProd = require('../src/identifier');
const checkpointStore = require('../src/checkpoint-store');
const { issueProductionTII, ProductionGateClosedError } = require('../src/production-issuance');
const { generateKeypair } = require('../src/checkpoint');

function mkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tii-prodgate-'));
}
function freshLedger() {
  const dir = mkdir();
  const file = path.join(dir, 'ledger.jsonl');
  return { dir, file, ledger: new Ledger(file).load() };
}
function keyEnv(kp) {
  const dir = mkdir();
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  return { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile };
}

/**
 * Build an env + checkpointDir with every condition satisfied for the
 * CURRENT state of `ledger`, except whatever is listed in `omit`. Always
 * creates a real pre-issuance checkpoint (against a disposable directory,
 * never the repo's own checkpoints/) so checkpoint_current is true unless
 * "checkpoint_current" itself is in `omit`.
 */
function allSatisfiedFor(ledger, omit = []) {
  const kp = generateKeypair();
  const checkpointDir = path.join(mkdir(), 'checkpoints');
  const env = {
    TII_PRODUCTION_ISSUANCE_ENABLED: 'true',
    TII_GOVERNANCE_APPROVED: 'true',
    TII_RESOLVER_APPROVED: 'true',
    TII_IANA_GATE_SATISFIED: 'true',
    ...keyEnv(kp),
  };
  for (const k of omit) delete env[k];
  if (!omit.includes('checkpoint_current') && env.TII_CHECKPOINT_PRIVATE_KEY_FILE) {
    checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });
  }
  return { env, checkpointDir };
}

/* ------------------------------------------------------- §7 fail-closed --- */

test('§7 flag absent -> production disabled', () => {
  const { file } = freshLedger();
  const status = gate.computeGateStatus({ ledgerFile: file, env: {} });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('production_requested'));
});

test('§7 flag empty string -> production disabled', () => {
  const { file } = freshLedger();
  const status = gate.computeGateStatus({ ledgerFile: file, env: { TII_PRODUCTION_ISSUANCE_ENABLED: '' } });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('production_requested'));
});

test('§7 flag "false" -> production disabled', () => {
  const { file } = freshLedger();
  const status = gate.computeGateStatus({ ledgerFile: file, env: { TII_PRODUCTION_ISSUANCE_ENABLED: 'false' } });
  assert.equal(status.available, false);
});

test('§7 flag malformed ("1", "TRUE", "yes", whitespace) -> production disabled', () => {
  const { file } = freshLedger();
  for (const v of ['1', 'TRUE', 'True', 'yes', ' true', 'true ', 'truee']) {
    const status = gate.computeGateStatus({ ledgerFile: file, env: { TII_PRODUCTION_ISSUANCE_ENABLED: v } });
    assert.equal(status.available, false, `"${v}" must not enable production`);
    assert.ok(status.blocked_by.includes('production_requested'));
  }
});

test('§7 flag true but governance unresolved -> production disabled', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, ['TII_GOVERNANCE_APPROVED']);
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['governance_approved']);
});

test('§7 flag true but resolver unresolved -> production disabled', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, ['TII_RESOLVER_APPROVED']);
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['resolver_approved']);
});

test('§7 flag true but IANA gate unresolved -> production disabled', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, ['TII_IANA_GATE_SATISFIED']);
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['iana_gate_satisfied']);
});

test('§7 flag true but signing key unavailable -> production disabled', () => {
  const { file } = freshLedger();
  const env = {
    TII_PRODUCTION_ISSUANCE_ENABLED: 'true',
    TII_GOVERNANCE_APPROVED: 'true',
    TII_RESOLVER_APPROVED: 'true',
    TII_IANA_GATE_SATISFIED: 'true',
    // no signing key configured at all
  };
  const status = gate.computeGateStatus({ ledgerFile: file, env });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('signing_ready'));
  assert.ok(status.blocked_by.includes('checkpoint_current'), 'with no key, no checkpoint can exist either');
});

test('§7 flag true but writer/recovery state unhealthy (malformed ledger tail) -> production disabled', () => {
  const { file, ledger } = freshLedger();
  ledger.issueTII({ recorder: { id: 't', kind: 'person' } });
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  fs.appendFileSync(file, '{"broken json, no closing');
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('recovery_clear'));
  assert.ok(status.blocked_by.includes('writer_healthy'));
});

test('§7 flag true but a STALE writer lock is present -> production disabled', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  fs.writeFileSync(file + '.lock', JSON.stringify({ pid: 999999, host: 'nowhere', acquired_at: '2000-01-01T00:00:00Z' }));
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('writer_healthy'));
  fs.unlinkSync(file + '.lock');
});

test('§16/§17 flag true and everything else satisfied, but no checkpoint has ever been made yet -> production disabled (checkpoint_current)', () => {
  const { file, ledger } = freshLedger();
  const { env } = allSatisfiedFor(ledger, ['checkpoint_current']); // key is configured, but no checkpoint was created
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir: path.join(mkdir(), 'checkpoints'), env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['checkpoint_current']);
});

test('§16/§17 a checkpoint that predates the CURRENT head (a mutation happened since) -> production disabled until re-checkpointed', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []); // checkpoint made against the empty ledger
  ledger.issueTII({ recorder: { id: 't', kind: 'person' } }); // ledger moves on; checkpoint is now stale
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['checkpoint_current']);

  // operator recovery: re-checkpoint restores currency
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });
  const status2 = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status2.available, true);
});

test('§7/§8 ALL conditions true -> gate reports AVAILABLE (computation only — no issuance attempted here)', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const status = gate.computeGateStatus({ ledgerFile: file, checkpointDir, env });
  assert.equal(status.available, true, JSON.stringify(status.blocked_by));
  assert.deepEqual(status.blocked_by, []);
});

/* --------------------------------------------- §8 no single var suffices --- */

test('§8 TII_PRODUCTION_ISSUANCE_ENABLED=true ALONE (nothing else set) is never sufficient', () => {
  const { file } = freshLedger();
  const status = gate.computeGateStatus({ ledgerFile: file, env: { TII_PRODUCTION_ISSUANCE_ENABLED: 'true' } });
  assert.equal(status.available, false);
  for (const k of ['governance_approved', 'resolver_approved', 'iana_gate_satisfied', 'signing_ready', 'checkpoint_current']) {
    assert.ok(status.blocked_by.includes(k), `${k} should still block with no other condition set`);
  }
});

test('§8 production mode is never inferred from NODE_ENV, hostname, or Vercel-style env vars', () => {
  const { file } = freshLedger();
  const env = {
    NODE_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: 'production',
    HOSTNAME: 'production-server',
    // deliberately NOT setting TII_PRODUCTION_ISSUANCE_ENABLED
  };
  const status = gate.computeGateStatus({ ledgerFile: file, env });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('production_requested'));
});

test('§8 presence of a signing key or admin token alone does not authorize production', () => {
  const { file } = freshLedger();
  const kp = generateKeypair();
  const env = { ...keyEnv(kp), TII_ADMIN_TOKEN: 'some-token' }; // no TII_PRODUCTION_ISSUANCE_ENABLED, no governance/resolver/iana
  const status = gate.computeGateStatus({ ledgerFile: file, env });
  assert.equal(status.available, false);
  assert.ok(status.blocked_by.includes('production_requested'));
  assert.ok(status.blocked_by.includes('governance_approved'));
});

/* ------------------------------------------------- issueProductionTII() --- */

test('issueProductionTII() throws ProductionGateClosedError when the gate is closed (the committed-configuration case)', () => {
  const { ledger } = freshLedger();
  assert.throws(
    () => issueProductionTII(ledger, { env: {}, recorder: { id: 't', kind: 'person' } }),
    (e) => e instanceof ProductionGateClosedError && e.code === 'production-gate-closed'
  );
  assert.equal(ledger.events.length, 0);
});

test('issueProductionTII() dry-run never appends, even when the gate IS open', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const result = issueProductionTII(ledger, { env, checkpointDir, dryRun: true, recorder: { id: 't', kind: 'person' } });
  assert.equal(result.dry_run, true);
  assert.match(result.candidate_identifier, /^tii:[a-z2-7]{26}$/);
  assert.equal(result.gate_status.available, true);
  assert.equal(ledger.events.length, 0, 'dry-run must never append to canonical history');
  const reloaded = new Ledger(file).load();
  assert.equal(reloaded.events.length, 0);
});

test('dry-run candidate identifiers are 26-char production-profile tokens, never the 12-char test format', () => {
  const { ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const result = issueProductionTII(ledger, { env, checkpointDir, dryRun: true, recorder: { id: 't', kind: 'person' } });
  assert.equal(identifierProd.isWellFormed(result.candidate_identifier), true);
  assert.doesNotMatch(result.candidate_identifier, /^tii:[0-9a-z]{12}$/, 'must not resemble a TEST identifier');
});

test('a REAL (non-dry-run) production issuance succeeds ONLY when the gate is open, mints identifier_status "production", checkpoints itself, and never reuses/promotes a test identifier', () => {
  const { file, ledger } = freshLedger();
  const { tii: testTii } = ledger.issueTII({ recorder: { id: 't', kind: 'person' } }); // a normal TEST identifier exists first
  assert.equal(identifierProd.isWellFormed(testTii), false, 'sanity: the test identifier is NOT well-formed under the production profile (12 chars, different alphabet)');

  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const result = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 'launch-operator', kind: 'person' } });

  assert.match(result.tii, /^tii:[a-z2-7]{26}$/, 'production identifier follows the frozen 26-char profile');
  assert.notEqual(result.tii, testTii, 'a NEW identifier was minted, the existing test identifier was not reused or promoted');
  assert.equal(result.event.content.identifier_status, 'production');
  assert.equal(ledger.forTII(testTii)[0].content.identifier_status, 'test', 'the pre-existing test identifier is untouched and still status "test"');
  assert.equal(ledger.verify().ok, true);
  assert.equal(result.production_checkpoint.status, 'CREATED', 'checkpoint-after-every-production-mutation policy: a checkpoint is created as part of this call');

  const postCheck = checkpointStore.verifyCheckpoint(ledger, { dir: checkpointDir, env });
  assert.equal(postCheck.status, 'VERIFIED');
  assert.equal(postCheck.matches_current_head, true, 'the new checkpoint covers the just-appended production event');

  // this test itself is the ONLY place in this entire suite where the gate is
  // open AND a real (non-dry-run) production issuance is executed -- and it
  // runs against a fully disposable, throwaway ledger under os.tmpdir(),
  // never against data/ledger.jsonl. See spec/production-launch-gate.md §0.
});

test('§17 if checkpoint creation fails after a committed production mutation, the mutation is NOT hidden or rolled back, and further production mutations are blocked', () => {
  const { ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);

  // sabotage ONLY the checkpoint-creation step (not the gate's up-front
  // signing_ready check) by monkey-patching createCheckpoint for exactly one
  // call -- this models a transient signing failure (e.g. a hardware key
  // momentarily unavailable) that happens strictly AFTER the append has
  // already durably committed, which the up-front gate check cannot see
  // coming (nothing can, for a genuinely transient failure).
  const originalCreate = checkpointStore.createCheckpoint;
  checkpointStore.createCheckpoint = () => {
    throw new Error('simulated transient signing failure');
  };
  let result;
  try {
    result = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
  } finally {
    checkpointStore.createCheckpoint = originalCreate;
  }

  assert.equal(result.production_checkpoint.status, 'FAILED');
  assert.equal(ledger.forTII(result.tii).length, 1, 'the mutation IS committed to canonical history, not rolled back');
  assert.equal(ledger.getEvent(result.event.event_id).content.identifier_status, 'production', 'not hidden — the event is exactly as recorded');

  // FURTHER production mutations are now blocked (checkpoint_current is false)
  const status = gate.computeGateStatus({ ledgerFile: ledger.file, checkpointDir, env });
  assert.equal(status.available, false);
  assert.deepEqual(status.blocked_by, ['checkpoint_current']);
  assert.throws(() => issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } }), ProductionGateClosedError);

  // operator recovery: fix signing and re-checkpoint restores currency
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });
  const restored = gate.computeGateStatus({ ledgerFile: ledger.file, checkpointDir, env });
  assert.equal(restored.available, true);
});

/* --------------------------------------------------- §10 collision handling --- */

test('§10 collision handling: a candidate discovered to collide (authoritatively, inside the writer lock) is discarded and never enters history; retry succeeds', () => {
  const { ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);

  const fixedA = 'tii:' + 'a'.repeat(25) + 'a';
  const fixedB = 'tii:' + 'e'.repeat(25) + 'e';
  const original = identifierProd.generateIdentifier;
  let calls = 0;
  identifierProd.generateIdentifier = () => {
    calls++;
    return calls === 1 ? fixedA : fixedB;
  };
  try {
    const first = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
    assert.equal(first.tii, fixedA);
    // restore checkpoint currency between calls (the §16/§17 policy requires it, see the test above)
    checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });

    calls = 0;
    identifierProd.generateIdentifier = () => {
      calls++;
      return calls === 1 ? fixedA : fixedB;
    };
    const second = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
    assert.equal(second.tii, fixedB, 'the collided candidate was discarded and a fresh one was minted');
    assert.equal(calls, 2, 'exactly one collision was discovered and exactly one retry occurred');

    const occurrences = ledger.events.filter((e) => e.tii === fixedA).length;
    assert.equal(occurrences, 1);
    assert.equal(ledger.verify().ok, true);
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

test('§10 a collided-and-discarded candidate never becomes a TII even transiently on disk', () => {
  const { file, ledger } = freshLedger();
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const collideWith = 'tii:' + 'm'.repeat(25) + 'm';
  const fresh = 'tii:' + 'q'.repeat(25) + 'q';

  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => collideWith;
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
  } finally {
    identifierProd.generateIdentifier = original;
  }
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });

  let calls = 0;
  identifierProd.generateIdentifier = () => {
    calls++;
    return calls === 1 ? collideWith : fresh;
  };
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
  } finally {
    identifierProd.generateIdentifier = original;
  }

  const rawLedgerText = fs.readFileSync(file, 'utf8');
  const collideCount = (rawLedgerText.match(new RegExp(collideWith, 'g')) || []).length;
  assert.equal(collideCount, 1, 'the collided candidate must appear in the raw canonical ledger exactly once (the original), never a duplicate from the discarded retry attempt');
});

/* -------------------------------------------------- §6 test/production separation --- */

test('§6 identifier_status is never "test" for a production issuance nor "production" for a test issuance', () => {
  const { ledger } = freshLedger();
  const { event: testEvent } = ledger.issueTII({ recorder: { id: 't', kind: 'person' } });
  assert.equal(testEvent.content.identifier_status, 'test');

  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const { event: prodEvent } = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
  assert.equal(prodEvent.content.identifier_status, 'production');
});

test('§6 the identifier token itself never encodes "test" or "production"', () => {
  const { ledger } = freshLedger();
  const { tii: testTii } = ledger.issueTII({ recorder: { id: 't', kind: 'person' } });
  const { env, checkpointDir } = allSatisfiedFor(ledger, []);
  const { tii: prodTii } = issueProductionTII(ledger, { env, checkpointDir, recorder: { id: 't', kind: 'person' } });
  assert.ok(!/test|prod/i.test(testTii.replace(/^tii:/, '')));
  assert.ok(!/test|prod/i.test(prodTii.replace(/^tii:/, '')));
});

/* --------------------------------------------------------- §0 absolute rule --- */

test('§0 ABSOLUTE RULE: the committed repository configuration (real process.env, real data/ledger.jsonl) never satisfies the gate', () => {
  const status = gate.computeGateStatus({
    ledgerFile: path.join(__dirname, '..', 'data', 'ledger.jsonl'),
    env: process.env,
  });
  assert.equal(status.available, false, 'the production gate must be closed under this repository\'s actual, committed environment');
  assert.ok(status.blocked_by.length > 0);
});

test('§0 no test identifier can be "promoted": production issuance always calls the generator fresh, never accepts an existing tii string', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'production-issuance.js'), 'utf8');
  assert.ok(!/opts\.tii\b/.test(src), 'issueProductionTII must never read a caller-supplied tii value to reuse');
});

test('§0 no HTTP route exposes production issuance', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.ok(!/production-issuance/.test(serverSrc), 'src/server.js must not import src/production-issuance.js in this phase');
  assert.ok(!/identifier_status.*production|production.*identifier_status/.test(serverSrc), 'no HTTP route should be able to set identifier_status to "production"');
});
