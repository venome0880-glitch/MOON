const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { prepareDashboardStandalone } = require("./prepare-dashboard-standalone.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT_DIR, "dashboard");

function resolvePorts(env = process.env) {
  const publicPort = Number(env.PORT) || 3000;
  let bridgePort = Number(env.BRIDGE_PORT) || 2000;
  if (bridgePort === publicPort) {
    bridgePort = publicPort === 2000 ? 2001 : 2000;
  }
  let dashboardPort = Number(env.DASHBOARD_INTERNAL_PORT) || 3001;
  if (dashboardPort === publicPort || dashboardPort === bridgePort) {
    dashboardPort = [3001, 3002, 3100, 3101].find((p) => p !== publicPort && p !== bridgePort);
  }
  return { publicPort, bridgePort, dashboardPort };
}

function forwardHttp(req, res, targetPort, isSecureHint) {
  const headers = { ...req.headers };
  if (!headers["x-forwarded-host"] && headers.host) {
    headers["x-forwarded-host"] = headers.host;
  }
  if (!headers["x-forwarded-proto"]) {
    headers["x-forwarded-proto"] = isSecureHint ? "https" : "http";
  }

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Service is starting up. Please retry in a moment." }));
    } else {
      res.destroy();
    }
  });

  req.on("aborted", () => proxyReq.destroy());
  req.pipe(proxyReq);
}

function forwardUpgrade(req, clientSocket, head, targetPort) {
  const upstream = net.connect({ host: "127.0.0.1", port: targetPort }, () => {
    const headerLines = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    const requestHead = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines.join("\r\n")}\r\n\r\n`;
    upstream.write(requestHead);
    if (head && head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const closeBoth = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", closeBoth);
  clientSocket.on("error", closeBoth);
  upstream.on("close", closeBoth);
  clientSocket.on("close", closeBoth);
}

function createGatewayServer({ bridgePort, dashboardPort, defaultHttps = false }) {
  const isSocketPath = (url = "") => url === "/socket.io" || url.startsWith("/socket.io/") || url.startsWith("/socket.io?");

  const server = http.createServer((req, res) => {
    const targetPort = isSocketPath(req.url) ? bridgePort : dashboardPort;
    forwardHttp(req, res, targetPort, defaultHttps);
  });

  server.on("upgrade", (req, clientSocket, head) => {
    const targetPort = isSocketPath(req.url) ? bridgePort : dashboardPort;
    forwardUpgrade(req, clientSocket, head, targetPort);
  });

  return server;
}

function spawnDashboard(dashboardPort, bridgePort) {
  const standaloneServer = path.join(DASHBOARD_DIR, ".next", "standalone", "server.js");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(dashboardPort),
    DASHBOARD_API_URL: process.env.DASHBOARD_API_URL || `http://127.0.0.1:${bridgePort}`,
  };

  if (fs.existsSync(standaloneServer)) {
    prepareDashboardStandalone(ROOT_DIR);
    return spawn(process.execPath, [standaloneServer], {
      cwd: path.dirname(standaloneServer),
      env,
      stdio: "inherit",
    });
  }

  const nextBin = path.join(DASHBOARD_DIR, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(dashboardPort)], {
    cwd: DASHBOARD_DIR,
    env,
    stdio: "inherit",
  });
}

function startAll() {
  const { publicPort, bridgePort, dashboardPort } = resolvePorts(process.env);
  const defaultHttps = String(process.env.NEXTAUTH_URL || "").startsWith("https://");

  const gateway = createGatewayServer({ bridgePort, dashboardPort, defaultHttps });
  gateway.listen(publicPort, "0.0.0.0", () => {
    console.log(`[GATEWAY] Listening on 0.0.0.0:${publicPort} -> dashboard(127.0.0.1:${dashboardPort}), socket.io(127.0.0.1:${bridgePort})`);
  });

  const botEnv = {
    ...process.env,
    BRIDGE_PORT: String(bridgePort),
  };
  const bot = spawn(process.execPath, ["--no-deprecation", "devrock.js"], {
    cwd: ROOT_DIR,
    env: botEnv,
    stdio: "inherit",
  });

  const dash = spawnDashboard(dashboardPort, bridgePort);
  let shuttingDown = false;

  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    gateway.close(() => {});
    for (const child of [bot, dash]) {
      if (child && !child.killed) {
        try { child.kill("SIGTERM"); } catch {}
      }
    }
    setTimeout(() => process.exit(exitCode), 500).unref();
  };

  bot.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[BOT] Exited with code ${code ?? 1}`);
      shutdown(code || 1);
    }
  });

  dash.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[DASH] Exited with code ${code ?? 1}`);
      shutdown(code || 1);
    }
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

if (require.main === module) {
  startAll();
}

module.exports = { resolvePorts, createGatewayServer };
