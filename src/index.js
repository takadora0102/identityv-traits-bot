require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { getGuildState } = require('./core/state');
const { startScheduler } = require('./core/scheduler');
const setupCmd = require('./commands/setup');
const buttonHandler = require('./interactions/buttons');
const selectHandler = require('./interactions/selects');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

const { generateDependencyReport } = require('@discordjs/voice');
console.log(generateDependencyReport());

if (!TOKEN) {
  console.error('DISCORD_TOKEN が未設定です。');
  process.exit(1);
}

// --- Express (健康監視用) ---
const app = express();
app.get('/healthz', (_, res) => res.status(200).send('ok'));
app.get('/', (_, res) => res.status(200).send('IdentityV Traits Bot'));
app.listen(PORT, () => console.log(`HTTP server listening on :${PORT}`));

// --- Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}`);
  // 5秒境界スケジューラ開始
  // stateは内部Mapにあるので、clientからは参照できないが、schedulerにMapを渡す
  const { guildStates } = require('./_state_accessor');
  startScheduler(client, guildStates);
});

// コマンド
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        return setupCmd.execute(interaction);
      }
    } else if (interaction.isButton()) {
      return buttonHandler.handle(interaction);
    } else if (interaction.isStringSelectMenu()) {
      return selectHandler.handle(interaction);
    }
  } catch (e) {
    console.error('Interaction error:', e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true }); } catch {}
    }
  }
});

client.login(TOKEN);

// --- 内部StateのMap共有ハック（scheduler用） ---
const { getGuildState: _g } = require('./core/state');
const _guildStates = new Map();
// getGuildState をラップしてMapを同期
const originalGet = _g;
require.cache[require.resolve('./core/state')].exports.getGuildState = function (gid) {
  const s = originalGet(gid);
  _guildStates.set(gid, s);
  return s;
};
// 他モジュールから参照できるように
require('fs'); // dummy
