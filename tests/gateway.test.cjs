const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { resolvePorts, createGatewayServer, calculateBotRestartDelayMs } = require("../scripts/start-all.cjs");
const { prepareDashboardStandalone } = require("../scripts/prepare-dashboard-standalone.cjs");
const {
  parseExplicitShardCount,
  resolveTotalShards,
  spawnClustersWithFallback,
} = require("../src/utils/clusterSpawn");

test("resolvePorts prevents collisions between public, bridge, and dashboard ports", () => {
  assert.deepEqual(resolvePorts({}), { publicPort: 3000, bridgePort: 2000, dashboardPort: 3001 });
  assert.deepEqual(resolvePorts({ PORT: "8080", BRIDGE_PORT: "2000" }), { publicPort: 8080, bridgePort: 2000, dashboardPort: 3001 });
  const clashBridge = resolvePorts({ PORT: "2000" });
  assert.equal(new Set([clashBridge.publicPort, clashBridge.bridgePort, clashBridge.dashboardPort]).size, 3);
  const clashDash = resolvePorts({ PORT: "3001" });
  assert.equal(new Set([clashDash.publicPort, clashDash.bridgePort, clashDash.dashboardPort]).size, 3);
});

test("gateway routes website HTTP to dashboard and /socket.io HTTP + WebSocket upgrades to bridge", async () => {
  const dashHits = [];
  const bridgeHits = [];
  const sockets = new Set();

  const dashServer = http.createServer((req, res) => {
    dashHits.push({ url: req.url, proto: req.headers["x-forwarded-proto"], host: req.headers["x-forwarded-host"] });
    res.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": ["a=1", "b=2"], Connection: "close" });
    res.end("dashboard-ok");
  });

  const bridgeServer = http.createServer((req, res) => {
    bridgeHits.push(req.url);
    res.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
    res.end("bridge-socket-poll");
  });

  bridgeServer.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    bridgeHits.push(`UPGRADE:${req.url}`);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => {
      socket.write(Buffer.from(`echo:${chunk.toString()}`));
    });
  });

  await new Promise((r) => dashServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => bridgeServer.listen(0, "127.0.0.1", r));

  const gateway = createGatewayServer({
    dashboardPort: dashServer.address().port,
    bridgePort: bridgeServer.address().port,
    defaultHttps: true,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const gwPort = gateway.address().port;

  try {
    const pageRes = await fetch(`http://127.0.0.1:${gwPort}/dashboard`, { headers: { Connection: "close" } });
    assert.equal(pageRes.status, 200);
    assert.equal(await pageRes.text(), "dashboard-ok");
    assert.equal(dashHits[0].url, "/dashboard");
    assert.equal(dashHits[0].proto, "https");

    // Private bridge API routes must NOT route to bridge from public gateway
    const apiRes = await fetch(`http://127.0.0.1:${gwPort}/api/bot/guild/123`, { headers: { Connection: "close" } });
    assert.equal(await apiRes.text(), "dashboard-ok");
    assert.equal(bridgeHits.length, 0);

    const pollRes = await fetch(`http://127.0.0.1:${gwPort}/socket.io/?EIO=4&transport=polling`, { headers: { Connection: "close" } });
    assert.equal(pollRes.status, 200);
    assert.equal(await pollRes.text(), "bridge-socket-poll");
    assert.deepEqual(bridgeHits, ["/socket.io/?EIO=4&transport=polling"]);

    const wsResponse = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: "127.0.0.1", port: gwPort }, () => {
        sockets.add(sock);
        sock.write(
          "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${gwPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n\r\n"
        );
      });
      let data = "";
      sock.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("101 Switching Protocols") && !data.includes("echo:ping")) {
          sock.write("ping");
        }
        if (data.includes("echo:ping")) {
          sock.destroy();
          sockets.delete(sock);
          resolve(data);
        }
      });
      sock.on("error", reject);
    });
    assert.match(wsResponse, /101 Switching Protocols/);
    assert.match(wsResponse, /echo:ping/);
    assert.ok(bridgeHits.includes("UPGRADE:/socket.io/?EIO=4&transport=websocket"));
  } finally {
    for (const s of sockets) s.destroy();
    gateway.closeAllConnections?.();
    dashServer.closeAllConnections?.();
    bridgeServer.closeAllConnections?.();
    await Promise.all([
      new Promise((r) => gateway.close(r)),
      new Promise((r) => dashServer.close(r)),
      new Promise((r) => bridgeServer.close(r)),
    ]);
  }
});

