'use strict';

/**
 * English-first UI strings. `en` is the default and complete public interface;
 * `ja` is a separate localized rendering (not interleaved bilingual text).
 */

const STRINGS = {
  en: {
    lang_name: 'English',
    lang_switch_to: '日本語',
    wordmark_sub: 'Transition-Ignition Identifier',
    spec_status: 'Experimental Specification',
    nav_registry: 'Registry',
    nav_spec: 'Specification',
    nav_audit: 'Audit',
    nav_about: 'About',

    home_desc:
      'A reference infrastructure for tracing when distinctions, relations, functions, and classifications become operative, and how their recorded conditions change.',
    home_search_label: 'Resolve an identifier',
    home_placeholder: 'tii:xxxxxxxxxxxx',
    home_resolve: 'Resolve',
    home_do_resolve: 'Resolve a TII and inspect its recorded history.',
    home_do_registry: 'Browse the Registry of recorded identifiers.',
    home_do_spec: 'Read the Specification.',
    home_do_audit: 'Check ledger integrity on the Audit page.',
    home_core_note:
      'The TII core is deliberately minimal. State, transition, ignition, address, domain, boundary, relation, and lineage are optional, revisable descriptive structures — not assumed to exist for every identifier.',
    self_service_heading: 'Get a test identifier',
    self_service_intro:
      'Issue your own test TII now — free, instant, always identifier_status: "test". Rate-limited to prevent abuse.',
    self_service_note_placeholder: 'Optional note (up to 280 characters)',
    self_service_button: 'Issue a test TII',
    self_service_button_busy: 'Issuing…',
    self_service_result_prefix: 'Issued: ',
    self_service_error_generic: 'Could not issue an identifier. Please try again later.',
    self_service_error_rate_limited: 'Rate limit reached. Please try again later.',

    registry_title: 'Registry',
    registry_intro:
      'Publicly recorded identifiers. Identifiers issued under the current experimental specification are marked as test identifiers.',
    registry_search: 'Search identifiers, status, or external references',
    col_tii: 'TII',
    col_status: 'Record status',
    col_last_event: 'Last recorded event',
    col_external: 'External identifiers',
    col_recorded_at: 'Recorded at',
    registry_empty: 'No identifiers recorded.',
    test_identifier: 'TEST IDENTIFIER',

    status_active: 'Active',
    status_suspended: 'Suspended',
    status_retracted: 'Withdrawn',
    status_nonpublic: 'Non-public',

    res_not_found_title: 'Identifier not found',
    res_not_found_body:
      'No record exists for this identifier in this deployment. It may not have been issued, or it may be recorded elsewhere.',
    res_overview: 'Overview',
    res_current_interpretation: 'Current interpretation',
    res_no_interpretation: 'No interpretation has been recorded.',
    res_last_event: 'Last recorded event',
    res_external_ids: 'External identifiers',
    res_addresses: 'Resolvable addresses',
    res_addresses_note: 'No address is designated as permanently or exclusively authoritative.',
    res_resolvable_at: 'Resolvable at',
    res_none: 'None recorded.',
    res_no_current_state:
      'No record is currently interpreted as valid. A fixed “current state” is not assumed to always exist.',
    sec_record: 'Record',
    sec_events: 'Events',
    sec_transitions: 'Transitions',
    sec_ignitions: 'Ignitions',
    sec_address_domain: 'Address / Domain',
    sec_relations: 'Relations',
    sec_evidence: 'Evidence',
    sec_external: 'External Identifiers',
    sec_audit: 'Audit',
    res_events_intro: 'Append-only. Earlier records are never rewritten or deleted.',
    col_seq: '#',
    col_time: 'Recorded',
    col_type: 'Event',
    col_recorder: 'Recorder',
    col_supersedes: 'Supersedes',
    col_hash: 'Hash',
    col_detail: 'Detail',
    res_disputed: 'Contested',
    res_withdrawn: 'Withdrawn / stopped',
    res_structured: 'Structured data (JSON)',

    audit_title: 'Audit',
    audit_intro:
      'The record of authority is an append-only JSON Lines ledger. Each event is chained to the previous one with a SHA-256 hash, so rewriting, deleting, or reordering records is detectable.',
    audit_integrity: 'Ledger integrity',
    audit_ok: 'Intact — the hash chain recomputes correctly.',
    audit_bad: 'Problem detected in the hash chain.',
    audit_last_verified: 'Last verified',
    audit_recorded_events: 'Recorded events',
    audit_head_hash: 'Head hash',
    audit_method: 'Verification method',
    audit_method_body:
      'For each event, hash = SHA-256( previous hash + canonical JSON of the event without its hash field ). Verification recomputes the whole chain from the genesis hash. No blockchain is involved.',
    audit_exports: 'Exports',
    audit_export_jsonl: 'Full ledger (JSON Lines) — canonical form',
    audit_export_json: 'Full ledger (JSON)',
    audit_export_csv: 'Full ledger (CSV, one row per event)',

    audit_two_claims_note:
      'These are two separate claims. Ledger chain integrity means the ledger is internally consistent with its own hashes — it does NOT by itself prove the history was never fully rewritten. A signed checkpoint means a specific ledger head was attested to, at a specific time, by a specific key — held independently of this ledger file.',
    audit_checkpoint_title: 'Signed checkpoint',
    audit_checkpoint_intro:
      'An Ed25519 signature over the ledger head, canonicalized with RFC 8785 (JCS), published as an ordinary file independent of this server. A checkpoint that predates the current head is normal — new events since a checkpoint are not a forgery signal by themselves.',
    checkpoint_status_VERIFIED: 'Verified',
    checkpoint_status_UNVERIFIED: 'Unverified (no key available to check it)',
    checkpoint_status_MISSING: 'Not available',
    checkpoint_status_INVALID: 'Invalid',
    audit_checkpoint_head: 'Checkpoint head',
    audit_checkpoint_created: 'Checkpoint created',
    audit_checkpoint_key: 'Signing key',
    audit_checkpoint_matches: 'Matches current ledger head',
    audit_checkpoint_reason: 'Reason',

    about_title: 'About TII',

    foot_spec: 'Specification',
    foot_registry: 'Registry',
    foot_audit: 'Audit',
    foot_source: 'Source Repository',
    foot_maintainer: 'P/A Institute',
    foot_maintained: 'Developed and maintained by P/A Institute.',
    foot_spec_version: 'TII Specification',
    foot_independence:
      'TII identifiers are independent of any hosting provider or current operator.',

    disclaimer:
      'TII does not by itself guarantee essential identity, ownership, authenticity, scholarly validity, truth, permanence, or persistence of hosting. Transition and ignition are revisable operational descriptions, not universal ontological primitives.',
  },

  ja: {
    lang_name: '日本語',
    lang_switch_to: 'English',
    wordmark_sub: 'Transition-Ignition Identifier（遷移発火識別子）',
    spec_status: '実験的仕様',
    nav_registry: 'レジストリ',
    nav_spec: '仕様',
    nav_audit: '監査',
    nav_about: '概要',

    home_desc:
      '区別・関係・機能・分類が、どの条件下で作動上有効になったか、そして記録された条件がどのように変化したかを追跡するための参照インフラ。',
    home_search_label: '識別子を解決する',
    home_placeholder: 'tii:xxxxxxxxxxxx',
    home_resolve: '解決',
    home_do_resolve: 'TIIを解決し、記録された履歴を閲覧する。',
    home_do_registry: '記録済み識別子のレジストリを参照する。',
    home_do_spec: '仕様を読む。',
    home_do_audit: '監査ページで台帳の整合性を確認する。',
    home_core_note:
      'TIIコアは意図的に最小限です。状態・遷移・発火・アドレス・ドメイン・境界・関係・系譜は任意かつ改訂可能な記述構造であり、すべての識別子に存在すると仮定しません。',
    self_service_heading: '試験用識別子を取得',
    self_service_intro:
      '無料・即時で自分の試験用TIIを発行できます（常に identifier_status: "test"）。濫用防止のためレート制限があります。',
    self_service_note_placeholder: '任意のメモ（最大280文字）',
    self_service_button: '試験用TIIを発行',
    self_service_button_busy: '発行中…',
    self_service_result_prefix: '発行されました: ',
    self_service_error_generic: '発行できませんでした。しばらくしてから再試行してください。',
    self_service_error_rate_limited: 'レート制限に達しました。しばらくしてから再試行してください。',

    registry_title: 'レジストリ',
    registry_intro:
      '公開記録された識別子。現行の実験的仕様の下で発行された識別子は試験用識別子として表示されます。',
    registry_search: '識別子・状態・外部参照で検索',
    col_tii: 'TII',
    col_status: '記録状態',
    col_last_event: '最終記録イベント',
    col_external: '外部識別子',
    col_recorded_at: '記録日時',
    registry_empty: '記録された識別子はありません。',
    test_identifier: '試験用識別子',

    status_active: '有効',
    status_suspended: '停止',
    status_retracted: '撤回',
    status_nonpublic: '非公開',

    res_not_found_title: '識別子が見つかりません',
    res_not_found_body:
      'この配備にはこの識別子の記録がありません。未発行であるか、別の場所に記録されている可能性があります。',
    res_overview: '概要',
    res_current_interpretation: '現在の解釈',
    res_no_interpretation: '解釈は記録されていません。',
    res_last_event: '最終記録イベント',
    res_external_ids: '外部識別子',
    res_addresses: '解決可能なアドレス',
    res_addresses_note: 'いずれのアドレスも恒久的・排他的な正本として指定されていません。',
    res_resolvable_at: '解決先',
    res_none: '記録なし。',
    res_no_current_state:
      '現在有効と解釈される記録はありません。固定された「現在状態」が常に存在するとは仮定しません。',
    sec_record: '記録',
    sec_events: 'イベント',
    sec_transitions: '遷移',
    sec_ignitions: '発火',
    sec_address_domain: 'アドレス／ドメイン',
    sec_relations: '関係',
    sec_evidence: '証拠',
    sec_external: '外部識別子',
    sec_audit: '監査',
    res_events_intro: '追記型。過去の記録は書き換え・削除されません。',
    col_seq: '#',
    col_time: '記録',
    col_type: 'イベント',
    col_recorder: '記録主体',
    col_supersedes: '訂正対象',
    col_hash: 'ハッシュ',
    col_detail: '詳細',
    res_disputed: '異議あり',
    res_withdrawn: '撤回／停止',
    res_structured: '構造化データ (JSON)',

    audit_title: '監査',
    audit_intro:
      '正本は追記型のJSON Lines台帳です。各イベントはSHA-256ハッシュで直前のイベントに連結されており、記録の書き換え・削除・並べ替えを検出できます。',
    audit_integrity: '台帳の整合性',
    audit_ok: '整合 — ハッシュ連鎖は正しく再計算されます。',
    audit_bad: 'ハッシュ連鎖に問題が検出されました。',
    audit_last_verified: '最終検証',
    audit_recorded_events: '記録イベント数',
    audit_head_hash: 'ヘッドハッシュ',
    audit_method: '検証方法',
    audit_method_body:
      '各イベントについて hash = SHA-256( 直前のハッシュ + hash項目を除いたイベントの正規化JSON )。検証はジェネシスハッシュから連鎖全体を再計算します。ブロックチェーンは用いません。',
    audit_exports: '書き出し',
    audit_export_jsonl: '台帳全体 (JSON Lines) — 正本形式',
    audit_export_json: '台帳全体 (JSON)',
    audit_export_csv: '台帳全体 (CSV, 1イベント1行)',

    audit_two_claims_note:
      'これらは別個の主張です。台帳の整合性は、台帳が自身のハッシュと内部的に矛盾しないことを意味します — それ自体は、履歴が丸ごと書き換えられていないことを証明しません。署名付きチェックポイントは、特定の台帳ヘッドが、特定の時刻に、特定の鍵によって証言されたことを意味します — 本台帳ファイルとは独立に保持されます。',
    audit_checkpoint_title: '署名付きチェックポイント',
    audit_checkpoint_intro:
      '台帳ヘッドに対する Ed25519 署名で、RFC 8785（JCS）で正規化され、本サーバーとは独立した通常のファイルとして公開されます。チェックポイントが現在のヘッドより古いのは正常です — チェックポイント以降の新規イベントはそれ自体では偽造の兆候ではありません。',
    checkpoint_status_VERIFIED: '検証済み',
    checkpoint_status_UNVERIFIED: '未検証（検査可能な鍵がありません）',
    checkpoint_status_MISSING: '利用不可',
    checkpoint_status_INVALID: '無効',
    audit_checkpoint_head: 'チェックポイントヘッド',
    audit_checkpoint_created: 'チェックポイント作成日時',
    audit_checkpoint_key: '署名鍵',
    audit_checkpoint_matches: '現在の台帳ヘッドと一致',
    audit_checkpoint_reason: '理由',

    about_title: 'TIIについて',

    foot_spec: '仕様',
    foot_registry: 'レジストリ',
    foot_audit: '監査',
    foot_source: 'ソースリポジトリ',
    foot_maintainer: 'P/A Institute',
    foot_maintained: 'P/A Institute により開発・維持されています。',
    foot_spec_version: 'TII 仕様',
    foot_independence: 'TII識別子は、いかなるホスティング事業者・現運営主体からも独立しています。',

    disclaimer:
      'TIIは、それ単独では、本質的同一性・所有・真正性・学術的正当性・真理・恒久性・ホスティングの永続性を保証しません。遷移と発火は改訂可能な作動記述であり、普遍的存在論的原理ではありません。',
  },
};

