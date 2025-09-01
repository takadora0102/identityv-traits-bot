const { buildEmbed } = require('./render');

/** 5秒境界で次のtick時刻を返す */
function nextTickAt(ms) {
  const step = 5000;
  return Math.ceil(ms / step) * step;
}

async function updatePanelForGuild(client, guildId, state) {
  if (!state.panelChannelId || !state.panelMessageId) return;
  try {
    const ch = await client.channels.fetch(state.panelChannelId);
    if (!ch) return;
    const msg = await ch.messages.fetch(state.panelMessageId);
    if (!msg) return;
    const embed = buildEmbed(state);
    await msg.edit({ embeds: [embed] }); // コンポーネントは状態変化時のみ更新
  } catch (e) {
    console.warn(`[scheduler] updatePanel failed: ${e.message}`);
  }
}

/** 5秒境界スケジューラ開始 */
function startScheduler(client, guildStates) {
  const loop = async () => {
    const now = Date.now();
    const due = nextTickAt(now);
    const wait = Math.max(0, due - now);

    setTimeout(async () => {
      // 全ギルドを巡回して埋め込み更新
      for (const [gid, state] of guildStates.entries()) {
        await updatePanelForGuild(client, gid, state);
      }
      loop();
    }, wait);
  };
  loop();
}

module.exports = { startScheduler };
