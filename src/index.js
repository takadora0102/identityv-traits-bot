// src/index.js
require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const setupCmd = require('./commands/setup');
const buttonHandler = require('./interactions/buttons');
const { startScheduler } = require('./core/scheduler');

// HTTP server (Render)
const app = express();
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));
app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP server listening on :${PORT}`));

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startScheduler(client); // no-op (互換)
});

// /setup と すべての UI（ボタン/セレクト/モーダル）を buttons ハンドラへ
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        return setupCmd.execute(interaction);
      }
    } else if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      return buttonHandler.handle(interaction, client);
    }
  } catch (e) {
    console.error('Interaction error:', e);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'エラーが発生しました。', flags: 64 });
      }
    } catch {}
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN が設定されていません。環境変数を確認してください。');
  process.exit(1);
}
client.login(token);

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
