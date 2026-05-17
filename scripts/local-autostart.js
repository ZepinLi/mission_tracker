#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const mode = process.argv[2];
const root = path.resolve(__dirname, "..");
const label = "com.zepingli.mission-tracker";
const agentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(agentsDir, label + ".plist");
const logsDir = path.join(root, "logs");
const nodePath = process.execPath;

function xml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plist() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>' + xml(label) + '</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>' + xml(nodePath) + '</string>',
    '    <string>' + xml(path.join(root, "server.js")) + '</string>',
    '  </array>',
    '  <key>WorkingDirectory</key>',
    '  <string>' + xml(root) + '</string>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>HOST</key>',
    '    <string>127.0.0.1</string>',
    '    <key>PORT</key>',
    '    <string>4173</string>',
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    '  <string>' + xml(path.join(logsDir, "launch-agent.log")) + '</string>',
    '  <key>StandardErrorPath</key>',
    '  <string>' + xml(path.join(logsDir, "launch-agent-error.log")) + '</string>',
    '</dict>',
    '</plist>',
    '',
  ].join("\n");
}

function bootout() {
  try {
    execFileSync("launchctl", ["bootout", "gui/" + process.getuid(), plistPath], { stdio: "ignore" });
  } catch (_error) {
    // It may not be loaded yet.
  }
}

if (mode === "install") {
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  bootout();
  fs.writeFileSync(plistPath, plist());
  execFileSync("launchctl", ["bootstrap", "gui/" + process.getuid(), plistPath], { stdio: "inherit" });
  execFileSync("launchctl", ["kickstart", "-k", "gui/" + process.getuid() + "/" + label], { stdio: "inherit" });
  console.log("Installed autostart: " + plistPath);
  console.log("Mission Tracker will start after login at http://127.0.0.1:4173");
} else if (mode === "uninstall") {
  bootout();
  fs.rmSync(plistPath, { force: true });
  console.log("Removed autostart: " + plistPath);
} else {
  console.log("Usage: node scripts/local-autostart.js install|uninstall");
  process.exit(1);
}
