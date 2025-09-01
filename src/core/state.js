// ギルドごとの状態をメモリ管理（MVPなのでDBなし）

const defaultGuildState = () => ({
  panelChannelId: null,
  panelMessageId: null,

  voiceChannelId: null,
  voice: {
    connected: false,
    connection: null,
    player: null,
    queue: [],
    playing: false,
    muted: false
  },

  game: {
    startedAt: null,      // ms epoch
    backcardUsed: false,
    activeTraitKey: null  // ボタンで確定した特質
  },

  // 一般特質のタイマー endAt（ms）を持つ
  traits: {
    // key: { running, endAt, lastStartAt }
  },

  // 監視者の管理（スタックとチャージ予定）
  watcher: {
    stacks: 0,
    chargeTimers: [],    // setTimeout handles
    nextChargeAt: null   // ms epoch（stacks<3の時のみ）
  },

  // アナウンス（音声）予約タイマー（キャンセル用）
  announceTimers: {
    // key: Timeout[]
  },

  // 5秒境界更新のタイマー
  panelTickTimer: null
});

const guildStates = new Map(); // guildId -> state

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, defaultGuildState());
  }
  return guildStates.get(guildId);
}

function resetGameState(state) {
  // 試合単位の情報だけリセット
  state.game.startedAt = null;
  state.game.backcardUsed = false;
  state.game.activeTraitKey = null;
  state.traits = {};
  // 監視者
  clearWatcherTimers(state);
  state.watcher = { stacks: 0, chargeTimers: [], nextChargeAt: null };
  // 予約アナウンス
  cancelAllAnnouncements(state);
}

function clearWatcherTimers(state) {
  for (const t of state.watcher.chargeTimers) {
    try { clearTimeout(t); } catch {}
  }
  state.watcher.chargeTimers = [];
}

function cancelAllAnnouncements(state, traitKey = null) {
  if (traitKey) {
    const arr = state.announceTimers[traitKey] || [];
    arr.forEach(t => { try { clearTimeout(t); } catch {} });
    state.announceTimers[traitKey] = [];
  } else {
    for (const key of Object.keys(state.announceTimers)) {
      state.announceTimers[key].forEach(t => { try { clearTimeout(t); } catch {} });
    }
    state.announceTimers = {};
  }
}

module.exports = {
  getGuildState,
  resetGameState,
  clearWatcherTimers,
  cancelAllAnnouncements
};
