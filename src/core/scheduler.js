// src/core/scheduler.js
/**
 * 試合の開始・終了と、各種アナウンスのスケジューリングを担当
 * ここでは最小限：開始時CTの「使用可能」アナウンスと、裏向きカード120sのみ。
 * 細かい T-30/T-10/T-5 などの特質CTアナウンスは、必要ならここに追加してください。
 */

const { enqueueTokens, stopAll } = require('../voice/player');

/** state.timers を全部止める */
function cancelAll(state) {
  for (const h of state.timers) clearTimeout(h);
  state.timers.clear();
}

/** setTimeout をラップして state.timers に登録 */
function scheduleAfter(state, ms, fn) {
  const handle = setTimeout(() => {
    state.timers.delete(handle);
    try { fn(); } catch (e) { console.error('[scheduler] task error:', e); }
  }, ms);
  state.timers.add(handle);
  return handle;
}

/**
 * 試合開始時の定型スケジュール
 * - 興奮 40s READY
 * - 瞬間移動 45s READY
 * - 移形 50s READY
 * - 神出鬼没 60s READY
 * - 裏向きカード 120s READY
 */
async function startMatch(client, state) {
  cancelAll(state);
  state.matchActive = true;

  const gid = state.guildId;

  const scheduleReady = (ms, token) =>
    scheduleAfter(state, ms, () => enqueueTokens(gid, [token, 'tsukae_masu']));

  scheduleReady(40_000, 'kofun');
  scheduleReady(45_000, 'shunkan');
  scheduleReady(50_000, 'ikei');
  scheduleReady(60_000, 'shinshutsu');
  scheduleReady(120_000, 'uramuki');

  // 監視者チャージや特質ごとのT-30/T-10/T-5 などは
  // 既存の実装に合わせてここへ scheduleAfter を追加してください。
}

/** 試合終了：全タイマー停止＋音声キュー停止（VCには待機） */
function endMatch(state) {
  state.matchActive = false;
  cancelAll(state);
  stopAll(state.guildId);
}

module.exports = {
  startMatch,
  endMatch,
  cancelAll,
  scheduleAfter,
};
