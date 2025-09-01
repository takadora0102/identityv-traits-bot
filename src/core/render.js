const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { TRAITS } = require('./constants');

/** 秒を mm:ss 文字列へ（切上げ済みの秒が来る前提） */
function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** 5秒刻みの切り上げ（表示向け） */
function ceil5(sec) {
  if (sec <= 0) return 0;
  return Math.ceil(sec / 5) * 5;
}

/** パネルの埋め込み（毎5秒更新で使う） */
function buildEmbed(state) {
  const now = Date.now();
  const lines = [];

  // アクティブ特質（分かっている場合はメイン表示）
  const active = state.game.activeTraitKey;

  if (!state.game.startedAt) {
    lines.push('ゲームは未開始です。「🎮 ゲーム開始」を押してください。');
  } else {
    if (active) {
      if (active === 'watcher') {
        // 監視者表示：所持 n/3 ｜ 次 xs
        const n = state.watcher.stacks ?? 0;
        const next = state.watcher.nextChargeAt ? Math.max(0, Math.ceil((state.watcher.nextChargeAt - now) / 1000)) : 0;
        const nextTxt = (n >= 3) ? 'READY' : `${fmt(ceil5(next))}`;
        lines.push(`**監視者**：所持 **${n}/3**｜次 **${nextTxt}**`);
      } else {
        const t = state.traits[active];
        if (t?.endAt) {
          const remain = Math.max(0, Math.ceil((t.endAt - now) / 1000));
          const view = remain === 0 ? '**READY**' : `**${fmt(ceil5(remain))}**`;
          const label = TRAITS[active]?.label ?? active;
          lines.push(`**${label}**：${view}`);
        } else {
          const label = TRAITS[active]?.label ?? active;
          lines.push(`**${label}**：**READY**`);
        }
      }
    } else {
      lines.push('特質は未確定です。使用した特質のボタンを押してください。');
    }

    // 裏向きカードの状態
    lines.push(`裏向きカード：**${state.game.backcardUsed ? '使用済' : '未使用'}**`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x00A3FF)
    .setTitle('Identity V 特質CTコントローラ')
    .setDescription(lines.join('\n'))
    .setTimestamp(new Date());

  return embed;
}

/** コンポーネント（初期 or 特質未確定） */
function buildComponentsBeforeTrait() {
  // ゲーム開始後、特質ボタン＋裏向きカードセレクト
  const traitsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn:use:excitement').setLabel('興奮：使用').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn:use:teleport').setLabel('瞬間移動：使用').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn:use:transition').setLabel('移形：使用').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn:use:blink').setLabel('神出鬼没：使用').setStyle(ButtonStyle.Danger)
  );
  const traitsRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn:use:abnormal').setLabel('異常：使用').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn:use:peeper').setLabel('巡視者：使用').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn:use:watcher').setLabel('監視者：使用(-1)').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn:use:listen').setLabel('リッスン：使用').setStyle(ButtonStyle.Secondary)
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId('sel:backcard')
    .setPlaceholder('裏向きカード：変更後の特質を選択')
    .addOptions(
      { label: '興奮', value: 'excitement' },
      { label: '瞬間移動', value: 'teleport' },
      { label: '移形', value: 'transition' },
      { label: '神出鬼没', value: 'blink' },
      { label: '異常', value: 'abnormal' },
      { label: '巡視者', value: 'peeper' },
      { label: '監視者', value: 'watcher' },
      { label: 'リッスン', value: 'listen' }
    );
  const selectRow = new ActionRowBuilder().addComponents(select);
  return [traitsRow, traitsRow2, selectRow];
}

/** コンポーネント（特質確定後：再使用＋裏向きカードのみ） */
function buildComponentsAfterTrait(state) {
  const active = state.game.activeTraitKey;
  const label = active === 'watcher' ? '監視者：使用(-1)' : `${(TRAITS[active]?.label) ?? active}：再使用`;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn:use:${active}`).setLabel(label).setStyle(ButtonStyle.Primary)
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId('sel:backcard')
    .setPlaceholder('裏向きカード：変更後の特質を選択')
    .setDisabled(state.game.backcardUsed)
    .addOptions(
      { label: '興奮', value: 'excitement' },
      { label: '瞬間移動', value: 'teleport' },
      { label: '移形', value: 'transition' },
      { label: '神出鬼没', value: 'blink' },
      { label: '異常', value: 'abnormal' },
      { label: '巡視者', value: 'peeper' },
      { label: '監視者', value: 'watcher' },
      { label: 'リッスン', value: 'listen' }
    );
  const row2 = new ActionRowBuilder().addComponents(select);
  return [row1, row2];
}

/** 初期パネル（ゲーム開始ボタンのみ） */
function buildInitialComponents() {
  const start = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn:start').setLabel('🎮 ゲーム開始').setStyle(ButtonStyle.Success)
  );
  return [start];
}

module.exports = {
  buildEmbed,
  buildComponentsBeforeTrait,
  buildComponentsAfterTrait,
  buildInitialComponents,
  fmt,
  ceil5
};
