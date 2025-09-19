// src/core/scheduler.js
// CTスケジューラ：60/30/10/5/3/2/1/0（0は「あり」）・初期CTでは3/2/1をスキップ
// 120秒で裏向きカード enable + 「裏向きカード あり」アナウンス

const { updatePanel } = require('./render');
const { enqueueTokens } = require('../voice/player');

function ensureTimeoutBucket(target, key) {
  if (!target) return [];
  if (!Array.isArray(target[key])) target[key] = [];
  return target[key];
}

function registerTimeout(target, key, handle) {
  const bucket = ensureTimeoutBucket(target, key);
  bucket.push(handle);
  return handle;
}

function clearTimeoutBucket(target, key) {
  if (!target || !Array.isArray(target[key])) return;
  for (const h of target[key]) clearTimeout(h);
  target[key].length = 0;
}

function removeTimeoutHandle(target, key, handle) {
  if (!target || !Array.isArray(target[key])) return;
  const idx = target[key].indexOf(handle);
  if (idx >= 0) target[key].splice(idx, 1);
}

// 互換のため残している（以前のコードで呼んでいる可能性）
function startScheduler(_client) {
  // no-op
}

function scheduleAfter(ms, fn) {
  // guard against negative delay
  const delay = Math.max(0, Math.ceil(ms));
  return setTimeout(fn, delay);
}

// marks: 60/30/10/5/3/2/1/0（残りがそれ以上ある場合のみ予約）
function scheduleMarks(client, state, trait, endsAtMs, { isInitial = false } = {}) {
  const now = Date.now();
  const remainSec = Math.ceil((endsAtMs - now) / 1000);

  // 適用可能な刻みを抽出
  const baseMarks = [60, 30, 10, 5, 3, 2, 1, 0];
  const marks = baseMarks.filter(m => remainSec >= m);

  for (const m of marks) {
    const fireAt = endsAtMs - m * 1000;
    const wait = fireAt - Date.now();

    let handle;
    handle = scheduleAfter(wait, () => {
      removeTimeoutHandle(trait, 'cooldownTimeouts', handle);
      // 初期CTでは 3/2/1 をスキップ（0のみ鳴らす）
      if (isInitial && (m === 3 || m === 2 || m === 1)) return;

      if (m === 0) {
        // 完了 → 「（特質）あり」
        enqueueTokens(state.guildId, [trait.token, 'ari']);
        updatePanel(client, state);
      } else if (m >= 5) {
        // 「特質 残り m 秒」系（既存トークンを利用）
        enqueueTokens(state.guildId, [trait.token, 'nokori', `${m}byo`]);
      } else {
        // 3/2/1 は1秒カウント
        const tok = m === 3 ? 'san' : m === 2 ? 'ni' : 'ichi';
        enqueueTokens(state.guildId, [tok]);
      }
    });
    registerTimeout(trait, 'cooldownTimeouts', handle);
  }
}

// 4特質 初期CTのREADY：0秒で「あり」だけ鳴らす（3/2/1はスキップ）
function scheduleInitialReady(client, state, traitKey, readyAtMs) {
  const trait = state.traits?.[traitKey];
  if (!trait) return;
  let handle;
  handle = scheduleAfter(readyAtMs - Date.now(), () => {
    removeTimeoutHandle(trait, 'cooldownTimeouts', handle);
    enqueueTokens(state.guildId, [trait.token, 'ari']);
    updatePanel(client, state);
  });
  registerTimeout(trait, 'cooldownTimeouts', handle);
}

// 裏向きカード：120秒で enable + 一度だけ「裏向きカード あり」
function scheduleUramukiEnable(client, state) {
  if (!state.matchStartAt) return;
  const fireAt = state.matchStartAt + 120000;
  if (Date.now() >= fireAt) return; // 既に過ぎている

  clearTimeoutBucket(state, 'uramukiTimeouts');

  let handle;
  handle = scheduleAfter(fireAt - Date.now(), () => {
    removeTimeoutHandle(state, 'uramukiTimeouts', handle);
    // 既に使っていなければアナウンス
    if (!state.usedUramuki) {
      enqueueTokens(state.guildId, ['uramuki', 'ari']);
    }
    updatePanel(client, state);
  });
  registerTimeout(state, 'uramukiTimeouts', handle);
}

// 汎用：特質CTを開始（残りからでも新規でも）
function startTraitCooldown(client, state, traitKey, cooldownSec, { isInitial = false } = {}) {
  const trait = state.traits?.[traitKey];
  if (!trait) return;

  clearTimeoutBucket(trait, 'cooldownTimeouts');

  const now = Date.now();
  const endsAt = now + cooldownSec * 1000;

  // 5秒ごとの視覚タイマー更新
  if (trait.uiInterval) clearInterval(trait.uiInterval);
  trait.endsAt = endsAt;
  trait.uiInterval = setInterval(() => {
    // 試合が終わっていたら止める
    if (!state.matchActive) {
      clearInterval(trait.uiInterval);
      trait.uiInterval = null;
      return;
    }
    updatePanel(client, state);
  }, 5000);

  scheduleMarks(client, state, trait, endsAt, { isInitial });
}

module.exports = {
  startScheduler,
  scheduleInitialReady,
  scheduleUramukiEnable,
  startTraitCooldown,
};
