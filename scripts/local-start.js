#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const logsDir = path.join(root, "logs");
const pidFile = path.join(dataDir, "local-app.pid");
const logFile = path.join(logsDir, "local-app.log");
const errorLogFile = path.join(logsDir, "local-app-error.log");
const port = process.env.PORT || "4173";

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  if (pid && isRunning(pid)) {
    console.log("Mission Tracker is already running at http://127.0.0.1:" + port);
    console.log("PID: " + pid);
    process.exit(0);
  }
  fs.rmSync(pidFile, { force: true });
}

const out = fs.openSync(logFile, "a");
const err = fs.openSync(errorLogFile, "a");
const child = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd: root,
  detached: true,
  env: {
    ...process.env,
    HOST: process.env.HOST || "127.0.0.1",
    PORT: port,
  },
  stdio: ["ignore", out, err],
});

child.unref();
fs.writeFileSync(pidFile, String(child.pid));
console.log("Mission Tracker started at http://127.0.0.1:" + port);
console.log("PID: " + child.pid);
console.log("Logs: " + logFile);
