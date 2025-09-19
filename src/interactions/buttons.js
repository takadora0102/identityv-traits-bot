// src/interactions/buttons.js
// すべてのボタン / セレクト / モーダル をここで捌く（index.js から client を渡す）
// - ランク/マルチ分岐
// - 試合開始・終了・次の試合
// - 裏向きカード（開始時から表示・120秒でenable）
// - 特質使用（再使用トリガ）
// - ランクの段階UIは rank.js に委譲

const { MessageFlags } = require('discord.js');
const { createMatch, updateMatch, closeMatch } = require('../db');
const { updatePanel } = require('../core/render');
const { getGuildState: getCoreGuildState } = require('../core/state');
const rank = require('./rank');
const {
  scheduleInitialReady,
  scheduleUramukiEnable,
  startTraitCooldown,
} = require('../core/scheduler');
const { enqueueTokens, stopAll, disconnect } = require('../voice/player');

// 特質テーブル（抜粋例：実プロジェクトの既存 state.traits を利用してください）
const NEXT_CT = { // nextサイクル（通常CT）
  kofun: 100,        // 興奮
  shunkan: 100,      // 瞬間移動
  ikei: 100,         // 移形
  shinshutsu: 150,   // 神出鬼没
  ijou: 90,          // 異常
  junshi: 90,        // 巡視者
  kanshi: 90,        // 監視者（90秒スケール）
  listen: 80,        // リッスン（上限80）
};
const INITIAL_CT = { // 開始時CT（初回のみ）
  kofun: 40,
  shunkan: 45,
  ikei: 50,
  shinshutsu: 60,
  ijou: 40,
  junshi: 30,
  kanshi: 10,
  listen: 20,
};

const TRAIT_LABELS = {
  kofun: '興奮',
  shunkan: '瞬間移動',
  ikei: '移形',
  shinshutsu: '神出鬼没',
  ijou: '異常',
  junshi: '巡視者',
  kanshi: '監視者',
  listen: 'リッスン',
};

function createInitialRankState() {
  return {
    mapName: null,
    bansSurv: [],
    bansHun: [],
    picksSurv: [],
    pickHunter: null,
    matchId: null,
  };
}

function getGuildState(client, interaction) {
  // 既存の state 管理に合わせて取得してください（例では client にぶら下げる）
  client.__guildStates ||= new Map();
  const gid = interaction.guildId;
  const sharedState = getCoreGuildState(gid);
  if (sharedState && !sharedState.rank) sharedState.rank = createInitialRankState();
  if (!client.__guildStates.has(gid)) {
    client.__guildStates.set(gid, {
      guildId: gid,
      panelChannelId: interaction.channelId,
      panelMessageId: interaction.message?.id,
      voiceChannelId: sharedState?.voiceChannelId ?? null,
      mode: null,             // 'rank' | 'multi'
      matchActive: false,
      matchStartAt: null,
      usedUramuki: false,
      revealedKey: null,
      revealedLabel: null,
      // ランク用ステート
      rank: createInitialRankState(),
      // 特質構造（音声トークン名と endsAt 管理）
      traits: {
        kofun:      { token: 'kofun',      endsAt: 0, uiInterval: null },
        shunkan:    { token: 'shunkan',    endsAt: 0, uiInterval: null },
        ikei:       { token: 'ikei',       endsAt: 0, uiInterval: null },
        shinshutsu: { token: 'shinshutsu', endsAt: 0, uiInterval: null },
        ijou:       { token: 'ijou',       endsAt: 0, uiInterval: null },
        junshi:     { token: 'junshi',     endsAt: 0, uiInterval: null },
        kanshi:     { token: 'kanshi',     endsAt: 0, uiInterval: null },
        listen:     { token: 'listen',     endsAt: 0, uiInterval: null },
      },
    });
  }
  const st = client.__guildStates.get(gid);
  if (sharedState) {
    st.voiceChannelId = sharedState.voiceChannelId;
  }
  // 最新のメッセージIDを覚えておく（update用）
  const msgFlags = interaction.message?.flags;
  const isEphemeralMessage = Boolean(
    msgFlags?.has?.(MessageFlags.Ephemeral) ??
      (typeof msgFlags?.bitfield === 'number'
        ? msgFlags.bitfield & MessageFlags.Ephemeral
        : typeof msgFlags === 'number' && msgFlags & MessageFlags.Ephemeral)
  );
  if (!isEphemeralMessage) {
    if (interaction.message?.id) st.panelMessageId = interaction.message.id;
    if (interaction.channelId) st.panelChannelId = interaction.channelId;
  } else if (!st.panelChannelId && interaction.channelId) {
    st.panelChannelId = interaction.channelId;
  }
  return st;
}

