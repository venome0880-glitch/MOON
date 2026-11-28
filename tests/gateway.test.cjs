const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { resolvePorts, createGatewayServer } = require("../scripts/start-all.cjs");
const { prepareDashboardStandalone } = require("../scripts/prepare-dashboard-standalone.cjs");

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