function t(lang, key) {
  const table = STRINGS[lang] || STRINGS.en;
  return table[key] !== undefined ? table[key] : STRINGS.en[key] !== undefined ? STRINGS.en[key] : key;
}

function normalizeLang(input) {
  return input === 'ja' ? 'ja' : 'en';
}

/** Humanize an event_type like "ignition.described" -> "Ignition described". */
function humanizeEventType(type, lang) {
  if (lang === 'ja') {
    const JA = {
      'tii.issued': 'TII発行',
      'interpretation.revised': '解釈の改訂',
      'localization.added': 'ローカライズの追加',
      'address.described': 'アドレス記述',
      'domain.described': 'ドメイン記述',
      'external.ref.added': '外部参照の追加',
      'external.ref.updated': '外部参照の更新',
      'ignition.described': '発火の記述',
      'ignition.suspended': '発火の停止',
      'ignition.reignited': '発火の再開',
      'ignition.withdrawn': '発火分類の撤回',
      'transition.described': '遷移の記述',
      'transition.withdrawn': '遷移分類の撤回',
      'relation.asserted': '関係の記述',
      'relation.ended': '関係の終了',
      'series.judged': '系列判定',
      'record.added': '記録の追加',
      'record.corrected': '記録の訂正',
      'note.added': '注記の追加',
      'authority.transferred': '権限の移管',
      'tii.suspended': 'TIIの停止',
      'tii.retracted': 'TIIの撤回',
      'content.hash.recorded': '内容ハッシュの記録',
      'boundary.changed': '境界の変更',
    };
    if (JA[type]) return JA[type];
  }
  const s = String(type || '').replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function recordStatusLabel(lifecycleState, lang) {
  const map = {
    active: 'status_active',
    'tii.suspended': 'status_suspended',
    'tii.retracted': 'status_retracted',
    'tii.made-nonpublic': 'status_nonpublic',
  };
  return t(lang, map[lifecycleState] || 'status_active');
}

/** YYYY-MM-DD from an ISO timestamp (date precision is enough for public views). */
function formatDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

module.exports = {
  STRINGS,
  t,
  normalizeLang,
  humanizeEventType,
  recordStatusLabel,
  formatDate,
};
