const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadEnv } = require("./server/env");
const { handleApi } = require("./server/api");
const { DB_FILE, openDatabase } = require("./server/db");
const { send } = require("./server/utils");

loadEnv();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function handleStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));
  const isSpaRoute = !path.extname(pathname) && (pathname.startsWith("/p/") || pathname.startsWith("/join/"));

  if (!filePath.startsWith(ROOT) || filePath.includes(path.sep + ".git" + path.sep)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  if (isSpaRoute) {
    send(res, 200, fs.readFileSync(path.join(ROOT, "index.html")), {
      "Content-Type": MIME_TYPES[".html"],
    });
    return;
  }

  if (pathname === "/config.public.js" && !fs.existsSync(filePath)) {
    send(
      res,
      200,
      'window.MISSION_TRACKER_CONFIG = window.MISSION_TRACKER_CONFIG || { apiBaseUrl: "" };\n',
      {
        "Content-Type": MIME_TYPES[".js"],
      }
    );
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
}

function localAccessUrls() {
  const urls = [`http://127.0.0.1:${PORT}`];
  const interfaces = os.networkInterfaces();
  for (const devices of Object.values(interfaces)) {
    for (const device of devices || []) {
      if (device.family === "IPv4" && !device.internal) {
        urls.push(`http://${device.address}:${PORT}`);
      }
    }
  }
  return Array.from(new Set(urls));
}

openDatabase();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  handleStatic(req, res, url);
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Try one of the following:");
    console.error(`  - Run with a different port: PORT=4174 node server.js`);
    console.error(`  - Stop the process using port ${PORT} and retry`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log("Mission Tracker local server running. Open one of these URLs:");
  for (const url of localAccessUrls()) {
    console.log("  " + url);
  }
  console.log("Default host is loopback for safety. Set HOST=0.0.0.0 only on trusted networks.");
  console.log("SQLite database: " + DB_FILE);
});
