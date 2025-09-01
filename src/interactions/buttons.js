const { TRAITS, INITIAL_NOTIFY_TRAITS, BACKCARD_UNLOCK_SEC } = require('../core/constants');
const { getGuildState, cancelAllAnnouncements, clearWatcherTimers } = require('../core/state');
const { buildEmbed, buildComponentsBeforeTrait, buildComponentsAfterTrait } = require('../core/render');
const { sayReady, sayRemain, sayBackcardReady, sayWatcherEvent } = require('../voice/player');

/** アナウンス予約を登録（キャンセルはstate側に記録） */
function scheduleAnnouncements(state, traitKey, endAtMs) {
  cancelAllAnnouncements(state, traitKey);
  const now = Date.now();
  const points = [];

  // 特質ごとの時点
  const afterCT = TRAITS[traitKey]?.afterCT ?? null;
  if (traitKey === 'blink') { // 神出鬼没はT-60を追加
    points.push(60);
  }
  // 既定：T-30/T-10/T-5/T=0（短いCTは不足分を自動スキップ）
  [30, 10, 5].forEach(p => points.push(p));
  // 実際の残りを見て、未来にあるものだけ予約
  const remainNow = Math.max(0, Math.ceil((endAtMs - now) / 1000));
  const timers = [];
  for (const p of points) {
    if (remainNow > p) {
      const t = setTimeout(() => {
        sayRemain(state, traitKey, p);
      }, (remainNow - p) * 1000);
      timers.push(t);
    }
  }
  // READY
  const tReady = setTimeout(() => {
    sayReady(state, traitKey);
  }, remainNow * 1000);
  timers.push(tReady);

  state.announceTimers[traitKey] = timers;
}

/** 監視者のチャージスケジューリングを開始（ゲーム開始時点からの進行を前提） */
function scheduleWatcherCharges(state) {
  clearWatcherTimers(state);
  const timers = [];
  const now = Date.now();
  const start = state.game.startedAt;
  if (!start) return;

  // 10sで1個、以後30sごと、最大3
  const milestones = [10, 40, 70]; // 相対秒（= 10, 10+30, 10+30+30）
  let nextIdx = 0;

  // 既に経過している分を反映
  state.watcher.stacks = 0;
  for (const s of milestones) {
    if (now >= start + s * 1000) {
      state.watcher.stacks++;
    }
  }
  if (state.watcher.stacks > 3) state.watcher.stacks = 3;

  // 次の未到達マイルストーンを予約
  for (let i = 0; i < milestones.length; i++) {
    const absMs = start + milestones[i] * 1000;
    if (absMs > now) {
      // T-10案内
      const tMinus10 = setTimeout(() => {
        if (state.watcher.stacks + (i - nextIdx) < 3) {
          // 次チャージのT-10
          sayRemain(state, 'watcher', 10);
        }
      }, (absMs - now - 10 * 1000));
      timers.push(tMinus10);

      const t = setTimeout(() => {
        state.watcher.stacks = Math.min(3, state.watcher.stacks + 1);
        // 回復イベント
        if (state.watcher.stacks === 1) sayWatcherEvent(state, 'charge1');
        else if (state.watcher.stacks === 2) sayWatcherEvent(state, 'charge2');
        else if (state.watcher.stacks === 3) sayWatcherEvent(state, 'full');

        // 次のチャージ時刻
        const nextAbs = milestones[i + 1] ? start + milestones[i + 1] * 1000 : null;
        state.watcher.nextChargeAt = nextAbs;
      }, absMs - now);
      timers.push(t);
    }
  }

  // nextChargeAt の初期化
  const nextMilestone = milestones.find(s => start + s * 1000 > now);
  state.watcher.nextChargeAt = nextMilestone ? start + nextMilestone * 1000 : null;

  state.watcher.chargeTimers = timers;
}

