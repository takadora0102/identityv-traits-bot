// src/interactions/buttons.js
/**
 * ボタンのインタラクションをさばくハンドラ
 * - ▶ 試合開始: 試合開始スケジュールをセットし、「試合開始」をアナウンス
 * - 🛑 試合終了: タイマーと音声を止めてから「試合終了」をアナウンス
 * - ▶ 次の試合開始: 状態初期化→開始スケジュール再設定→「試合開始」をアナウンス
 * 既存の特質ボタン等は、この分岐の下に続けてください。
 */

const { startMatch, endMatch } = require('../core/scheduler');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInGameComponents } = require('../core/render');
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

  // ===== ここから下に、既存の特質ボタン等の分岐を続けてください =====
  // 例:
  // if (id.startsWith('trait:')) { ... }
  // if (id === 'uramuki:select') { ... }

  // 未対応のボタンは無視
  return;
}

module.exports = { handle };
