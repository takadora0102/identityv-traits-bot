// src/core/state.js
/**
 * ギルドごとの状態管理
 * - matchActive: 試合中フラグ
 * - timers: setTimeout のハンドル群（試合終了で一括キャンセル）
 * - voiceChannelId / panel* : 参照用
 * - （必要に応じて拡張: 特質CT など）
 */

const guildStates = new Map(); // guildId -> state

function createInitialState(guildId) {
  return {
    guildId,
    matchActive: false,
    timers: new Set(),
    voiceChannelId: null,
    panelChannelId: null,
    panelMessageId: null,

    // ここから下は任意の拡張（必要に応じて使ってください）
    traits: {
      // 例：特質ごとの次回使用可能時刻などを保持したいときに使う
    },
  };
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, createInitialState(guildId));
  }
  return guildStates.get(guildId);
}

/** 次の試合に向けて“ゲーム関連のみ”初期化（VC接続やパネル情報は維持） */
function resetGameState(state) {
  // 試合関連タイマーをここでは触らない（scheduler側の cancelAll で止める）
  state.matchActive = false;

  // 特質などゲーム単位の状態があればリセット
  state.traits = {};
}

module.exports = {
  guildStates,      // スケジューラや index から参照できるよう公開
  createInitialState,
  getGuildState,
  resetGameState,
};
