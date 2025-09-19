// src/interactions/rank.js
// ランクの段階入力（MAP -> BAN -> PICK -> 試合開始）
// - 検索 → 候補セレクト（最大25件）→ 現在値更新
// - 取り消しは「最後のみ」
// - DB保存は /game:start や /game:end 時点で buttons.js 側から呼ぶ設計にできます

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const { updatePanel } = require('../core/render');
const { updateMatch } = require('../db');
const { search } = require('../utils/search');

function ensureRank(state) {
  state.rank ||= { mapName: null, bansSurv: [], bansHun: [], picksSurv: [], pickHunter: null, matchId: null };
  return state.rank;
}

async function persistRankPatch(state, patch, context = 'rank') {
  const matchId = state?.rank?.matchId;
  if (!matchId) return;

  const sanitized = {};
  for (const [key, value] of Object.entries(patch || {})) {
    sanitized[key] = Array.isArray(value) ? [...value] : value;
  }

  if (!Object.keys(sanitized).length) return;

  try {
    await updateMatch(matchId, sanitized);
  } catch (err) {
    console.error(`[rank] failed to persist match update (${context})`, err);
  }
}

async function route(interaction, client, state) {
  ensureRank(state);

  // マップ選択
  if (interaction.isStringSelectMenu() && interaction.customId === 'rank:map:select') {
    const v = interaction.values?.[0];
    state.rank.mapName = v || null;
    const persistPromise = persistRankPatch(state, { map: state.rank.mapName }, 'map');
    await updatePanel(client, state, interaction);
    await persistPromise;
    return true;
  }

  // 次へ（PICKへ）
  if (interaction.isButton() && interaction.customId === 'rank:next:picks') {
    await updatePanel(client, state, interaction);
    return true;
  }

  // BAN 追加（サバ/ハン）
  if (interaction.isButton() && interaction.customId === 'rank:ban:add:surv') {
    return openSearchModal(interaction, 'modal:rank:ban:surv:query', 'サバBAN 検索');
  }
  if (interaction.isButton() && interaction.customId === 'rank:ban:add:hunter') {
    return openSearchModal(interaction, 'modal:rank:ban:hunter:query', 'ハンBAN 検索');
  }

  // BAN 取り消し
  if (interaction.isButton() && interaction.customId === 'rank:ban:undo:surv') {
    state.rank.bansSurv.pop();
    const persistPromise = persistRankPatch(state, { bans_surv: state.rank.bansSurv }, 'ban:undo:surv');
    await updatePanel(client, state, interaction);
    await persistPromise;
    return true;
  }
  if (interaction.isButton() && interaction.customId === 'rank:ban:undo:hunter') {
    state.rank.bansHun.pop();
    const persistPromise = persistRankPatch(state, { bans_hunter: state.rank.bansHun }, 'ban:undo:hunter');
    await updatePanel(client, state, interaction);
    await persistPromise;
    return true;
  }

  // PICK 追加（サバ）
  if (interaction.isButton() && interaction.customId === 'rank:pick:add:surv') {
    return openSearchModal(interaction, 'modal:rank:pick:surv:query', 'サバPICK 検索');
  }
  if (interaction.isButton() && interaction.customId === 'rank:pick:undo:surv') {
    state.rank.picksSurv.pop();
    const persistPromise = persistRankPatch(state, { picks_surv: state.rank.picksSurv }, 'pick:undo:surv');
    await updatePanel(client, state, interaction);
    await persistPromise;
    return true;
  }

  // モーダル（検索語入力）→ 候補セレクト（エフェメラル）
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;

    if (id === 'modal:rank:ban:surv:query') {
      const q = interaction.fields.getTextInputValue('rank:query');
      return respondCandidates(
        interaction,
        state,
        'survivor',
        q,
        3 - state.rank.bansSurv.length,
        'select:rank:ban:surv',
      );
    }
    if (id === 'modal:rank:ban:hunter:query') {
      const q = interaction.fields.getTextInputValue('rank:query');
      return respondCandidates(
        interaction,
        state,
        'hunter',
        q,
        3 - state.rank.bansHun.length,
        'select:rank:ban:hunter',
      );
    }
    if (id === 'modal:rank:pick:surv:query') {
      const q = interaction.fields.getTextInputValue('rank:query');
      return respondCandidates(
        interaction,
        state,
        'survivor',
        q,
        4 - state.rank.picksSurv.length,
        'select:rank:pick:surv',
      );
    }
  }

  // 候補セレクト（エフェメラル返信）→ 選択分を反映
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id === 'select:rank:ban:surv') {
      const ids = interaction.values || [];
      let updated = false;
      for (const v of ids) {
        if (!state.rank.bansSurv.includes(v)) {
          state.rank.bansSurv.push(v);
          updated = true;
        }
      }
      try {
        await interaction.update({ components: [] });
      } catch (err) {
        console.error('[rank] failed to update interaction (ban:surv)', err);
      }
      const persistPromise = updated
        ? persistRankPatch(state, { bans_surv: state.rank.bansSurv }, 'ban:add:surv')
        : Promise.resolve();
      await Promise.all([
        persistPromise,
        updatePanel(client, state),
      ]);
      return true;
    }
    if (id === 'select:rank:ban:hunter') {
      const ids = interaction.values || [];
      let updated = false;
      for (const v of ids) {
        if (!state.rank.bansHun.includes(v)) {
          state.rank.bansHun.push(v);
          updated = true;
        }
      }
      try {
        await interaction.update({ components: [] });
      } catch (err) {
        console.error('[rank] failed to update interaction (ban:hunter)', err);
      }
      const persistPromise = updated
        ? persistRankPatch(state, { bans_hunter: state.rank.bansHun }, 'ban:add:hunter')
        : Promise.resolve();
      await Promise.all([
        persistPromise,
        updatePanel(client, state),
      ]);
      return true;
    }
    if (id === 'select:rank:pick:surv') {
      const ids = interaction.values || [];
      let updated = false;
      for (const v of ids) {
        if (!state.rank.picksSurv.includes(v)) {
          state.rank.picksSurv.push(v);
          updated = true;
        }
      }
      try {
        await interaction.update({ components: [] });
      } catch (err) {
        console.error('[rank] failed to update interaction (pick:surv)', err);
      }
      const persistPromise = updated
        ? persistRankPatch(state, { picks_surv: state.rank.picksSurv }, 'pick:add:surv')
        : Promise.resolve();
      await Promise.all([
        persistPromise,
        updatePanel(client, state),
      ]);
      return true;
    }
  }

  return false; // 未処理
}

