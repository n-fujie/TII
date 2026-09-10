'use strict';

const crypto = require('node:crypto');

/**
 * PROVISIONAL identifier syntax (see SPEC.md §3 — every value here is "未確定").
 * Opaque, semantics-free. No org / person / owner / year / place / country /
 * category / paper-type / version / address / domain / theory / ignition-state /
 * transition-state may be embedded.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // 31 chars: Crockford-ish, no i l o u
const TII_BODY_LENGTH = 12;
const EVENT_BODY_LENGTH = 16;
const TII_PREFIX = 'tii:';
const EVENT_PREFIX = 'evt_';
const MAX_COLLISION_RETRIES = 1000;

// Rejection sampling threshold to remove modulo bias (31 * 8 = 248).
const REJECT_AT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

function randomBody(length) {
  const out = [];
  while (out.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < REJECT_AT) out.push(ALPHABET[byte % ALPHABET.length]);
  }
  return out.join('');
}

/**
 * @param {(candidate: string) => boolean} [exists] collision predicate
 * @returns {string} e.g. "tii:7k3m9q2xh4rt"
 */
function newTII(exists) {
  for (let i = 0; i < MAX_COLLISION_RETRIES; i++) {
    const candidate = TII_PREFIX + randomBody(TII_BODY_LENGTH);
    if (!exists || !exists(candidate)) return candidate;
  }
  throw new Error('TII generation failed: collision retries exhausted');
}

function newEventId(exists) {
  for (let i = 0; i < MAX_COLLISION_RETRIES; i++) {
    const candidate = EVENT_PREFIX + randomBody(EVENT_BODY_LENGTH);
    if (!exists || !exists(candidate)) return candidate;
  }
  throw new Error('event id generation failed: collision retries exhausted');
}

const TII_PATTERN = new RegExp(
  `^${TII_PREFIX}[${ALPHABET}]{${TII_BODY_LENGTH}}$`
);

function isWellFormedTII(s) {
  return typeof s === 'string' && TII_PATTERN.test(s);
}

/** Filesystem-safe form for static export (POSIX allows ':', but be portable). */
function tiiToFileSlug(tii) {
  return tii.replace(/[^a-z0-9]+/gi, '_');
}

module.exports = {
  ALPHABET,
  TII_PREFIX,
  TII_BODY_LENGTH,
  EVENT_BODY_LENGTH,
  newTII,
  newEventId,
  isWellFormedTII,
  tiiToFileSlug,
};
