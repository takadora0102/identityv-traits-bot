// src/interactions/buttons.js
/**
 * ボタンのインタラクションをさばくハンドラ
 * - ▶ 試合開始: 試合開始スケジュール＋「試合開始」アナウンス
 * - 🛑 試合終了: 全停止＋「試合終了」アナウンス
 * - ▶ 次の試合開始: 状態リセット→再スケジュール＋「試合開始」
 * - 特質ボタン: 判明→使用アナウンス→CT開始（監視者はスタック表示）
 * - 再使用した: 次のCT開始（Tマーク再予約）
 */

const { MessageFlags } = require('discord.js');
const { startMatch, endMatch, scheduleTraitCooldown, cancelInitialReadyAll, startKanshishaCharging, updatePanel } = require('../core/scheduler');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInGameComponents } = require('../core/render');
const { TRAITS } = require('../core/traits');
const { enqueueTokens } = require('../voice/player');

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

  // 未対応は無視
  return;
}

module.exports = { handle };
