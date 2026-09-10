'use strict';

/**
 * DISPLAY-ONLY vocabulary. None of this is part of the data model or an
 * ontological commitment (要件5, 8, 23). The engine never validates against
 * these lists — unknown event types / modules / acts are stored and shown as-is.
 * This file exists to help the admin UI and to group records for reading.
 */

// Known event types — informational registry, NOT a closed enum.
const KNOWN_EVENT_TYPES = [
  'tii.issued',
  'record.added',
  'record.corrected',
  'interpretation.revised',
  'evidence.referenced',
  'content.hash.recorded',
  'external.ref.added',
  'external.ref.updated',
  'address.described',
  'domain.described',
  'boundary.changed',
  'scale.described',
  'timespan.described',
  'relation.asserted',
  'relation.ended',
  'relation.withdrawn',
  'state.described',
  'state.disputed',
  'state.withdrawn',
  'state.redescribed',
  'transition.described',
  'transition.reclassified',
  'transition.withdrawn',
  'ignition.described',
  'ignition.suspended',
  'ignition.reignited',
  'ignition.disputed',
  'ignition.withdrawn',
  'series.judged',
  'series.judgement.withdrawn',
  'branch.recorded',
  'merge.recorded',
  'dispute.raised',
  'dispute.withdrawn',
  'correction.recorded',
  'tii.suspended',
  'tii.retracted',
  'tii.reinstated',
  'tii.made-nonpublic',
  'recorder.delegated',
  'recorder.revoked',
  'authority.transferred',
  'note.added',
];

// Default act vocabulary (要件1). Open set.
const KNOWN_ACTS = [
  'introduce',
  'apply',
  'hold', // 保留
  'stop', // 停止
  'replace', // 置換
  'redefine', // 再定義
  'dispute', // 異議
  'withdraw', // 撤回
];

const KNOWN_MODULES = [
  'state',
  'transition',
  'ignition',
  'address',
  'domain',
  'boundary',
  'scale',
  'timespan',
  'relation',
  'series',
  'external_identifier',
  'interpretation',
];

const MODULE_LABELS_JA = {
  state: '状態',
  transition: '遷移',
  ignition: '発火',
  address: 'アドレス',
  domain: 'ドメイン',
  boundary: '境界',
  scale: '尺度',
  timespan: '時間区間',
  relation: '関係',
  series: '系列判定',
  external_identifier: '外部識別子',
  interpretation: '解釈',
};

// Candidate values — all open sets, shown as suggestions only.
const TRANSITION_RELATION_KINDS = [
  'precedes', 'derives', 'branches', 'merges', 'replaces', 'stops',
  'resumes', 'withdrawn', 'reconnects', 'cyclic', 'unknown', 'disputed',
];

const RELATION_TYPES = [
  'administers', 'stores', 'accesses', 'modifies', 'copies', 'distributes',
  'maintains', 'stops', 'deletes', 'transfers', 'signs', 'holds-copyright',
  'funds', 'publishes', 'verifies',
];

const SERIES_JUDGEMENTS = [
  'same-series', 'different-series', 'unknown', 'dispute',
  'split', 'merge', 'withdraw-judgement',
];

const ADDRESS_KINDS = [
  'public-location', 'storage-location', 'network-location',
  'retrieval-path', 'physical-location', 'logical-location',
];

const EXTERNAL_ID_SCHEMES = ['doi', 'ark', 'isbn', 'orcid', 'url', 'ipfs-cid', 'handle', 'urn'];

/**
 * Ignition display labels (要件8). These are NOT the ontological state set —
 * they are a reading of whatever ignition records happen to exist.
 */
function ignitionDisplayLabels(records) {
  if (!records || records.length === 0) return ['未評価'];
  const labels = new Set();
  for (const r of records) {
    const act = r.act;
    const type = r.event_type || '';
    if (type.endsWith('.suspended') || act === 'stop' || act === 'hold') labels.add('停止記録あり');
    else if (type.endsWith('.disputed') || act === 'dispute') labels.add('異議あり');
    else if (type.endsWith('.withdrawn') || act === 'withdraw') labels.add('撤回記録あり');
    else if (r.content && r.content.negative === true) labels.add('非発火記録あり');
    else labels.add('発火記録あり');
  }
  return [...labels];
}

function isKnownEventType(t) {
  return KNOWN_EVENT_TYPES.includes(t);
}

module.exports = {
  KNOWN_EVENT_TYPES,
  KNOWN_ACTS,
  KNOWN_MODULES,
  MODULE_LABELS_JA,
  TRANSITION_RELATION_KINDS,
  RELATION_TYPES,
  SERIES_JUDGEMENTS,
  ADDRESS_KINDS,
  EXTERNAL_ID_SCHEMES,
  ignitionDisplayLabels,
  isKnownEventType,
};
