require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const appId = process.env.APPLICATION_ID;
const guildId = process.env.GUILD_ID;

if (!token || !appId || !guildId) {
  console.error('DISCORD_TOKEN / APPLICATION_ID / GUILD_ID を設定してください');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    // ここでコマンド定義を直接作る（音声等を一切requireしない）
    const body = [
      new SlashCommandBuilder()
        .setName('setup')
        .setDescription('VCに接続し、このチャンネルにコントロールパネルを設置します')
        .toJSON()
    ];

    console.log('Registering to guild:', guildId);
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log('✅ Successfully registered commands.');
  } catch (e) {
    console.error('❌ Failed to register commands.');
    if (e.rawError) console.error('rawError:', JSON.stringify(e.rawError, null, 2));
    else console.error(e);
    process.exit(1);
  }
})();