test("prepareDashboardStandalone copies public and static assets into standalone", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "moon-standalone-"));
  try {
    const dash = path.join(temp, "dashboard");
    fs.mkdirSync(path.join(dash, ".next", "standalone"), { recursive: true });
    fs.mkdirSync(path.join(dash, ".next", "static", "chunks"), { recursive: true });
    fs.mkdirSync(path.join(dash, "public", "branding"), { recursive: true });
    fs.writeFileSync(path.join(dash, ".next", "standalone", "server.js"), "// server");
    fs.writeFileSync(path.join(dash, ".next", "static", "chunks", "app.js"), "// chunk");
    fs.writeFileSync(path.join(dash, "public", "branding", "icon.png"), "png");

    const res = prepareDashboardStandalone(temp);
    assert.deepEqual(res, { ready: true, copiedStatic: true, copiedPublic: true });
    assert.equal(fs.readFileSync(path.join(dash, ".next", "standalone", ".next", "static", "chunks", "app.js"), "utf8"), "// chunk");
    assert.equal(fs.readFileSync(path.join(dash, ".next", "standalone", "public", "branding", "icon.png"), "utf8"), "png");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("calculateBotRestartDelayMs backs off exponentially and caps at maxDelayMs", () => {
  assert.equal(calculateBotRestartDelayMs(0), 5000);
  assert.equal(calculateBotRestartDelayMs(1), 10000);
  assert.equal(calculateBotRestartDelayMs(2), 20000);
  assert.equal(calculateBotRestartDelayMs(4), 60000);
  assert.equal(calculateBotRestartDelayMs(10), 60000);
});

test("parseExplicitShardCount only accepts integers >= 1", () => {
  assert.equal(parseExplicitShardCount(undefined), null);
  assert.equal(parseExplicitShardCount("auto"), null);
  assert.equal(parseExplicitShardCount("0"), null);
  assert.equal(parseExplicitShardCount("1.5"), null);
  assert.equal(parseExplicitShardCount("2"), 2);
});

test("resolveTotalShards skips Discord API when TOTAL_SHARDS is explicit", async () => {
  let called = false;
  const res = await resolveTotalShards({
    token: "abc",
    env: { TOTAL_SHARDS: "3" },
    fetchRecommendedShards: async () => {
      called = true;
      return 1;
    },
  });
  assert.equal(called, false);
  assert.deepEqual(res, { totalShards: 3, source: "env" });
});

test("resolveTotalShards retries 429 and falls back to 1 shard instead of crashing", async () => {
  const waits = [];
  const warnings = [];
  let attempts = 0;

  const fallbackRes = await resolveTotalShards({
    token: "abc",
    env: {},
    retryDelayMs: 100,
    maxAttempts: 3,
    defaultShards: 1,
    wait: async (ms) => waits.push(ms),
    logger: { warn: (msg) => warnings.push(msg) },
    fetchRecommendedShards: async () => {
      attempts += 1;
      const err = new Error("Failed to fetch data. Status code: 429");
      err.statusCode = 429;
      throw err;
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 200]);
  assert.equal(fallbackRes.totalShards, 1);
  assert.equal(fallbackRes.source, "fallback");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /429/);

  let retryCount = 0;
  const recoveredRes = await resolveTotalShards({
    token: "abc",
    env: {},
    retryDelayMs: 50,
    maxAttempts: 3,
    wait: async () => {},
    logger: { warn: () => {} },
    fetchRecommendedShards: async () => {
      retryCount += 1;
      if (retryCount === 1) {
        const err = new Error("Failed to fetch data. Status code: 429");
        err.statusCode = 429;
        err.retryAfterMs = 250;
        throw err;
      }
      return 2;
    },
  });
  assert.equal(retryCount, 2);
  assert.deepEqual(recoveredRes, { totalShards: 2, source: "discord" });
});

test("resolveTotalShards breaks early on long Retry-After and rethrows 401 invalid token", async () => {
  const waits = [];
  const res = await resolveTotalShards({
    token: "abc",
    env: {},
    maxRetryWaitMs: 1000,
    maxAttempts: 3,
    wait: async (ms) => waits.push(ms),
    logger: { warn: () => {} },
    fetchRecommendedShards: async () => {
      const err = new Error("Failed to fetch data. Status code: 429");
      err.statusCode = 429;
      err.retryAfterMs = 30000;
      throw err;
    },
  });
  assert.deepEqual(waits, []);
  assert.equal(res.totalShards, 1);
  assert.equal(res.source, "fallback");

  await assert.rejects(
    resolveTotalShards({
      token: "bad",
      env: {},
      fetchRecommendedShards: async () => {
        const err = new Error("DISCORD_TOKEN_INVALID");
        err.statusCode = 401;
        throw err;
      },
    }),
    /DISCORD_TOKEN_INVALID/
  );
});

test("spawnClustersWithFallback syncs manager.totalShards before calling manager.spawn", async () => {
  let seenManagerTotal = null;
  let seenSpawnOpts = null;
  const fakeManager = {
    totalShards: -1,
    spawnOptions: { amount: -1, delay: 7000, timeout: -1 },
    async spawn(opts) {
      seenManagerTotal = this.totalShards;
      seenSpawnOpts = opts;
      return new Map();
    },
  };

  const res = await spawnClustersWithFallback({
    manager: fakeManager,
    token: "abc",
    env: {},
    maxAttempts: 1,
    logger: { warn: () => {} },
    fetchRecommendedShards: async () => {
      const err = new Error("Failed to fetch data. Status code: 429");
      err.statusCode = 429;
      throw err;
    },
  });

  assert.equal(res.totalShards, 1);
  assert.equal(fakeManager.totalShards, 1);
  assert.equal(fakeManager.spawnOptions.amount, 1);
  assert.equal(seenManagerTotal, 1);
  assert.deepEqual(seenSpawnOpts, { amount: 1, timeout: -1 });
});
