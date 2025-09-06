// src/core/state.js
/**
 * ギルドごとの状態管理
 * - matchActive: 試合中フラグ
 * - matchStartAt: 試合開始の時刻（ms）
 * - timers: setTimeout のハンドル群（試合終了で一括キャンセル）
 * - intervals: setInterval のハンドル群（試合終了で一括キャンセル）
 * - initialReady: 開始時READYの予約 { key -> timeoutHandle }
 * - traits: 各特質の状態
 * - revealedKey: 判明している特質のkey（UIの出し分けに使用）
 * - usedUramuki: 裏向きカードを既に使用したか
 * - voice/panel参照: voiceChannelId, panelChannelId, panelMessageId
 */

const guildStates = new Map(); // guildId -> state

function createInitialState(guildId) {
  return {
    guildId,
    matchActive: false,
    matchStartAt: null,

    timers: new Set(),
    intervals: new Set(),

    initialReady: {},

    traits: {
      // keyごとに { uses, cooldownEndsAt, cooldownSec, cooldownTimeouts:Set, uiInterval, stacking:{stacks,partial,nextMs,lastTick,interval} } を保持
    },

    revealedKey: null,
    usedUramuki: false,

    voiceChannelId: null,
    panelChannelId: null,
    panelMessageId: null,
  };
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, createInitialState(guildId));
  }
  return guildStates.get(guildId);
}

/** タイマー/インターバル一括停止（コールバックは実行されない） */
function cancelAllTimers(state) {
  for (const h of state.timers) clearTimeout(h);
  state.timers.clear();
  for (const i of state.intervals) clearInterval(i);
  state.intervals.clear();
  state.initialReady = {};
  // 特質ごとの個別タイマーもクリア
  for (const k of Object.keys(state.traits)) {
    const t = state.traits[k];
    if (!t) continue;
    if (t.cooldownTimeouts) for (const h of t.cooldownTimeouts) clearTimeout(h);
    if (t.uiInterval) clearInterval(t.uiInterval);
    if (t.stacking?.interval) clearInterval(t.stacking.interval);
  }
  state.traits = {};
}

/** 次の試合に向けた“ゲーム関連のみ”初期化 */
function resetGameState(state) {
  state.matchActive = false;
  state.matchStartAt = null;
  state.revealedKey = null;
  state.usedUramuki = false;
  cancelAllTimers(state);
}

module.exports = {
  guildStates,
  createInitialState,
  getGuildState,
  resetGameState,
  cancelAllTimers,
};
