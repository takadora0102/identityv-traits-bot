// src/core/render.js
/**
 * 埋め込みとコンポーネント（ボタン/セレクト）を構築
 * - 初期: 「▶ 試合開始」＋ マッチコントロール
 * - 試合中:
 *    - 特質未判明: 特質ボタン行を表示
 *    - 特質判明:   タイマー or 監視者スタック表示＋「再使用した」ボタン＋裏向きカードセレクト
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { TRAITS, URAMUKI_CHOICES } = require('./traits');

function secsRemaining(msUntil) {
  const r = Math.ceil((msUntil - Date.now()) / 1000);
  return r < 0 ? 0 : r;
}

function buildEmbed(state) {
  const lines = [];

  if (!state.matchActive) {
    lines.push('**ステータス:** 待機中');
    lines.push('・「▶ 次の試合開始」を押して準備してください。');
  } else {
    lines.push('**ステータス:** 試合中');

    // 判明しているなら、残りCT or 監視者スタックを表示
    const key = state.revealedKey;
    if (key) {
      const trait = TRAITS[key];
      if (trait?.flags?.stacking) {
        const ks = state.traits[key]?.stacking || {};
        const tenths = Math.floor((ks.partial || 0) * 10);
        lines.push(`**${trait.name}**: 所持 **${ks.stacks ?? 0} + ${tenths}/10**（最大3）`);
      } else {
        const t = state.traits[key];
        const remain = t?.cooldownEndsAt ? secsRemaining(t.cooldownEndsAt) : 0;
        lines.push(`**${trait.name}**: 残り **${remain}s**`);
      }
    } else {
      lines.push('・特質が判明していません。特質ボタンで判明を記録できます。');
    }
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
    .setDisabled(false);

  return new ActionRowBuilder().addComponents(endBtn, nextBtn);
}

/** 初期（/setup直後）に出す構成：まずは「▶ 試合開始」とマッチコントロール */
function buildInitialComponents() {
  const rowStart = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('game:start')
      .setStyle(ButtonStyle.Primary)
      .setLabel('▶ 試合開始')
  );
  const rowMatch = buildMatchControls({ matchActive: false });
  return [rowStart, rowMatch];
}

/** 特質ボタンの行（未判明時に表示） */
function buildTraitButtonsRow() {
  const keys = ['kofun', 'shunkan', 'ikei', 'shinshutsu', 'ijou', 'junshisha', 'kanshisha', 'listen'];
  const row = new ActionRowBuilder();
  for (const k of keys) {
    const bt = new ButtonBuilder()
      .setCustomId(`trait:${k}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(TRAITS[k].name);
    row.addComponents(bt);
  }
  return row;
}

/** タイマー表示中の操作行：再使用ボタン */
function buildReuseRow(key) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trait:reuse:${key}`)
      .setStyle(ButtonStyle.Primary)
      .setLabel('再使用した')
  );
}

/** 裏向きカードセレクト（判明中かつ未使用時に表示） */
function buildUramukiRow(currentKey) {
  const options = URAMUKI_CHOICES
    .filter(k => k !== currentKey)
    .map(k => ({ label: TRAITS[k].name, value: k }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('uramuki:select')
    .setPlaceholder('裏向きカード：変更先を選択')
    .setMinValues(1)
    .setMaxValues(1)
    .setOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

/** 試合中のコンポーネント構成 */
function buildInGameComponents(state) {
  const rows = [];
  const key = state.revealedKey;

  if (!key) {
    // 未判明：特質ボタン行
    rows.push(buildTraitButtonsRow());
  } else {
    // 判明：再使用ボタン
    rows.push(buildReuseRow(key));
    // 裏向きカード（未使用時のみ）
    if (!state.usedUramuki) {
      rows.push(buildUramukiRow(key));
    }
  }

  // 共通のマッチコントロール
  rows.push(buildMatchControls(state));
  return rows;
}

module.exports = {
  buildEmbed,
  buildInitialComponents,
  buildInGameComponents,
};
