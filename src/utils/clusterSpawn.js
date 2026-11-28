const DISCORD_GATEWAY_BOT_URL = "https://discord.com/api/v10/gateway/bot";
const DISCORD_USER_AGENT = "DiscordBot (https://github.com/venome0880-glitch/MOON, 1.0.0)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses an explicit positive integer shard count from env configuration.
 * Returns null when unset, "auto", or not a valid integer >= 1.
 */
function parseExplicitShardCount(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  const trimmed = String(rawValue).trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Identifies authentication errors that should not be retried or hidden behind a fallback.
 */
function isInvalidTokenError(error) {
  const message = String(error?.message || "");
  return (
    error?.statusCode === 401 ||
    message.includes("DISCORD_TOKEN_INVALID") ||
    message.includes("DISCORD_TOKEN_MISSING") ||
    /\bStatus code:\s*401\b/i.test(message)
  );
}

/**
 * Queries Discord's /gateway/bot endpoint with a proper Bot User-Agent header.
 */
async function defaultFetchRecommendedShards(token, guildsPerShard = 1000) {
  if (!token) throw new Error("DISCORD_TOKEN_MISSING");

  const cleanToken = String(token).replace(/^Bot\s*/i, "");
  const response = await fetch(DISCORD_GATEWAY_BOT_URL, {
    method: "GET",
    headers: {
      Authorization: `Bot ${cleanToken}`,
      "User-Agent": DISCORD_USER_AGENT,
    },
  });

  if (response.status === 200) {
    const data = await response.json();
    const shards = Number(data?.shards);
    if (!Number.isFinite(shards) || shards < 1) {
      throw new Error(`Invalid shard count returned by Discord: ${data?.shards}`);
    }
    return Math.max(1, Math.round(shards * (1000 / guildsPerShard)));
  }

  if (response.status === 401) {
    const err = new Error("DISCORD_TOKEN_INVALID");
    err.statusCode = 401;
    throw err;
  }

  const err = new Error(`Failed to fetch data. Status code: ${response.status}`);
  err.statusCode = response.status;
  const retryAfterHeader =
    response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-after");
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      err.retryAfterMs = Math.ceil(seconds * 1000);
    }
  }
  throw err;
}

function logWarning(logger, message) {
  if (logger && typeof logger.warn === "function") {
    logger.warn(message);
    return;
  }
  if (logger && typeof logger.log === "function") {
    logger.log(message, "warn");
    return;
  }
  console.warn(message);
}

/**
 * Resolves the total shard count from env override or Discord /gateway/bot,
 * retrying short rate limits and falling back safely to 1 shard on transient/429 failures.
 */
async function resolveTotalShards({
  token,
  env = process.env,
  fetchRecommendedShards = defaultFetchRecommendedShards,
  retryDelayMs = 1500,
  maxRetryWaitMs = 5000,
  maxAttempts = 3,
  defaultShards = 1,
  wait = sleep,
  logger = console,
} = {}) {
  const explicit = parseExplicitShardCount(env?.TOTAL_SHARDS);
  if (explicit !== null) {
    return { totalShards: explicit, source: "env" };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const recommended = await fetchRecommendedShards(token, 1000);
      const count = Number(recommended);
      if (Number.isFinite(count) && count >= 1) {
        return { totalShards: Math.max(1, Math.round(count)), source: "discord" };
      }
      throw new Error(`Invalid recommended shard count: ${recommended}`);
    } catch (error) {
      if (isInvalidTokenError(error)) {
        throw error;
      }

      lastError = error;
      if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > maxRetryWaitMs) {
        break;
      }
      if (attempt < maxAttempts) {
        const delayMs = Number.isFinite(error?.retryAfterMs)
          ? Math.max(0, error.retryAfterMs)
          : retryDelayMs * attempt;
        if (delayMs > 0) {
          await wait(delayMs);
        }
      }
    }
  }

  logWarning(
    logger,
    `Discord shard lookup failed (${lastError?.message || "unknown error"}); falling back to ${defaultShards} shard(s).`
  );
  return { totalShards: defaultShards, source: "fallback", error: lastError };
}

/**
 * Resolves shard count and updates manager.totalShards before spawning clusters,
 * preventing discord-hybrid-sharding from passing -1 into child cluster env vars.
 */
async function spawnClustersWithFallback({
  manager,
  token,
  env = process.env,
  timeout = -1,
  fetchRecommendedShards = defaultFetchRecommendedShards,
  retryDelayMs = 1500,
  maxRetryWaitMs = 5000,
  maxAttempts = 3,
  defaultShards = 1,
  wait = sleep,
  logger = console,
} = {}) {
  const resolved = await resolveTotalShards({
    token,
    env,
    fetchRecommendedShards,
    retryDelayMs,
    maxRetryWaitMs,
    maxAttempts,
    defaultShards,
    wait,
    logger,
  });

  manager.totalShards = resolved.totalShards;
  if (manager.spawnOptions && typeof manager.spawnOptions === "object") {
    manager.spawnOptions.amount = resolved.totalShards;
  }

  const clusters = await manager.spawn({
    amount: resolved.totalShards,
    timeout,
  });

  return { ...resolved, clusters };
}

module.exports = {
  parseExplicitShardCount,
  isInvalidTokenError,
  defaultFetchRecommendedShards,
  resolveTotalShards,
  spawnClustersWithFallback,
};
