// src/core/scheduler.js
/**
 * 試合の開始・終了とアナウンスのスケジューリング
 * - 開始時READY（興奮/瞬移/移形/神出鬼没）と 裏向きカード120s
 * - 解読加速（202s）: -60s/-30s/0s を予約
 * - 特質判明→CT開始: T-60(>=60のみ)/T-30/T-10/T-5/T=0 アナウンス
 * - 5秒毎UI更新（Embed/Buttons）
 */

const { enqueueTokens, stopAll } = require('../voice/player');
const { TRAITS, PRIMARY_READY_KEYS } = require('./traits');
const { cancelAllTimers } = require('./state');
const { buildEmbed, buildInGameComponents } = require('./render');

function clampDelay(ms) {
  const n = Math.floor(ms || 0);
  return n < 1 ? 1 : n;
}

/** state.timers 管理つき setTimeout */
function scheduleAfter(state, ms, fn) {
  const h = setTimeout(() => {
    state.timers.delete(h);
    try { fn(); } catch (e) { console.error('[scheduler] task error:', e); }
  }, clampDelay(ms));
  state.timers.add(h);
  return h;
}

/** state.intervals 管理つき setInterval */
function intervalEvery(state, ms, fn) {
  const i = setInterval(() => {
    try { fn(); } catch (e) { console.error('[scheduler] interval error:', e); }
  }, clampDelay(ms));
  state.intervals.add(i);
  return i;
}

/** UIを更新（Embed+Components を差し替え） */
async function updatePanel(client, state) {
  if (!state.panelChannelId || !state.panelMessageId) return;
  try {
    const ch = await client.channels.fetch(state.panelChannelId);
    const embed = buildEmbed(state);
    const comps = buildInGameComponents(state);
    await ch.messages.edit(state.panelMessageId, { embeds: [embed], components: comps });
  } catch (e) {
    console.error('[scheduler] updatePanel error:', e?.message || e);
  }
}

/** 開始時READY（4種）と裏向きカード120sの予約 */
function scheduleInitialReady(client, state) {
  const gid = state.guildId;

  function readyAfter(sec, key) {
    const trait = TRAITS[key];
    if (!trait) return;
    const h = scheduleAfter(state, sec * 1000, () => enqueueTokens(gid, [trait.token, 'tsukae_masu']));
    state.initialReady[key] = h;
  }

  // 4特質のREADY
  readyAfter(TRAITS.kofun.init, 'kofun');
  readyAfter(TRAITS.shunkan.init, 'shunkan');
  readyAfter(TRAITS.ikei.init, 'ikei');
  readyAfter(TRAITS.shinshutsu.init, 'shinshutsu');

  // 裏向きカード（120s）
  scheduleAfter(state, 120_000, () => enqueueTokens(gid, ['uramuki', 'tsukae_masu']));
}

/** 解読加速（202s）: -60/-30/0 の予約 */
function scheduleDecodeBoost(client, state) {
  const gid = state.guildId;
  const base = 202_000;
  const plan = [
    { at: base - 60_000, tokens: ['kaitoku_kasoku', 'nokori', '60byo'] },
    { at: base - 30_000, tokens: ['kaitoku_kasoku', 'nokori', '30byo'] },
    { at: base,          tokens: ['kaitoku_kasoku', 'hatsudou'] },
  ];
  for (const p of plan) {
    scheduleAfter(state, p.at, () => enqueueTokens(gid, p.tokens));
  }
}

/** 4特質のREADY予約をすべてキャンセル（判明時の重複防止） */
function cancelInitialReadyAll(state) {
  for (const k of PRIMARY_READY_KEYS) {
    const h = state.initialReady[k];
    if (h) {
      clearTimeout(h);
      delete state.initialReady[k];
    }
  }
}

