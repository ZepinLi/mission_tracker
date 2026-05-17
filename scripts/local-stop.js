#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pidFile = path.join(root, "data", "local-app.pid");

if (!fs.existsSync(pidFile)) {
  console.log("Mission Tracker is not running, or no PID file was found.");
  process.exit(0);
}

const pid = Number(fs.readFileSync(pidFile, "utf8"));
if (!pid) {
  fs.rmSync(pidFile, { force: true });
  console.log("Removed invalid PID file.");
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
  fs.rmSync(pidFile, { force: true });
  console.log("Mission Tracker stopped. PID: " + pid);
} catch (error) {
  fs.rmSync(pidFile, { force: true });
  if (error.code === "ESRCH") {
    console.log("Mission Tracker process was not running. Removed stale PID file.");
  } else {
    throw error;
  }
}
