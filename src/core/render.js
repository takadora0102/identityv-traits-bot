// src/core/render.js
// UI組み立て・パネル更新（ランク/マルチ分岐、裏向きカード常時表示（120秒でenable））

const fs = require('fs');
const path = require('path');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require('discord.js');

// ---- キャラクター名解決
const CHARACTER_NAME_MAP = (() => {
  try {
    const file = path.join(__dirname, '../data/characters.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map = new Map();
    for (const c of parsed.survivors || []) map.set(c.id, c.ja);
    for (const c of parsed.hunters || []) map.set(c.id, c.ja);
    return map;
  } catch (err) {
    console.error('Failed to load characters.json', err);
    return new Map();
  }
})();

function characterIdToJa(id) {
  if (!id) return '';
  return CHARACTER_NAME_MAP.get(id) || id;
}

function formatCharacterIds(ids) {
  const names = (ids || []).map(characterIdToJa).filter(Boolean);
  return names.length ? names.join(' / ') : '—';
}

// ---- ユーティリティ
function fmtSec(n) {
  return Math.max(0, Math.ceil(n));
}
function now() { return Date.now(); }

// ---- 固定：裏向きカードの候補（特質キー = 内部キー）
const URAMUKI_OPTIONS = [
  { key: 'kofun',       label: '興奮' },
  { key: 'shunkan',     label: '瞬間移動' },
  { key: 'ikei',        label: '移形' },
  { key: 'shinshutsu',  label: '神出鬼没' },
  { key: 'kanshi',      label: '監視者' },
  { key: 'junshi',      label: '巡視者' },
  { key: 'ijou',        label: '異常' },
  { key: 'listen',      label: 'リッスン' },
];

function buildUramukiRow(state) {
  const enabled = state.matchActive &&
                  !state.usedUramuki &&
                  state.matchStartAt &&
                  now() >= state.matchStartAt + 120000;

  const select = new StringSelectMenuBuilder()
    .setCustomId('uramuki:select')
    .setPlaceholder(enabled ? '裏向きカードで特質を変更' : '裏向きカード（120秒後に利用可）')
    .setDisabled(!enabled)
    .addOptions(
      URAMUKI_OPTIONS.map(o => ({
        label: o.label,
        value: o.key,
        description: `変更後の特質：${o.label}`,
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildVoiceControlRow(state) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('voice:disconnect')
      .setLabel('🔌 VC切断')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!state.voiceChannelId)
  );
}

// ---- ランク/マルチ 入口（/setup直後）
function buildEntryRows(state) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mode:rank')
      .setLabel('ランク（集計あり）')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('mode:multi')
      .setLabel('マルチ（集計なし）')
      .setStyle(ButtonStyle.Secondary),
  ));
  rows.push(buildVoiceControlRow(state));
  return rows.slice(0, 5);
}

function buildEntryEmbed(guildId, state) {
  const desc = state.mode
    ? `**現在モード:** ${state.mode === 'rank' ? 'ランク' : 'マルチ'}`
    : '試合モードを選択してください。';
  return new EmbedBuilder()
    .setColor(0xC863)
    .setTitle('Identity V 特質CTコントローラ')
    .setDescription(desc)
    .setFooter({ text: `guild=${guildId}` })
    .setTimestamp(new Date());
}

// ---- ランクの進捗表示（MAP/BAN/PICK）簡易サマリ
function buildRankProgressEmbed(guildId, state) {
  const lines = [];
  lines.push(`**モード:** ランク`);
  lines.push(`**マップ:** ${state.rank?.mapName ?? '未選択'}`);
  const bansSurv = formatCharacterIds(state.rank?.bansSurv);
  const bansHun  = formatCharacterIds(state.rank?.bansHun);
  lines.push(`**サバBAN (${(state.rank?.bansSurv ?? []).length}/3):** ${bansSurv}`);
  lines.push(`**ハンBAN (${(state.rank?.bansHun ?? []).length}/3):** ${bansHun}`);
  const picksSurv = formatCharacterIds(state.rank?.picksSurv);
  lines.push(`**サバPICK (${(state.rank?.picksSurv ?? []).length}/4):** ${picksSurv}`);

  return new EmbedBuilder()
    .setColor(0xC863)
    .setTitle('Identity V 特質CTコントローラ')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `guild=${guildId}` })
    .setTimestamp(new Date());
}

