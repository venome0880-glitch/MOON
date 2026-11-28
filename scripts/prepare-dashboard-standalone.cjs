const fs = require("node:fs");
const path = require("node:path");

function syncDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  return true;
}

function prepareDashboardStandalone(rootDir = path.resolve(__dirname, "..")) {
  const dashDir = path.join(rootDir, "dashboard");
  const standaloneDir = path.join(dashDir, ".next", "standalone");
  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    return { ready: false };
  }
  const copiedStatic = syncDir(
    path.join(dashDir, ".next", "static"),
    path.join(standaloneDir, ".next", "static")
  );
  const copiedPublic = syncDir(
    path.join(dashDir, "public"),
    path.join(standaloneDir, "public")
  );
  return { ready: true, copiedStatic, copiedPublic };
}

if (require.main === module) {
  const result = prepareDashboardStandalone();
  if (!result.ready) {
    console.error("Dashboard standalone build not found. Run `npm run build --prefix dashboard` first.");
    process.exitCode = 1;
  } else {
    console.log("Prepared dashboard standalone assets.", result);
  }
}

module.exports = { prepareDashboardStandalone };
