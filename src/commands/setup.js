// src/commands/setup.js
const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { connectVoice, enqueueTokens } = require('../voice/player');
const { getGuildState } = require('../core/state');
const { composePayload } = require('../core/render');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('VCに接続し、このチャンネルにコントロールパネルを設置します')
    .setDMPermission(false),

  /**
   * /setup 実行時:
   * - 実行者が参加しているVCへ接続
   * - 直後に「ボイスチャンネルに接続しました」をアナウンス
   * - このメッセージチャンネルにコントロールパネルを送信
   */
  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'サーバー内で実行してください。', flags: MessageFlags.Ephemeral });
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const vc = member?.voice?.channel;

    if (!vc || vc.type !== ChannelType.GuildVoice) {
      return interaction.reply({
        content: '先にボイスチャンネルへ参加してから /setup を実行してください。',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // VC 接続
    await connectVoice(guild, vc.id);

    // ギルド状態を更新
    const state = getGuildState(guild.id);
    state.voiceChannelId = vc.id;
    state.panelChannelId = interaction.channel.id;

    // VC接続アナウンス（「ボイスチャンネルに接続しました」）
    enqueueTokens(guild.id, ['vc_setsuzoku']);

    // コントロールパネルを送信（初期は「▶ 試合開始」＋ マッチコントロール）
    const payload = composePayload(state.guildId, { ...state, matchActive: false });
    const sent = await interaction.channel.send(payload);

    state.panelMessageId = sent.id;

    return interaction.editReply({ content: 'コントロールパネルを設置しました。' });
  },
};
