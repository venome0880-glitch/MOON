const { ActivityType, REST, Routes } = require("discord.js");
const { registerApplicationCommands } = require("../../utils/registerApplicationCommands");

const DEFAULT_STREAM_URL = "https://www.twitch.tv/discord";

function resolveStreamUrl(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_STREAM_URL;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    const isTwitch = host === "twitch.tv" || host === "www.twitch.tv";
    const isYoutube = host === "youtube.com" || host === "www.youtube.com";
    if (parsed.protocol === "https:" && (isTwitch || isYoutube)) {
      return parsed.href;
    }
  } catch {}
  return DEFAULT_STREAM_URL;
}

function updateStreamingPresence(client, index) {
  const totalMembers = [...client.guilds.cache.values()].reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
  const statuses = [
    `Serving ${client.guilds.cache.size} Servers • ${totalMembers} Users`,
    `MOON • High Quality Music`,
    `/help • 24/7 Audio System`,
    `Vibing with ${totalMembers} Users`
  ];
  const chosenIndex = Number.isInteger(index) ? Math.abs(index) % statuses.length : Math.floor(Math.random() * statuses.length);
  const streamUrl = resolveStreamUrl(client.config?.streamUrl || process.env.STREAM_URL);

  client.user.setPresence({
    activities: [
      {
        name: statuses[chosenIndex],
        type: ActivityType.Streaming,
        url: streamUrl,
      },
    ],
    status: "online",
  });
}

module.exports = {
  name: "clientReady",
  once: true,
  DEFAULT_STREAM_URL,
  resolveStreamUrl,
  updateStreamingPresence,
  run: async (client) => {
    await require("../../utils/applicationEmojis").loadApplicationEmojis(client);
    client.logger.log(`${client.user.username} is now online.`, "ready");
    client.logger.log(
      `Ready on ${client.guilds.cache.size} servers, for a total of ${client.users.cache.size} users`,
      "ready",
    );

    if (client.slashCommands.size > 0) {
      const rest = new REST({ version: "10" }).setToken(client.token);
      try {
        const commands = Array.from(client.slashCommands.values()).map((cmd) => {
          const commandData = {
            name: cmd.name,
            description: cmd.description,
            options: cmd.options || [],
          };

          if (cmd.owner) {
            commandData.default_member_permissions = "8";
            commandData.dm_permission = false;
          }

          return commandData;
        });

        client.logger.log(`Deploying ${commands.length} slash commands...`, "cmd");

        await registerApplicationCommands(rest, client.user.id, commands);

        client.logger.log(`Successfully deployed ${commands.length} slash commands.`, "cmd");
      } catch (error) {
        console.error("Error deploying slash commands:", error);
      }
    } else {
      console.log("\n⚠️ WARNING: No slash commands to deploy! client.slashCommands.size = 0\n");
    }

    // Periodic 24/7 check for dashboard changes
    setInterval(async () => {
      try {
        const TwoFourSeven = require("../../schema/247");
        const entries = await TwoFourSeven.find({ Guild: { $in: [...client.guilds.cache.keys()] } });
        if (!entries || entries.length === 0) return;

        for (const data of entries) {
          try {
            const voice = client.channels.cache.get(data.VoiceId);
            if (!voice) continue;

            const guild = voice.guild;
            const me = guild.members.cache.get(client.user.id);
            if (!me) continue;

            // Only attempt to join if not already in a voice channel for this guild
            if (!me.voice.channelId) {
              const perms = voice.permissionsFor(me);
              if (!perms || !perms.has(["Connect", "Speak"])) continue;

              let player = client.manager.players.get(data.Guild);
              if (!player) {
                await client.manager.createPlayer({
                  guildId: data.Guild,
                  voiceId: data.VoiceId,
                  textId: data.TextId,
                  deaf: true,

                });
                client.logger.log(`[247-AutoJoin] Joined ${guild.name} via periodic check`, "log");
              }
            }
          } catch (err) {
            // Silently fail for individual guilds
          }
        }
      } catch (error) {
        client.logger.log(`Error in periodic 24/7 check: ${error.message}`, "error");
      }
    }, 60000 * 5); // Check every 5 minutes

    updateStreamingPresence(client, 1);
    setInterval(() => {
      updateStreamingPresence(client);
    }, 10000);

    client.logger.log(
      "Auto Reconnect (clientReady): skipping player creation and leaving recovery to Lavalink ready and health checks.",
      "debug"
    );
  },
};
