const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const WEEKS_DIR = path.join(DATA_DIR, "weeks");
const CORE_FILE = path.join(DATA_DIR, "core.json");
const LEGACY_STATE_FILE = path.join(DATA_DIR, "mission-tracker-state.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpFile = filePath + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpFile, filePath);
}

function parseLocalDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function localDateISO(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function isoWeekInfo(isoDate) {
  const date = parseLocalDate(isoDate);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  const start = parseLocalDate(isoDate);
  const startDay = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - startDay + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    key: weekYear + "-W" + String(week).padStart(2, "0"),
    start: localDateISO(start),
    end: localDateISO(end),
  };
}

function weekFilePath(weekKey) {
  return path.join(WEEKS_DIR, weekKey + ".json");
}

function corePayloadFromState(state, savedAt) {
  return {
    version: 1,
    core: state.core || {},
    systemLog: Array.isArray(state.systemLog) ? state.systemLog : [],
    createdAt: state.createdAt || savedAt,
    lastSavedAt: state.lastSavedAt,
    lastManualSavedAt: state.lastManualSavedAt,
    lastFileSavedAt: savedAt,
    storageMode: "weekly-local-files",
    updatedAt: savedAt,
  };
}

function groupEntriesByWeek(entries) {
  const weeks = new Map();
  for (const [date, entry] of Object.entries(entries || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const info = isoWeekInfo(date);
    if (!weeks.has(info.key)) {
      weeks.set(info.key, {
        version: 1,
        week: info.key,
        range: { start: info.start, end: info.end },
        entries: {},
      });
    }
    weeks.get(info.key).entries[date] = entry;
  }
  return weeks;
}

function saveStateAsWeeklyFiles(state) {
  const savedAt = new Date().toISOString();
  fs.mkdirSync(WEEKS_DIR, { recursive: true });
  writeJsonFile(CORE_FILE, corePayloadFromState(state, savedAt));

  const nextWeeks = groupEntriesByWeek(state.entries || {});
  const nextWeekKeys = new Set(nextWeeks.keys());
  for (const [weekKey, weekPayload] of nextWeeks) {
    writeJsonFile(weekFilePath(weekKey), {
      ...weekPayload,
      updatedAt: savedAt,
    });
  }

  for (const fileName of fs.readdirSync(WEEKS_DIR)) {
    if (!fileName.endsWith(".json")) continue;
    const weekKey = fileName.slice(0, -5);
    if (!nextWeekKeys.has(weekKey)) {
      fs.unlinkSync(path.join(WEEKS_DIR, fileName));
    }
  }

  return savedAt;
}

function loadStateFromWeeklyFiles() {
  const coreFile = readJsonFile(CORE_FILE, null);
  if (!coreFile || !fs.existsSync(WEEKS_DIR)) return null;

  const entries = {};
  for (const fileName of fs.readdirSync(WEEKS_DIR).sort()) {
    if (!fileName.endsWith(".json")) continue;
    const week = readJsonFile(path.join(WEEKS_DIR, fileName), null);
    if (week && week.entries && typeof week.entries === "object") {
      Object.assign(entries, week.entries);
    }
  }

  return {
    core: coreFile.core || {},
    entries,
    systemLog: Array.isArray(coreFile.systemLog) ? coreFile.systemLog : [],
    createdAt: coreFile.createdAt || new Date().toISOString(),
    lastSavedAt: coreFile.lastSavedAt,
    lastManualSavedAt: coreFile.lastManualSavedAt,
    lastFileSavedAt: coreFile.lastFileSavedAt || coreFile.updatedAt,
    storageMode: "weekly-local-files",
  };
}

function migrateLegacyStateIfNeeded() {
  if (fs.existsSync(CORE_FILE) || !fs.existsSync(LEGACY_STATE_FILE)) return;
  const legacy = readJsonFile(LEGACY_STATE_FILE, null);
  if (legacy && typeof legacy === "object") {
    saveStateAsWeeklyFiles(legacy);
  }
}

function localAccessUrls() {
  const urls = ["http://127.0.0.1:" + PORT];
  const interfaces = os.networkInterfaces();
  for (const devices of Object.values(interfaces)) {
    for (const device of devices || []) {
      if (device.family === "IPv4" && !device.internal) {
        urls.push("http://" + device.address + ":" + PORT);
      }
    }
  }
  return Array.from(new Set(urls));
}

async function handleApi(req, res) {
  if (req.url === "/api/state" && req.method === "GET") {
    migrateLegacyStateIfNeeded();
    const state = loadStateFromWeeklyFiles();
    send(res, 200, JSON.stringify(state || { state: null }), {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  if (req.url === "/api/state" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      const savedAt = saveStateAsWeeklyFiles(payload);
      send(res, 200, JSON.stringify({ ok: true, savedAt, storageMode: "weekly-local-files" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (error) {
      send(res, 400, JSON.stringify({ ok: false, error: error.message }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    }
    return;
  }

  send(res, 404, JSON.stringify({ ok: false, error: "Not found" }), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT) || filePath.includes(path.sep + ".git" + path.sep)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
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

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  handleStatic(req, res);
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
  console.log("Mission Tracker running. Open one of these URLs:");
  for (const url of localAccessUrls()) {
    console.log("  " + url);
  }
  console.log("Weekly data directory: " + WEEKS_DIR);
  console.log("Core data file: " + CORE_FILE);
});
