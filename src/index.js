// src/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Entry point: HTTP (health check) + Discord client bootstrap + interaction routing
// - Health check endpoint for Render (/healthz)
// - Routes ALL buttons & select menus to interactions/buttons.js (client を渡す)
// - /setup は commands/setup.js
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const setupCmd = require('./commands/setup');
const buttonHandler = require('./interactions/buttons'); // ボタン＆セレクトはここで一括処理
const { startScheduler } = require('./core/scheduler');   // 互換用 no-op

// ── HTTP server (Render のヘルスチェック用)
const app = express();

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) =>
  res.status(200).json({ ok: true, uptime: process.uptime() })
);
app.get('/favicon.ico', (_req, res) => res.sendStatus(204));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP server listening on :${PORT}`));

// ── Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  // 互換：旧実装の名残（現在は no-op）
  startScheduler(client);
});

// Slash Command: /setup
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        return setupCmd.execute(interaction);
      }
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      // ★ ボタン＆セレクトは一か所へ集約。client を必ず渡す
      return buttonHandler.handle(interaction, client);
    }
  } catch (e) {
    console.error('Interaction error:', e);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'エラーが発生しました。', flags: 64 /* MessageFlags.Ephemeral */ });
      }
    } catch {}
  }
});

// ── 起動
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN が設定されていません。環境変数を確認してください。');
  process.exit(1);
}

client.login(token);

// ── プロセス例外のログ（Render デバッグ用）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
