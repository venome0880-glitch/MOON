const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
} = require("discord.js");
const { THEME } = require("../../utils/theme");

const icon = (client, key, fallback = "•") => client.emoji?.[key] || fallback;

function safeHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function buildAboutPayload(client, prefix = client.prefix) {
  const botName = escapeMarkdown(client.user?.username || "MOON");
  const avatarUrl = client.user?.displayAvatarURL?.({ extension: "png", size: 128 });
  const commandCount = client.commands?.size || 0;
  const serverCount = client.guilds?.cache?.size ?? 0;

  const headerText = new TextDisplayBuilder().setContent(
    `### ${icon(client, "music", "🎶")} About ${botName}\n` +
    `A red-theme Discord music bot with animated icons and a responsive dashboard.\n` +
    `-# ${icon(client, "star", "♦️")} [MOON by VENOME](https://github.com/venome0880-glitch/MOON)`
  );

  const container = new ContainerBuilder().setAccentColor(THEME.accent);
  if (avatarUrl) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(headerText)
      .setThumbnailAccessory(
        new ThumbnailBuilder().setURL(avatarUrl).setDescription(`${botName} avatar`)
      );
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(headerText);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${icon(client, "dot", "🔴")} **Creator:** [VENOME](https://github.com/venome0880-glitch/MOON)\n` +
        `${icon(client, "dot", "🔴")} **Prefix:** \`${prefix || ">"}\` · \`/help\`\n` +
        `${icon(client, "dot", "🔴")} **Commands:** \`${commandCount}\` · **Servers:** \`${serverCount}\`\n\n` +
        `**Credits & License**\n` +
        `Built on [Kreo by rock-forge](https://github.com/rock-forge/Kreo) under the [project license](https://github.com/venome0880-glitch/MOON/blob/main/LICENSE).`
      )
    );

  const buttons = [
    ["GitHub", "https://github.com/venome0880-glitch/MOON", "star", "♦️"],
    ["Dashboard", safeHttpsUrl(client.config?.dashboard?.nextAuthUrl), "home", "🏠"],
    ["Invite MOON", safeHttpsUrl(client.config?.links?.invite), "music", "🎶"],
    ["Support", safeHttpsUrl(client.config?.links?.support), "info", "🔻"],
  ]
    .filter(([, url]) => Boolean(url))
    .map(([label, url, key, fallback]) =>
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(label)
        .setURL(url)
        .setEmoji(icon(client, key, fallback))
    );

  if (buttons.length > 0) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

module.exports = {
  name: "about",
  category: "Information",
  description: "Show information, credits, and links for MOON.",
  aliases: ["credit", "credits", "botabout"],
  cooldown: 3,
  args: false,
  usage: "",
  slashOptions: [],
  buildAboutPayload,

  async slashExecute(interaction, client, prefix = client.prefix) {
    return interaction.reply(buildAboutPayload(client, prefix));
  },

  async execute(message, args, client, prefix = client.prefix) {
    return message.reply(buildAboutPayload(client, prefix));
  },
};