// 変換比率（裏向きカード）
// 新残りCT ＝ 旧残りCT × (新nextCT / 旧nextCT)
// 特例：listen は80s上限。監視者は90s基準に投影。
function convertRemaining(oldKey, newKey, remainSec) {
  const base = (k) => {
    if (k === 'listen') return 80;
    if (k === 'kanshi') return 90;
    return NEXT_CT[k] ?? 100;
  };
  const oldBase = base(oldKey);
  const newBase = base(newKey);
  if (oldBase <= 0 || newBase <= 0) return Math.max(0, Math.round(remainSec));
  let res = Math.round((remainSec * newBase) / oldBase);
  if (newKey === 'listen') res = Math.min(res, 80);
  return Math.max(0, res);
}

function snapshotMatchMeta(state) {
  const now = Date.now();
  const traitCooldowns = {};
  for (const [key, trait] of Object.entries(state.traits || {})) {
    const endsAt = typeof trait?.endsAt === 'number' ? trait.endsAt : 0;
    const remainingMs = Math.max(0, endsAt - now);
    traitCooldowns[key] = {
      token: trait?.token ?? null,
      endsAt,
      remainingMs,
      remainingSec: Math.max(0, Math.ceil(remainingMs / 1000)),
    };
  }

  return {
    revealedKey: state.revealedKey ?? null,
    revealedLabel: state.revealedLabel ?? null,
    usedUramuki: Boolean(state.usedUramuki),
    matchActive: Boolean(state.matchActive),
    matchStartAt: state.matchStartAt ?? null,
    traitCooldowns,
    updatedAt: new Date().toISOString(),
  };
}

async function persistMatchMeta(state, context) {
  const matchId = state?.rank?.matchId;
  if (!matchId) return;
  try {
    await updateMatch(matchId, { meta: snapshotMatchMeta(state) });
  } catch (err) {
    console.error(`[buttons] failed to persist match meta (${context})`, err);
  }
}

async function closeActiveMatch(state, reason) {
  const shared = getCoreGuildState(state.guildId);
  const matchId = state?.rank?.matchId ?? shared?.rank?.matchId ?? null;

  if (matchId) {
    try {
      await closeMatch(matchId);
    } catch (err) {
      console.error(`[buttons] failed to close match (${reason})`, err);
    }
  }

  if (state?.rank) state.rank.matchId = null;
  if (shared) {
    if (!shared.rank) shared.rank = {};
    shared.rank.matchId = null;
  }
}

// 初期CTの予約（4特質 + 裏向きカード120s enable）
function scheduleMatchStart(client, state) {
  state.matchActive = true;
  state.matchStartAt = Date.now();
  state.usedUramuki = false;

  // 初期CTのREADY（0秒で「あり」だけ鳴らす）
  for (const k of ['kofun','shunkan','ikei','shinshutsu']) {
    const readyAt = state.matchStartAt + INITIAL_CT[k] * 1000;
    scheduleInitialReady(client, state, k, readyAt);
  }

  // 裏向きカード：120秒で enable + 「あり」
  scheduleUramukiEnable(client, state);

  // 解読加速（60/30/0のアナウンス）= 202秒
  const accelAt = state.matchStartAt + 202000;
  const notify = (sec) => {
    const when = accelAt - sec * 1000;
    const wait = when - Date.now();
    // guard against negative delay
    const delay = Math.max(0, Math.ceil(wait));
    setTimeout(() => {
      if (!state.matchActive) return;
      if (sec === 0) enqueueTokens(state.guildId, ['kaidoku_kasoku', 'hatsudou']); // 任意の音声構成
      else enqueueTokens(state.guildId, ['kaidoku_kasoku', 'nokori', `${sec}byo`]);
    }, delay);
  };
  for (const m of [60, 30, 0]) notify(m);
}

