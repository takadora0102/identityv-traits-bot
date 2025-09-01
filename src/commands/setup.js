const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildState, resetGameState } = require('../core/state');
const { buildEmbed, buildInitialComponents } = require('../core/render');
const { connectVoice } = require('../voice/player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('VCに接続し、このチャンネルにコントロールパネルを設置します')
    .setDMPermission(false),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'ギルド内で使用してください。', ephemeral: true });

    const member = await guild.members.fetch(interaction.user.id);
    const vc = member.voice?.channel;
    if (!vc) {
      return interaction.reply({ content: '先にVCへ接続してください。', ephemeral: true });
    }

    const state = getGuildState(guild.id);
    // VC接続
    await connectVoice(guild, vc.id, state);
    state.voiceChannelId = vc.id;

    // 試合状態リセット
    resetGameState(state);

    // パネルを送信
    const embed = buildEmbed(state);
    const components = buildInitialComponents();
    const msg = await interaction.channel.send({ embeds: [embed], components });

    state.panelChannelId = interaction.channel.id;
    state.panelMessageId = msg.id;

    return interaction.reply({ content: `✅ VC（${vc.name}）へ接続し、コントロールパネルを設置しました。`, ephemeral: true });
  }
};
