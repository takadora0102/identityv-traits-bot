// src/interactions/buttons.js
/**
 * ボタン/セレクトのインタラクションハンドラ
 * - ▶ 試合開始: 試合開始スケジュール＋「試合開始」アナウンス
 * - 🛑 試合終了: 全停止＋「試合終了」アナウンス
 * - ▶ 次の試合開始: 状態リセット→再スケジュール＋「試合開始」
 * - 特質ボタン: 判明→使用アナウンス→CT開始（監視者はスタック表示）
 * - 再使用した: 次のCTへ（監視者は1消費）
 * - 裏向きカード: 変換（比率変換／監視者特例／Listen上限）
 */

const { MessageFlags } = require('discord.js');
const {
  startMatch, endMatch, scheduleTraitCooldown, scheduleTraitCooldownWithRemaining,
  cancelInitialReadyAll, startKanshishaCharging, updatePanel
} = require('../core/scheduler');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInGameComponents } = require('../core/render');
const { TRAITS } = require('../core/traits');
const { enqueueTokens } = require('../voice/player');

function nowSec() { return Math.floor(Date.now() / 1000); }

/** 標準特質の“いまの残りCT（秒）”を取得（なければ0） */
function getStandardRemainSec(state, key) {
  const t = state.traits[key];
  if (!t?.cooldownEndsAt) return 0;
  const ms = t.cooldownEndsAt - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** 監視者の“満タン（3スタック）までの残り時間”を算出（ms, 0..） */
function getKanshishaRemainToFullMs(state) {
  const ks = state.traits.kanshisha?.stacking;
  if (!ks) return 0; // 未開始＝満タン扱い
  if (ks.stacks >= 3) return 0;

  const remainToNext = (1 - (ks.partial || 0)) * (ks.nextMs || 30_000); // いまの1個分
  const remainAfter = Math.max(0, (3 - (ks.stacks + 1))) * 30_000;      // その後の30sずつ
  return Math.max(0, Math.round(remainToNext + remainAfter));
}

/** 監視者→標準特質へ変換時に使う：90sスケール上の残り秒（丸め） */
function kanshishaToOldRemainOn90(state) {
  // 実チャージは最大70sだが、計算スケールは90sとする（ユーザー仕様）
  const remainToFull = getKanshishaRemainToFullMs(state); // 0..70000ms
  const frac = Math.max(0, Math.min(1, remainToFull / 70_000)); // 0..1
  return Math.round(frac * 90); // 0..90
}

/** 標準特質→監視者へ変換時に使う：90sスケールの“進捗”→ stacks/partial に割り当て */
function seedFromRemainOn90(remainOn90) {
  // 進捗（経過）= 90 - 残り。監視者の上限は70s相当なので clamp。
  const progressed = Math.max(0, Math.min(70, 90 - remainOn90));

  if (progressed < 10) {
    return { stacks: 0, partial: progressed / 10, nextMs: 10_000 };
  } else if (progressed < 40) {
    return { stacks: 1, partial: (progressed - 10) / 30, nextMs: 30_000 };
  } else if (progressed < 70) {
    return { stacks: 2, partial: (progressed - 40) / 30, nextMs: 30_000 };
  } else {
    return { stacks: 3, partial: 0, nextMs: 30_000 };
  }
}

/** 現在サイクルの基準CT（秒）を取得（uses=1なら init、それ以降は next） */
function getCurrentCycleBaseCtSec(state, key) {
  const trait = TRAITS[key];
  const t = state.traits[key];
  if (!t || !trait) return trait?.next ?? 0;
  return (t.uses === 1) ? (trait.init ?? trait.next ?? 0) : (trait.next ?? 0);
}

async function handle(interaction, client) {
  const state = getGuildState(interaction.guildId);
  const id = interaction.customId;

  // ▶ 試合開始
  if (id === 'game:start') {
    state.matchActive = true;
    await startMatch(client, state);
    enqueueTokens(state.guildId, ['shiai_kaishi']); // 「試合開始」

    const embed = buildEmbed(state);
    const components = buildInGameComponents(state);
    return interaction.update({ embeds: [embed], components });
  }

  // 🛑 試合終了
  if (id === 'match:end') {
    endMatch(state); // stopAllで再生も停止
    enqueueTokens(state.guildId, ['shiai_shuuryou']); // 「試合終了」

    const embed = buildEmbed(state);
    const components = buildInGameComponents(state);
    return interaction.update({ embeds: [embed], components });
  }

  // ▶ 次の試合開始
  if (id === 'match:next') {
    resetGameState(state);
    state.matchActive = true;

    await startMatch(client, state);
    enqueueTokens(state.guildId, ['shiai_kaishi']); // 「試合開始」

    const embed = buildEmbed(state);
    const components = buildInGameComponents(state);
    return interaction.update({ embeds: [embed], components });
  }

  // ===== 特質ボタン（判明） =====
  if (id.startsWith('trait:') && !id.startsWith('trait:reuse:')) {
    const key = id.split(':')[1];
    const trait = TRAITS[key];
    if (!trait) return;

    if (!state.matchActive) {
      return interaction.reply({ content: '試合が開始されていません。', flags: MessageFlags.Ephemeral });
    }

    // 判明直後の使用アナウンス
    enqueueTokens(state.guildId, ['hunter_ga', trait.token, 'wo_shiyou']);

    // 4特質の開始時READY予約は以降キャンセル
    cancelInitialReadyAll(state);

    // UI状態
    state.revealedKey = key;

    if (trait.flags?.stacking) {
      // 監視者：スタック充填の視覚表示だけ（10s→30s, 最大3）
      startKanshishaCharging(client, state);
      await updatePanel(client, state);
      return interaction.update({ embeds: [buildEmbed(state)], components: buildInGameComponents(state) });
    } else {
      // CT開始（初回はinit）
      const st = state.traits[key] || {};
      const ct = st.uses > 0 ? trait.next : trait.init;

      scheduleTraitCooldown(client, state, key, ct);
      await updatePanel(client, state);
      return interaction.update({ embeds: [buildEmbed(state)], components: buildInGameComponents(state) });
    }
  }

  // ===== 再使用（次のCTへ） =====
  if (id.startsWith('trait:reuse:')) {
    const key = id.split(':')[2];
    const trait = TRAITS[key];
    if (!trait) return;

    if (!state.matchActive) {
      return interaction.reply({ content: '試合が開始されていません。', flags: MessageFlags.Ephemeral });
    }

    // 監視者：1消費（あれば）→ 再充填継続
    if (trait.flags?.stacking) {
      const ks = state.traits[key]?.stacking || {};
      if ((ks.stacks ?? 0) <= 0) {
        return interaction.reply({ content: '監視者がありません。', flags: MessageFlags.Ephemeral });
      }
      // 使用アナウンス
      enqueueTokens(state.guildId, ['hunter_ga', trait.token, 'wo_shiyou']);
      ks.stacks = ks.stacks - 1;
      // 再び充填は startKanshishaCharging() のループで継続
      await updatePanel(client, state);
      return interaction.deferUpdate();
    }

    // 通常特質：READY前なら弾く
    const st = state.traits[key] || {};
    if (st.cooldownEndsAt && Date.now() < st.cooldownEndsAt) {
      const remain = Math.ceil((st.cooldownEndsAt - Date.now()) / 1000);
      return interaction.reply({ content: `まだCT中です（残り ${remain}s）。`, flags: MessageFlags.Ephemeral });
    }

    // 使用アナウンス
    enqueueTokens(state.guildId, ['hunter_ga', trait.token, 'wo_shiyou']);

    // 次回以降CTで開始
    const ct = trait.next;
    scheduleTraitCooldown(client, state, key, ct);
    await updatePanel(client, state);
    return interaction.deferUpdate();
  }

  // ===== 裏向きカード（セレクト） =====
  if (interaction.isStringSelectMenu() && id === 'uramuki:select') {
    if (!state.matchActive) {
      return interaction.reply({ content: '試合が開始されていません。', flags: MessageFlags.Ephemeral });
    }
    if (state.usedUramuki) {
      return interaction.reply({ content: '裏向きカードは既に使用済みです。', flags: MessageFlags.Ephemeral });
    }
    if (!state.revealedKey) {
      return interaction.reply({ content: '特質が判明してから使用してください。', flags: MessageFlags.Ephemeral });
    }

    const oldKey = state.revealedKey;
    const newKey = interaction.values?.[0];
    if (!newKey || !TRAITS[newKey]) {
      return interaction.reply({ content: '変更先が不正です。', flags: MessageFlags.Ephemeral });
    }
    if (newKey === oldKey) {
      return interaction.reply({ content: '同じ特質には変更できません。', flags: MessageFlags.Ephemeral });
    }

    const oldTrait = TRAITS[oldKey];
    const newTrait = TRAITS[newKey];

    // --- 旧特質の“残りCT”と“基準CT”を取得 ---
    let oldRemain = 0;
    let oldCT = 0;

    if (oldTrait.flags?.stacking) {
      // 監視者 → 標準スケール90として扱う
      oldRemain = kanshishaToOldRemainOn90(state); // 0..90
      oldCT = 90;
    } else {
      // 標準特質
      oldRemain = getStandardRemainSec(state, oldKey); // 0..N
      // 現在サイクルの基準CT（uses=1はinit、それ以降next）
      oldCT = getCurrentCycleBaseCtSec(state, oldKey);
      if (oldTrait.flags?.listen) {
        // Listenの最大80を超えないように（保険）
        oldCT = Math.min(oldCT, 80);
        oldRemain = Math.min(oldRemain, 80);
      }
    }

    // 比率変換 newRemain = round(oldRemain * newCT / oldCT)
    let newRemain = 0;

    if (newTrait.flags?.stacking) {
      // → 監視者へ：90秒スケールで残りをマップ
      const f = (oldCT > 0) ? (oldRemain / oldCT) : 0;   // 0..1
      const remainOn90 = Math.round(f * 90);            // 0..90
      const seed = seedFromRemainOn90(remainOn90);      // stacks/partial/nextMs

      // 旧特質のCTタイマー類は停止
      const tOld = state.traits[oldKey];
      if (tOld?.cooldownTimeouts) for (const h of tOld.cooldownTimeouts) clearTimeout(h);
      if (tOld?.uiInterval) clearInterval(tOld.uiInterval);

      // 新特質＝監視者としてセット
      state.revealedKey = newKey;
      state.usedUramuki = true;
      startKanshishaCharging(client, state, seed);
      await updatePanel(client, state);
      return interaction.update({ embeds: [buildEmbed(state)], components: buildInGameComponents(state) });
    } else {
      // → 標準特質へ
      let newCT = getCurrentCycleBaseCtSec(state, newKey);
      // Listenは最大80
      if (newTrait.flags?.listen) newCT = Math.min(newCT, 80);

      if (oldCT > 0) {
        newRemain = Math.round((oldRemain * newCT) / oldCT);
      } else {
        newRemain = 0;
      }
      if (newTrait.flags?.listen) newRemain = Math.min(newRemain, 80);

      // 旧特質のCTタイマー類は停止
      const tOld = state.traits[oldKey];
      if (tOld?.cooldownTimeouts) for (const h of tOld.cooldownTimeouts) clearTimeout(h);
      if (tOld?.uiInterval) clearInterval(tOld.uiInterval);
      if (oldTrait.flags?.stacking) {
        const ks = state.traits[oldKey]?.stacking;
        if (ks?.interval) clearInterval(ks.interval);
      }

      // 新特質の“残りnewRemain秒”から開始（usesは1にして以降next扱い）
      state.revealedKey = newKey;
      state.usedUramuki = true;
      scheduleTraitCooldownWithRemaining(client, state, newKey, newRemain);
      await updatePanel(client, state);
      return interaction.update({ embeds: [buildEmbed(state)], components: buildInGameComponents(state) });
    }
  }

  // 未対応は無視
  return;
}

module.exports = { handle };
