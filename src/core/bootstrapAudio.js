// src/core/bootstrapAudio.js
// 音声ディレクトリのデフォルトだけを提供する最小スタブ。
// 起動時ダウンロード等は行わない（ローカルの audio/jp を使う）。
const path = require('path');

const defaultDir = path.join(__dirname, '..', '..', 'audio', 'jp');

// 互換のためのダミー（index.js が await ensureAudioDir() を呼んでも動く）
async function ensureAudioDir() {
  return defaultDir;
}

module.exports = { defaultDir, ensureAudioDir };