function buildRankRows(state) {
  // ランク入力の段階的UI
  const rows = [];
  const r = state.rank || {};
  // 段階：map -> bans -> picks -> ready
  if (!r.mapName) {
    // マップ選択用セレクト
    const maps = [
      '軍需工場','聖心病院','赤の教会','湖景村','月の河公園','レオの思い出','永眠町','中華街','罪の森'
    ];
    const sel = new StringSelectMenuBuilder()
      .setCustomId('rank:map:select')
      .setPlaceholder('マップを選択')
      .addOptions(maps.map(m => ({ label: m, value: m })));
    rows.push(new ActionRowBuilder().addComponents(sel));
  } else if ((r.bansSurv?.length ?? 0) < 3 || (r.bansHun?.length ?? 0) < 3) {
    // BAN 追加/取り消し/次へ
    const bansSurvLen = r.bansSurv?.length ?? 0;
    const bansHunLen = r.bansHun?.length ?? 0;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rank:ban:add:surv')
          .setLabel('サバBANを追加')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(bansSurvLen >= 3),
        new ButtonBuilder()
          .setCustomId('rank:ban:add:hunter')
          .setLabel('ハンBANを追加')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(bansHunLen >= 3),
      ),
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rank:ban:undo:surv')
          .setLabel('サバBAN 最後を取り消し')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(bansSurvLen === 0),
        new ButtonBuilder()
          .setCustomId('rank:ban:undo:hunter')
          .setLabel('ハンBAN 最後を取り消し')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(bansHunLen === 0),
        new ButtonBuilder()
          .setCustomId('rank:next:picks')
          .setLabel('次へ（PICK）')
          .setStyle(ButtonStyle.Success)
          .setDisabled(bansSurvLen < 3 || bansHunLen < 3),
      ),
    );
  } else if ((r.picksSurv?.length ?? 0) < 4) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rank:pick:add:surv').setLabel('サバPICKを追加').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rank:pick:undo:surv').setLabel('サバPICK 最後を取り消し').setStyle(ButtonStyle.Danger),
      ),
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('game:start')
          .setLabel('▶ 試合開始')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!((r.picksSurv?.length ?? 0) === 4)),
      ),
    );
  } else {
    // すべて埋まった → 試合開始可
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('game:start')
          .setLabel('▶ 試合開始')
          .setStyle(ButtonStyle.Success),
      ),
    );
  }
  rows.push(buildVoiceControlRow(state));
  return rows.slice(0, 5);
}

// ---- マルチ（従来どおり開始ボタン）
function buildMultiRows(state) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('game:start')
        .setLabel('▶ 試合開始')
        .setStyle(ButtonStyle.Success),
    ),
  ];
  rows.push(buildVoiceControlRow(state));
  return rows.slice(0, 5);
}

// ---- 試合中UI（制御 + 裏向き + 特質操作は既存ボタン群を統合している想定）
function buildInGameEmbed(guildId, state) {
  const lines = [];
  lines.push('**ステータス:** 試合中');
  if (!state.revealedKey) {
    lines.push('・特質が判明していません。特質ボタンで判明を記録できます。');
  } else {
    lines.push(`・判明特質: ${state.revealedLabel ?? state.revealedKey}`);
  }
  return new EmbedBuilder()
    .setColor(0xC863)
    .setTitle('Identity V 特質CTコントローラ')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `guild=${guildId}` })
    .setTimestamp(new Date());
}

function buildInGameRows(state) {
  const rows = [];

  // 上段：試合終了 / 次の試合開始
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('game:end').setLabel('🛑 試合終了').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('game:next').setLabel('▶ 次の試合開始').setStyle(ButtonStyle.Secondary),
  ));

  // 中段：特質操作ボタン（2行に分けて配置）
  const traitButtons = URAMUKI_OPTIONS.map(o =>
    new ButtonBuilder()
      .setCustomId(`trait:used:${o.key}`)
      .setLabel(o.label)
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(new ActionRowBuilder().addComponents(...traitButtons.slice(0, 4)));
  rows.push(new ActionRowBuilder().addComponents(...traitButtons.slice(4, 8)));

  // 下段：裏向きカード（常時表示、120sでenable）
  rows.push(buildUramukiRow(state));

  rows.push(buildVoiceControlRow(state));

  return rows.slice(0, 5);
}

// ---- メイン：状態に応じた描画
function composePayload(guildId, state) {
  if (!state.matchActive) {
    if (state.mode === 'rank') {
      return {
        embeds: [buildRankProgressEmbed(guildId, state)],
        components: buildRankRows(state),
      };
    }
    if (state.mode === 'multi') {
      return {
        embeds: [buildEntryEmbed(guildId, state)],
        components: buildMultiRows(state),
      };
    }
    // モード未選択
    return {
      embeds: [buildEntryEmbed(guildId, state)],
      components: buildEntryRows(state),
    };
  }

  // 試合中
  return {
    embeds: [buildInGameEmbed(guildId, state)],
    components: buildInGameRows(state),
  };
}

// ---- パネル更新
async function updatePanel(client, state, interaction) {
  const payload = composePayload(state.guildId, state);

  // interaction 経由の更新が安全
  if (interaction && interaction.isRepliable()) {
    try {
      await interaction.update(payload);
      return;
    } catch (e) {
      // 失敗したら下のメッセージ編集へフォールバック
    }
  }

  // 既存メッセージの編集
  if (client && state.panelChannelId && state.panelMessageId) {
    try {
      const ch = client.channels.cache.get(state.panelChannelId);
      if (!ch) return;
      const msg = await ch.messages.fetch(state.panelMessageId);
      await msg.edit(payload);
    } catch (e) {
      console.error('[render] updatePanel edit error', e);
    }
  }
}

module.exports = {
  updatePanel,
  buildUramukiRow,
  buildVoiceControlRow,
  composePayload, // デバッグ用途
};
