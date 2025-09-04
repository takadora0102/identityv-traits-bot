// src/core/render.js
/**
 * 埋め込みとコンポーネント（ボタン/セレクト）を構築
 * ここでは「🎮 ゲーム開始」「🛑 試合終了」「▶ 次の試合開始」を中心に、
 * 試合中/待機中での出し分けを行う。
 * 既存の特質ボタンや裏向きカードセレクトを持っている場合は、
 * buildInGameComponents() 内にマージしてください。
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function buildEmbed(state) {
  const lines = [];

  if (state.matchActive) {
    lines.push('**ステータス:** 試合中');
    lines.push('・特質のCTが進行中です。');
  } else {
    lines.push('**ステータス:** 待機中');
    lines.push('・「▶ 次の試合開始」を押して準備してください。');
  }

  return new EmbedBuilder()
    .setColor(state.matchActive ? 0x00c853 : 0x607d8b)
    .setTitle('Identity V 特質CTコントローラ')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'VOICEVOX:ずんだもん' })
    .setTimestamp(new Date());
}

/** 「🛑 試合終了」「▶ 次の試合開始」行 */
function buildMatchControls(state) {
  const endBtn = new ButtonBuilder()
    .setCustomId('match:end')
    .setStyle(ButtonStyle.Danger)
    .setLabel('🛑 試合終了')
    .setDisabled(!state.matchActive);

  const nextBtn = new ButtonBuilder()
    .setCustomId('match:next')
    .setStyle(ButtonStyle.Success)
    .setLabel('▶ 次の試合開始')
    .setDisabled(state.matchActive);

  return new ActionRowBuilder().addComponents(endBtn, nextBtn);
}

/** 初期（/setup直後）に出す構成：まずは「🎮 ゲーム開始」とマッチコントロール */
function buildInitialComponents() {
  const rowStart = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('game:start')
      .setStyle(ButtonStyle.Primary)
      .setLabel('🎮 ゲーム開始')
  );
  // 初期状態は matchActive=false を想定
  const rowMatch = buildMatchControls({ matchActive: false });
  return [rowStart, rowMatch];
}

/**
 * 試合中のコンポーネント構成
 * - 既存の特質ボタンや裏向きカードセレクトがある場合は rows に加えてください
 * - このサンプルは最小限として、マッチコントロールのみを返します
 */
function buildInGameComponents(state) {
  const rows = [];
  // 例：ここに既存の“特質ボタン行”や“裏向きカードセレクト行”を push する
  // rows.push(buildTraitButtons(state));
  // rows.push(buildUramukiSelect(state));

  rows.push(buildMatchControls(state));
  return rows;
}

module.exports = {
  buildEmbed,
  buildMatchControls,
  buildInitialComponents,
  buildInGameComponents,
};
