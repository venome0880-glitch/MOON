const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, "../../assets/emojis/manifest.json");
const LEGACY_PREFIXES = ["km_purple2_", "km_purple_", "sb_"];
const DEFAULT_ALIASES = { load: "loading", suffle: "shuffle", like: "favourite" };
const DEFAULT_PREFIXES = ["moon_red_", "km_red_", "red_", ""];

function loadEmojiManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const resolvedPath = path.resolve(manifestPath);
  const baseDir = path.dirname(resolvedPath);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const entries = Array.isArray(raw.emojis) ? raw.emojis : [];

  return {
    theme: raw.theme || "red",
    animated: raw.animated !== false,
    prefix: typeof raw.prefix === "string" && raw.prefix ? raw.prefix : "moon_red_",
    aliases: { ...DEFAULT_ALIASES, ...(raw.aliases && typeof raw.aliases === "object" ? raw.aliases : {}) },
    emojis: entries
      .filter((entry) => entry && typeof entry.key === "string" && typeof entry.name === "string" && typeof entry.file === "string")
      .map((entry) => ({
        key: entry.key,
        name: entry.name,
        file: entry.file,
        filePath: path.resolve(baseDir, entry.file),
        animated: entry.animated !== false,
        fallback: typeof entry.fallback === "string" ? entry.fallback : undefined,
      })),
  };
}

function resolvePrefixes(manifest) {
  const prefixes = [];
  if (manifest?.prefix && !prefixes.includes(manifest.prefix)) {
    prefixes.push(manifest.prefix);
  }
  for (const prefix of DEFAULT_PREFIXES) {
    if (!prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }
  return prefixes;
}

function applyApplicationEmojis(target, emojis, options = {}) {
  const byName = new Map([...emojis].map((emoji) => [emoji.name, emoji]));
  const manifest = options.manifest || null;
  const aliases = manifest?.aliases || DEFAULT_ALIASES;
  const prefixes = resolvePrefixes(manifest);
  let count = 0;

  for (const key of Object.keys(target)) {
    const suffix = aliases[key] || key;
    const emoji = prefixes.map((prefix) => byName.get(prefix + suffix)).find(Boolean);
    if (!emoji || !/^\d{17,20}$/.test(emoji.id)) continue;
    target[key] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    count++;
  }
  return count;
}

async function deleteApplicationEmoji(client, emoji) {
  if (!emoji?.id) return;
  if (typeof client.application.emojis.delete === "function") {
    await client.application.emojis.delete(emoji.id);
    return;
  }
  if (typeof emoji.delete === "function") {
    await emoji.delete();
  }
}

async function syncApplicationEmojisFromFiles(client, options = {}) {
  const {
    force = false,
    cleanupLegacy = false,
    manifestPath = DEFAULT_MANIFEST_PATH,
    delayMs = 150,
  } = options;

  if (!client?.application?.emojis) {
    return { count: 0, created: 0, updated: 0, removed: 0, failed: 0 };
  }

  let manifest = null;
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = loadEmojiManifest(manifestPath);
    }
  } catch (error) {
    client.logger?.log(`Could not read emoji manifest (${manifestPath}): ${error.message}`, "warn");
  }

  let emojis = await client.application.emojis.fetch();
  let created = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  const isPrimaryWorker = !client.cluster || client.cluster.id === 0;
  if (manifest && isPrimaryWorker) {
    const byName = new Map([...emojis.values()].map((emoji) => [emoji.name, emoji]));
    const targetNames = new Set(manifest.emojis.map((entry) => entry.name));

    if (cleanupLegacy) {
      for (const existing of emojis.values()) {
        if (targetNames.has(existing.name)) continue;
        if (!LEGACY_PREFIXES.some((prefix) => existing.name.startsWith(prefix))) continue;
        try {
          await deleteApplicationEmoji(client, existing);
          byName.delete(existing.name);
          removed++;
        } catch {
          failed++;
        }
      }
    }

    for (const entry of manifest.emojis) {
      if (!fs.existsSync(entry.filePath)) {
        failed++;
        continue;
      }

      const existing = byName.get(entry.name);
      const needsAnimatedReplace = Boolean(existing && entry.animated && !existing.animated);
      if (existing && !force && !needsAnimatedReplace) {
        continue;
      }

      try {
        if (existing) {
          await deleteApplicationEmoji(client, existing);
          byName.delete(entry.name);
        }
        const attachment = fs.readFileSync(entry.filePath);
        const createdEmoji = await client.application.emojis.create({
          attachment,
          name: entry.name,
        });
        if (createdEmoji?.name) {
          byName.set(createdEmoji.name, createdEmoji);
        }
        if (existing) updated++;
        else created++;

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        failed++;
        client.logger?.log(`Failed syncing application emoji "${entry.name}": ${error.message}`, "warn");
      }
    }

    if (created > 0 || updated > 0 || removed > 0) {
      emojis = await client.application.emojis.fetch();
    }
  }

  if (!client.emoji) {
    client.emoji = require("../emojis");
  }
  const count = applyApplicationEmojis(client.emoji, emojis.values(), { manifest });
  return { count, created, updated, removed, failed };
}

async function loadApplicationEmojis(client, options = {}) {
  try {
    const stats = await syncApplicationEmojisFromFiles(client, options);
    const details = stats.created || stats.updated
      ? ` (${stats.created} created, ${stats.updated} updated from file)`
      : "";
    client.logger?.log(`Application emojis loaded: ${stats.count} red animated UI icons${details}.`, "event");
    return stats;
  } catch {
    client.logger?.log("Application emojis could not be loaded; using red fallback icons.", "warn");
    return { count: 0, created: 0, updated: 0, removed: 0, failed: 0 };
  }
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  LEGACY_PREFIXES,
  applyApplicationEmojis,
  loadApplicationEmojis,
  loadEmojiManifest,
  syncApplicationEmojisFromFiles,
};
