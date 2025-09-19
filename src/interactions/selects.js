const { getGuildState, cancelAllAnnouncements } = require('../core/state');
const { TRAITS } = require('../core/constants');
const { convertRemainSec, watcherFromRemain } = require('../core/convert');
const { composePayload } = require('../core/render');
const { sayRemain, sayReady } = require('../voice/player');

module.exports = {
  /** @param {import('discord.js').StringSelectMenuInteraction} interaction */
  async handle(interaction) {
    const [prefix, kind] = interaction.customId.split(':');
    if (prefix !== 'sel' || kind !== 'backcard') return;

    const guild = interaction.guild;
    const state = getGuildState(guild.id);

    if (!state.game.startedAt) {
      return interaction.reply({ content: '先に「ゲーム開始」を押してください。', ephemeral: true });
    }
    if (state.game.backcardUsed) {
      return interaction.reply({ content: '裏向きカードは既に使用済みです。', ephemeral: true });
    }
    if (!state.game.activeTraitKey) {
      return interaction.reply({ content: 'まずは特質を1回使用し、確定させてください。', ephemeral: true });
    }

    const newKey = interaction.values[0];
    const oldKey = state.game.activeTraitKey;
    if (newKey === oldKey) {
      return interaction.reply({ content: '同じ特質へは変更できません。', ephemeral: true });
    }

    // 旧特質の残りCTを取得（監視者はゲージ換算）
    const now = Date.now();
    let oldRemainSec = 0;
    if (oldKey === 'watcher') {
      // フル3個（90s）までの残り（nextChargeAtと所持から概算）
      // 単純化：ゲージ残 = 30*(3 - stacks) - (経過%30)
      // 近似として、次のチャージまでx、所持n → 残 = 30*(3-n-1) + x
      const n = state.watcher.stacks ?? 0;
      const x = state.watcher.nextChargeAt ? Math.max(0, Math.ceil((state.watcher.nextChargeAt - now) / 1000)) : 0;
      oldRemainSec = Math.max(0, 30 * Math.max(0, (3 - n - 1)) + x);
    } else {
      const t = state.traits[oldKey];
      oldRemainSec = t?.endAt ? Math.max(0, Math.ceil((t.endAt - now) / 1000)) : 0;
    }

    // 比例換算
    const newRemain = convertRemainSec(oldKey, newKey, oldRemainSec);

    // 状態切替：旧のアナウンスをキャンセル
    cancelAllAnnouncements(state, oldKey);

    // 新特質へ置換
    state.game.activeTraitKey = newKey;
    if (newKey === 'watcher') {
      const { stacks, nextChargeSec } = watcherFromRemain(newRemain);
      state.watcher.stacks = stacks;
      state.watcher.nextChargeAt = nextChargeSec > 0 ? now + nextChargeSec * 1000 : null;
      // 音声は回復イベントのみ（直ちに予約は不要）
    } else {
      const endAt = now + newRemain * 1000;
      state.traits[newKey] = { running: newRemain > 0, endAt, lastStartAt: now };
      // 新特質のアナウンスを（残りに応じて）再予約
      const pts = [];
      if (newKey === 'blink') pts.push(60);
      [30, 10, 5].forEach(p => pts.push(p));
      pts.forEach(p => {
        if (newRemain > p) {
          const waitMs = (newRemain - p) * 1000;
          // guard against negative delay
          const delay = Math.max(0, Math.ceil(waitMs));
          setTimeout(() => sayRemain(state, newKey, p), delay);
        }
      });
      const readyMs = newRemain * 1000;
      // guard against negative delay
      const readyDelay = Math.max(0, Math.ceil(readyMs));
      setTimeout(() => sayReady(state, newKey), readyDelay);
    }

    // 裏向きカードは一度で消費
    state.game.backcardUsed = true;

    // パネル更新（コンポーネントは再使用＋裏向きカード（disabled））
    try {
      const ch = await interaction.client.channels.fetch(state.panelChannelId);
      const msg = await ch.messages.fetch(state.panelMessageId);
      const payload = composePayload(state.guildId, state);
      await msg.edit(payload);
    } catch (e) {
      console.warn('panel edit (backcard) failed:', e.message);
    }

    return interaction.reply({ content: `🔁 裏向きカードで **${TRAITS[oldKey].label} → ${TRAITS[newKey].label}** に変更しました。`, ephemeral: true });
  }
};
