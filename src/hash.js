'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

/** SHA-256 hex digest of a string (or JSON of a non-string). */
function sha256(input) {
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** SHA-256 hex digest of a file's bytes. */
function sha256File(path) {
  const buf = fs.readFileSync(path);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const GENESIS_HASH = '0'.repeat(64);

module.exports = { sha256, sha256File, GENESIS_HASH };