async function handle(interaction, client) {
  const state = getGuildState(client, interaction);

  // ランク専用の分岐（map / ban / pick / result など）
  if (await rank.route(interaction, client, state)) {
    // rank.js が処理した
    return;
  }

  // どのタイプでもまずは defer（セレクト/ボタン/モーダル問わずOK）
  try {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
    } else if (interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  } catch {}

  // 共通ボタン・セレクト
  const id = interaction.customId;

  // 入口：モード選択
  if (interaction.isButton() && id === 'mode:rank') {
    state.mode = 'rank';
    state.matchActive = false;
    state.rank = state.rank || createInitialRankState();
    return updatePanel(client, state, interaction);
  }
  if (interaction.isButton() && id === 'mode:multi') {
    state.mode = 'multi';
    state.matchActive = false;
    return updatePanel(client, state, interaction);
  }

  // 試合制御
  if (interaction.isButton() && id === 'game:start') {
    const matchMode = state.mode === 'rank' ? 'rank' : 'multi';
    const panelChannelId = state.panelChannelId ?? interaction.channelId;
    const panelMessageId = state.panelMessageId ?? interaction.message?.id ?? null;
    try {
      const matchId = await createMatch({
        guildId: state.guildId,
        channelId: panelChannelId,
        mode: matchMode,
        createdBy: interaction.user?.id,
      });

      state.rank ||= createInitialRankState();
      state.rank.matchId = matchId;

      const shared = getCoreGuildState(state.guildId);
      if (shared) {
        if (!shared.rank) shared.rank = {};
        shared.rank.matchId = matchId;
      }

      const rankSnapshot = matchMode === 'rank' ? state.rank : createInitialRankState();
      await updateMatch(matchId, {
        map: rankSnapshot.mapName ?? null,
        bans_surv: rankSnapshot.bansSurv ?? [],
        bans_hunter: rankSnapshot.bansHun ?? [],
        picks_surv: rankSnapshot.picksSurv ?? [],
        pick_hunter: rankSnapshot.pickHunter ?? null,
        meta: {
          voice_channel_id: state.voiceChannelId ?? null,
          panel_channel_id: panelChannelId,
          panel_message_id: panelMessageId,
        },
      });
    } catch (err) {
      console.error('[buttons] failed to create/update match record', err);
    }

    enqueueTokens(state.guildId, ['shiai_kaishi']); // 「試合開始」
    scheduleMatchStart(client, state);
    return updatePanel(client, state, interaction);
  }

  if (interaction.isButton() && id === 'game:end') {
    // 試合終了：音声 & 状態リセット（ランクは rank.js 側で結果入力 → save）
    enqueueTokens(state.guildId, ['shiai_shuuryou']);
    await closeActiveMatch(state, 'game:end');
    state.matchActive = false;
    state.matchStartAt = null;
    state.usedUramuki = false;
    state.revealedKey = null;
    state.revealedLabel = null;
    // 特質タイマー停止
    for (const t of Object.values(state.traits)) {
      if (t.uiInterval) clearInterval(t.uiInterval);
      t.uiInterval = null; t.endsAt = 0;
    }
    return updatePanel(client, state, interaction);
  }

  if (interaction.isButton() && id === 'game:next') {
    // 待機へ戻す（入口へ）
    await closeActiveMatch(state, 'game:next');
    state.mode = null;
    state.rank = createInitialRankState();
    state.matchActive = false;
    state.matchStartAt = null;
    state.usedUramuki = false;
    state.revealedKey = null;
    state.revealedLabel = null;
    for (const t of Object.values(state.traits)) {
      if (t.uiInterval) clearInterval(t.uiInterval);
      t.uiInterval = null; t.endsAt = 0;
    }
    return updatePanel(client, state, interaction);
  }

  if (interaction.isButton() && id === 'voice:disconnect') {
    stopAll(state.guildId);
    disconnect(state.guildId);
    state.rank = createInitialRankState();
    state.voiceChannelId = null;
    try {
      const shared = getCoreGuildState(state.guildId);
      if (shared) {
        shared.voiceChannelId = null;
        shared.rank = createInitialRankState();
      }
    } catch {}
    try {
      await interaction.followUp({ content: 'VCから切断しました', flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('[buttons] failed to send voice disconnect notice', e);
    }
    return updatePanel(client, state, interaction);
  }

  // 特質：使用（各特質ボタンで判明 & 使用を記録）
  if (interaction.isButton() && id.startsWith('trait:used:')) {
    const key = id.split(':')[2];
    if (!state.traits[key]) return updatePanel(client, state, interaction);
    state.revealedKey = key;
    state.revealedLabel = TRAIT_LABELS[key] || key;
    const ct = NEXT_CT[key] ?? 100;
    startTraitCooldown(client, state, key, ct, { isInitial: false });
    enqueueTokens(state.guildId, [state.traits[key].token, 'tsukatta']);
    const persistPromise = persistMatchMeta(state, `trait:used:${key}`);
    await updatePanel(client, state, interaction);
    await persistPromise;
    return;
  }

  // 裏向きカード（常時表示：120秒まで disabled。120秒以降 & 未使用なら可）
  if (interaction.isStringSelectMenu() && id === 'uramuki:select') {
    if (!state.matchActive || state.usedUramuki) return updatePanel(client, state, interaction);
    if (!state.matchStartAt || Date.now() < state.matchStartAt + 120000) return updatePanel(client, state, interaction);

    const newKey = interaction.values?.[0];
    if (!newKey || !state.traits[newKey]) return updatePanel(client, state, interaction);

    // 未判明 → 変換して即「あり」
    if (!state.revealedKey) {
      state.revealedKey = newKey;
      state.revealedLabel = TRAIT_LABELS[newKey] || newKey;
      state.usedUramuki = true;
      enqueueTokens(state.guildId, [state.traits[newKey].token, 'ari']);
      const persistPromise = persistMatchMeta(state, `uramuki:reveal:${newKey}`);
      await updatePanel(client, state, interaction);
      await persistPromise;
      return;
    }

    // 判明済み → 残りから比率変換
    const oldKey = state.revealedKey;
    const remainSec = Math.max(0, Math.ceil((state.traits[oldKey].endsAt - Date.now()) / 1000));
    const newRemain = convertRemaining(oldKey, newKey, remainSec);

    state.revealedKey = newKey;
    state.revealedLabel = TRAIT_LABELS[newKey] || newKey;
    state.usedUramuki = true;

    if (newRemain <= 0) {
      enqueueTokens(state.guildId, [state.traits[newKey].token, 'ari']);
      const persistPromise = persistMatchMeta(state, `uramuki:instant:${oldKey}->${newKey}`);
      await updatePanel(client, state, interaction);
      await persistPromise;
      return;
    }
    startTraitCooldown(client, state, newKey, newRemain, { isInitial: false });
    const persistPromise = persistMatchMeta(state, `uramuki:convert:${oldKey}->${newKey}`);
    await updatePanel(client, state, interaction);
    await persistPromise;
    return;
  }

  // ここに到達したら UI だけ更新
  return updatePanel(client, state, interaction);
}

module.exports = { handle };
