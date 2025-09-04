// src/interactions/buttons.js
/**
 * ボタンのインタラクションをさばくハンドラ
 * - 🎮 ゲーム開始: 試合開始スケジュールをセットし、UIを試合中に更新
 * - 🛑 試合終了: タイマーと音声を止めて待機状態へ
 * - ▶ 次の試合開始: 状態初期化→開始スケジュール再設定
 * 既存の特質ボタン等は、この分岐の下に続けてください。
 */

const { startMatch, endMatch } = require('../core/scheduler');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInGameComponents, buildInitialComponents } = require('../core/render');

module.exports = async function handleButton(interaction, client) {
  const state = getGuildState(interaction.guildId);
  const id = interaction.customId;

  // 🎮 ゲーム開始
  if (id === 'game:start') {
    // 既に試合中の場合は何もしない/または再スケジュールなど好みで
    state.matchActive = true;

    await startMatch(client, state);

    const embed = buildEmbed(state);
    const components = buildInGameComponents(state);
    return interaction.update({ embeds: [embed], components });
  }

  // 🛑 試合終了
  if (id === 'match:end') {
    endMatch(state);

    const embed = buildEmbed(state);
    // 待機中のUI：特質ボタンを消して、マッチコントロールのみ
    const components = buildInGameComponents(state); // ここを「待機用UI関数」に分けてもOK
    return interaction.update({ embeds: [embed], components });
  }

  // ▶ 次の試合開始
  if (id === 'match:next') {
    // ゲーム状態を初期化してから開始
    resetGameState(state);
    state.matchActive = true;

    await startMatch(client, state);

    const embed = buildEmbed(state);
    const components = buildInGameComponents(state);
    return interaction.update({ embeds: [embed], components });
  }

  // ===== ここから下に、既存の特質ボタン等の分岐を続けてください =====
  // 例:
  // if (id.startsWith('trait:')) { ... }
  // if (id === 'uramuki:select') { ... }

  // 未対応のボタンは無視（or 既存処理にフォールバック）
  return;
};
