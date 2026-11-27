const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { syncApplicationEmojisFromFiles } = require("../../utils/applicationEmojis");
const { isBotOwner } = require("../../utils/commandAccess");
const { THEME } = require("../../utils/theme");

module.exports = {
  name: "syncemojis",
  aliases: ["syncemoji", "redemojis", "uploademojis"],
  description: "Sync red-theme animated application emojis from assets/emojis files.",
  category: "Owner",
  args: false,
  usage: "[force] [cleanup]",
  userPerms: [],
  owner: true,
  cooldown: 10,
  slashOptions: [
    {
      name: "mode",
      description: "Optional sync mode: 'force' to recreate all, 'cleanup' to remove old purple emojis",
      type: 3,
      required: false,
    },
  ],

  async slashExecute(interaction, client) {
    if (!isBotOwner(client, interaction.user.id)) {
      return interaction.reply({ content: "Only the bot owners can sync application emojis.", flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch(() => {});
    const mode = (interaction.options?.getString("mode") || "").toLowerCase().trim();
    const args = mode ? mode.split(/\s+/) : [];
    const wrapper = {
      guild: interaction.guild,
      channel: interaction.channel,
      author: interaction.user,
      member: interaction.member,
      createdTimestamp: interaction.createdTimestamp,
      reply: (options) =>
        interaction.deferred || interaction.replied
          ? interaction.editReply(options)
          : interaction.reply(options),
    };
    return this.execute(wrapper, args, client);
  },

  async execute(message, args, client) {
    if (!isBotOwner(client, message.author.id)) {
      return message.reply({ content: "Only the bot owners can sync application emojis." });
    }
    const flags = new Set((args || []).map((a) => String(a).toLowerCase()));
    const force = flags.has("force");
    const cleanupLegacy = flags.has("cleanup");

    const loadingContainer = new ContainerBuilder()
      .setAccentColor(THEME.accent)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${client.emoji?.loading || "🔴"} Syncing Red Animated Emojis\n-# Reading from \`assets/emojis/manifest.json\`...`
        )
      );

    const statusMsg = await message.reply({
      components: [loadingContainer],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      const stats = await syncApplicationEmojisFromFiles(client, { force, cleanupLegacy });
      const resultContainer = new ContainerBuilder()
        .setAccentColor(THEME.accent)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${client.emoji?.check || "⭕"} Red Animated Emojis Synced`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${client.emoji?.dot || "🔴"} Loaded Icons:** \`${stats.count}\`\n` +
            `**${client.emoji?.dot || "🔴"} Created From File:** \`${stats.created}\`\n` +
            `**${client.emoji?.dot || "🔴"} Replaced / Updated:** \`${stats.updated}\`\n` +
            `**${client.emoji?.dot || "🔴"} Legacy Removed:** \`${stats.removed}\`\n` +
            `**${client.emoji?.dot || "🔴"} Failed:** \`${stats.failed}\``
          )
        );

      await statusMsg.edit({
        components: [resultContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      const errContainer = new ContainerBuilder()
        .setAccentColor(THEME.primary)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${client.emoji?.cross || "❌"} Emoji Sync Failed\n${error.message}`
          )
        );
      await statusMsg.edit({
        components: [errContainer],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => {});
    }
  },
};
