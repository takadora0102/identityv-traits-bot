// src/core/traits.js
/**
 * 特質定義
 * - key: カスタムIDなどで使う識別子
 * - name: 日本語名（UI表示用）
 * - token: 音声トークン名（audio/jp/*.ogg のファイル名ベース）
 * - init: 開始時CT（秒）
 * - next: 2回目以降CT（秒） ※listen は next=80（最大CT扱い）
 * - flags:
 *    - stacking: 監視者のようなスタック性チャージ
 *    - listen: リッスン（最大CT80s）
 */

const TRAITS = {
  // 開始時READYに含める4種
  kofun:       { key: 'kofun',       name: '興奮',     token: 'kofun',       init: 40, next: 100 },
  shunkan:     { key: 'shunkan',     name: '瞬間移動', token: 'shunkan',     init: 45, next: 100 },
  ikei:        { key: 'ikei',        name: '移形',     token: 'ikei',        init: 50, next: 100 },
  shinshutsu:  { key: 'shinshutsu',  name: '神出鬼没', token: 'shinshutsu',  init: 60, next: 150 },

  // その他
  ijou:        { key: 'ijou',        name: '異常',     token: 'ijou',        init: 40, next: 90  },
  junshisha:   { key: 'junshisha',   name: '巡視者',   token: 'junshisha',   init: 30, next: 90  },

  // 監視者（スタック）
  kanshisha:   { key: 'kanshisha',   name: '監視者',   token: 'kanshisha',   init: 10, next: 30, flags: { stacking: true, maxStacks: 3 } },

  // リッスン（最大CT80s）
  listen:      { key: 'listen',      name: 'リッスン', token: 'listen',      init: 20, next: 80, flags: { listen: true } },

  // 裏向きカード（READY通知のみでCTではない）
  uramuki:     { key: 'uramuki',     name: '裏向きカード', token: 'uramuki' },
};

const PRIMARY_READY_KEYS = ['kofun', 'shunkan', 'ikei', 'shinshutsu'];

/** 裏向きカードで選べる候補（自分自身と uramuki を除外） */
const URAMUKI_CHOICES = ['kofun', 'shunkan', 'ikei', 'shinshutsu', 'ijou', 'junshisha', 'kanshisha', 'listen'];

module.exports = { TRAITS, PRIMARY_READY_KEYS, URAMUKI_CHOICES };
