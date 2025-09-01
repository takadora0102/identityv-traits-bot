require('dotenv').config();
const { REST, Routes } = require('discord.js');
const setup = require('./commands/setup');

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
    console.log('Refreshing application (guild) commands...');
    const cmds = [setup.data.toJSON()];
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: cmds });
    console.log('✅ Successfully registered commands.');
  } catch (e) {
    console.error('Failed to register commands:', e);
    process.exit(1);
  }
})();