// ---- モーダル（検索語入力）
async function openSearchModal(interaction, customId, title) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  const input = new TextInputBuilder()
    .setCustomId('rank:query')
    .setLabel('キャラ名の一部（かな/漢字/ローマ字）')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
  return true;
}

// ---- 候補をエフェメラルのセレクトで提示（最大25件 / 残り枠 = maxValues）
async function respondCandidates(interaction, state, role, query, maxValues, selectId) {
  if (maxValues <= 0) {
    await interaction.reply({ content: '枠は埋まっています。', components: [], flags: MessageFlags.Ephemeral });
    return true;
  }

  const trimmedQuery = (query ?? '').trim();
  const isBanSelect = selectId.startsWith('select:rank:ban:');
  const shouldOfferNone = isBanSelect && trimmedQuery === '';
  const tokens = trimmedQuery
    .split(/[、，､,]/)
    .map(token => token.trim())
    .filter(token => token.length > 0);

  // 既存選択を除外
  const exclude = new Set([
    ...(state.rank.bansSurv || []),
    ...(state.rank.bansHun || []),
    ...(state.rank.picksSurv || []),
    state.rank.pickHunter || undefined,
  ].filter(Boolean));

  const limit = shouldOfferNone ? 24 : 25;
  let list;

  if (tokens.length <= 1) {
    const token = tokens[0] ?? trimmedQuery;
    list = search(role, token, limit, exclude);
  } else {
    const aggregated = [];
    const seen = new Set();

    for (const token of tokens) {
      const results = search(role, token, limit, exclude);
      for (const candidate of results) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        aggregated.push(candidate);
        if (aggregated.length >= limit) break;
      }
      if (aggregated.length >= limit) break;
    }

    list = aggregated;
  }
  const options = list.map(x => ({ label: x.ja, value: x.id, description: x.kana ?? undefined }));

  if (shouldOfferNone) {
    const isSurvivorBan = selectId === 'select:rank:ban:surv';
    const noneValue = isSurvivorBan ? 'ban:none:survivor' : 'ban:none:hunter';
    if (!exclude.has(noneValue)) {
      options.unshift({
        label: 'none',
        value: noneValue,
        description: isSurvivorBan ? 'BAN指示なし（サバイバー）' : 'BAN指示なし（ハンター）',
      });
    }
  }

  if (!options.length) {
    await interaction.reply({
      content: '候補が見つかりませんでした。検索語を変えて再試行してください。',
      components: [],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const sel = new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder('候補から選択（複数可）')
    .setMinValues(1)
    .setMaxValues(Math.min(maxValues, options.length))
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(sel);
  await interaction.reply({
    content: '候補から選択してください。',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

module.exports = { route };