/** 特質の使用→CT開始（アナウンス予約＋UI更新） */
function scheduleTraitCooldown(client, state, key, cooldownSec) {
  const gid = state.guildId;
  if (!state.traits[key]) state.traits[key] = { uses: 0, cooldownTimeouts: new Set() };
  const t = state.traits[key];

  // 既存のCTタイマー/インターバルをクリア
  if (t.cooldownTimeouts) {
    for (const h of t.cooldownTimeouts) clearTimeout(h);
    t.cooldownTimeouts.clear();
  }
  if (t.uiInterval) clearInterval(t.uiInterval);

  const now = Date.now();
  t.uses = (t.uses || 0) + 1;
  t.cooldownSec = cooldownSec;
  t.cooldownEndsAt = now + cooldownSec * 1000;

  // 残り通知（>=60 のとき T-60 あり）
  const marks = [];
  if (cooldownSec >= 60) marks.push(60);
  marks.push(30, 10, 5, 0);

  for (const m of marks) {
    const when = t.cooldownEndsAt - m * 1000;
    const handle = scheduleAfter(state, when - now, () => {
      if (m === 0) {
        enqueueTokens(gid, [TRAITS[key].token, 'tsukae_masu']);
      } else {
        const tokenSec = `${m}byo`;
        enqueueTokens(gid, [TRAITS[key].token, 'nokori', tokenSec]);
      }
      // T=0 到達時にUI更新
      if (m === 0) updatePanel(client, state);
    });
    t.cooldownTimeouts.add(handle);
  }

  // 5秒ごとにUI更新（残りCT表記）
  t.uiInterval = intervalEvery(state, 5000, () => updatePanel(client, state));
}

/** 監視者のチャージ進行（所持 N + M/10 表示用） */
function startKanshishaCharging(client, state) {
  const key = 'kanshisha';
  if (!state.traits[key]) state.traits[key] = {};
  const ks = state.traits[key].stacking = state.traits[key].stacking || {};

  // 初期化（所持0、部分進行0）
  ks.stacks = ks.stacks ?? 0;
  ks.partial = ks.partial ?? 0; // 0..1 (次の1個までの進捗)
  ks.lastTick = Date.now();
  ks.nextMs = ks.stacks === 0 ? 10_000 : 30_000; // 最初は10s、その後30s

  if (ks.interval) clearInterval(ks.interval);
  ks.interval = intervalEvery(state, 5000, () => {
    const now = Date.now();
    const elapsed = now - ks.lastTick;

    if (ks.stacks >= 3) {
      ks.partial = 0;
      ks.lastTick = now;
      return; // 満タン
    }

    const progress = (elapsed + ks.partial * ks.nextMs) / ks.nextMs;
    if (progress >= 1) {
      ks.stacks = Math.min(3, ks.stacks + 1);
      ks.partial = 0;
      ks.lastTick = now;
      ks.nextMs = 30_000; // 以降は30s毎
    } else {
      ks.partial = progress;
      ks.lastTick = now;
    }

    updatePanel(client, state);
  });
}

/** ▶ 試合開始 */
async function startMatch(client, state) {
  cancelAllTimers(state);
  state.matchActive = true;
  state.matchStartAt = Date.now();
  state.revealedKey = null;

  scheduleInitialReady(client, state);
  scheduleDecodeBoost(client, state);

  // UI初期表示
  await updatePanel(client, state);
}

/** 🛑 試合終了：全停止（VCには待機） */
function endMatch(state) {
  state.matchActive = false;
  cancelAllTimers(state);
  stopAll(state.guildId);
}

/**
 * 互換用 no-op:
 * 旧実装では ClientReady で定期ジョブを起動していたため、
 * index.js が呼ぶ startScheduler を残しておく（現実装では不要）。
 */
function startScheduler(/* client, guildStates */) {
  // 何もしない
}

module.exports = {
  startMatch,
  endMatch,
  scheduleAfter,
  scheduleTraitCooldown,
  cancelInitialReadyAll,
  startKanshishaCharging,
  updatePanel,
  startScheduler, // ← 追加（no-op）
};
