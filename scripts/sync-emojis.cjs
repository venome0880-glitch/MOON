const { Client, Events, GatewayIntentBits } = require("discord.js");
const config = require("../src/config");
const { syncApplicationEmojisFromFiles } = require("../src/utils/applicationEmojis");

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const cleanupLegacy = args.has("--cleanup");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let timer;

  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Discord gateway connection timed out")), 30_000);
      client.once(Events.ClientReady, resolve);
      client.once(Events.Error, reject);
      client.login(config.token).catch(reject);
    });

    client.emoji = require("../src/emojis");
    client.logger = {
      log(message, level = "info") {
        console.log(`[${level}] ${message}`);
      },
    };

    const stats = await syncApplicationEmojisFromFiles(client, { force, cleanupLegacy });
    console.log(JSON.stringify({ ok: stats.failed === 0, ...stats }));
    if (stats.failed > 0) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await client.destroy();
  }
}

main().catch((error) => {
  console.error("Emoji sync failed:", error.message);
  process.exitCode = 1;
});
