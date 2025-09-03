const { SlashCommandBuilder } = require('discord.js');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInitialComponents } = require('../core/render');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('VCに接続し、このチャンネルにコントロールパネルを設置します')
    .setDMPermission(false),

  async execute(interaction) {
    // ← ここで必要になったタイミングで読み込む（登録時には読み込まれない）
    const { connectVoice } = require('../voice/player');

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'ギルド内で使用してください。', ephemeral: true });

    const member = await guild.members.fetch(interaction.user.id);
    const vc = member.voice?.channel;
    if (!vc) return interaction.reply({ content: '先にVCへ接続してください。', ephemeral: true });

    const state = getGuildState(guild.id);
    await connectVoice(guild, vc.id, state);
    state.voiceChannelId = vc.id;

    resetGameState(state);

    const embed = buildEmbed(state);
    const components = buildInitialComponents();
    const msg = await interaction.channel.send({ embeds: [embed], components });

    state.panelChannelId = interaction.channel.id;
    state.panelMessageId = msg.id;

    return interaction.reply({ content: `✅ VC（${vc.name}）へ接続し、コントロールパネルを設置しました。`, ephemeral: true });
  }
};