/** ボタンハンドラ本体 */
module.exports = {
  /** @param {import('discord.js').ButtonInteraction} interaction */
  async handle(interaction) {
    const [prefix, kind, arg] = interaction.customId.split(':');
    if (prefix !== 'btn') return;

    const guild = interaction.guild;
    const state = getGuildState(guild.id);

    if (kind === 'start') {
      if (state.game.startedAt) {
        return interaction.reply({ content: 'すでにゲーム開始済みです。', ephemeral: true });
      }
      state.game.startedAt = Date.now();
      state.game.backcardUsed = false;
      state.game.activeTraitKey = null;
      state.traits = {};

      // 初期通知：興奮/瞬間移動/移形/神出鬼没 READY、裏向きカード READY(120s)
      const startAt = state.game.startedAt;
      const initialTimers = [];
      for (const k of INITIAL_NOTIFY_TRAITS) {
        const sec = TRAITS[k].startCT;
        const t = setTimeout(() => sayReady(state, k), sec * 1000);
        initialTimers.push(t);
      }
      const tBack = setTimeout(() => sayBackcardReady(state), BACKCARD_UNLOCK_SEC * 1000);
      initialTimers.push(tBack);
      state.announceTimers['__initial__'] = initialTimers;

      // 監視者チャージスケジュール開始（常に進行）
      scheduleWatcherCharges(state);

      // パネルを書き換え：特質ボタン＆裏向きカード表示
      const channel = await interaction.client.channels.fetch(state.panelChannelId);
      const msg = await channel.messages.fetch(state.panelMessageId);
      const embed = buildEmbed(state);
      const components = buildComponentsBeforeTrait();
      await msg.edit({ embeds: [embed], components });

      return interaction.reply({ content: '🟢 ゲームを開始しました。', ephemeral: true });
    }

    if (kind === 'use') {
      const traitKey = arg;
      const def = TRAITS[traitKey];
      if (!def) return interaction.reply({ content: '不明な特質です。', ephemeral: true });

      // アクティブ特質の整合性（裏向き未使用で別特質を押したら警告）
      if (state.game.activeTraitKey && state.game.activeTraitKey !== traitKey && !state.game.backcardUsed) {
        return interaction.reply({ content: '既に別の特質が確定しています。裏向きカードで変更してください。', ephemeral: true });
      }

      // アクティブ化
      state.game.activeTraitKey = traitKey;

      const now = Date.now();

      if (traitKey === 'watcher') {
        // 監視者は -1 使用（所持がなければ警告）
        if ((state.watcher.stacks ?? 0) <= 0) {
          return interaction.reply({ content: '監視者の所持がありません。（次のチャージを待ってください）', ephemeral: true });
        }
        state.watcher.stacks = Math.max(0, state.watcher.stacks - 1);
        // 減った分に応じて nextChargeAt を調整（チャージスケジュールはゲーム開始基準なのでそのまま）
        // パネルを「再使用＋裏向きカード」のUIに更新
      } else if (def.afterCT) {
        const endAt = now + def.afterCT * 1000;
        state.traits[traitKey] = { running: true, endAt, lastStartAt: now };
        // アナウンス再予約
        scheduleAnnouncements(state, traitKey, endAt);
      } else {
        // afterCTなし（リッスンなど）はREADY扱い（通知はT-10/T-5/T0程度にする場合は別途）
        state.traits[traitKey] = { running: false, endAt: now };
      }

      // パネル：特質確定後のUIへ
      try {
        const ch = await interaction.client.channels.fetch(state.panelChannelId);
        const msg = await ch.messages.fetch(state.panelMessageId);
        const embed = buildEmbed(state);
        const components = buildComponentsAfterTrait(state);
        await msg.edit({ embeds: [embed], components });
      } catch (e) {
        console.warn('panel edit failed:', e.message);
      }

      return interaction.reply({ content: `⏱️ ${def.label} を記録しました。`, ephemeral: true });
    }
  }
};
