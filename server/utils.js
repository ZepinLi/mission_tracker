const crypto = require("crypto");

const JSON_LIMIT_BYTES = 5_000_000;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > JSON_LIMIT_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((result, entry) => {
      const index = entry.indexOf("=");
      if (index === -1) return result;
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      result[key] = decodeURIComponent(value);
      return result;
    }, {});
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  return parts.join("; ");
}

function randomId() {
  return crypto.randomUUID();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortValue(value[key]);
      return result;
    }, {});
}

function contentHash(value) {
  return sha256(stableStringify(value));
}

function safeJsonParse(raw, fallback = null) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function slugify(value, fallback = "page") {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function displayNameFromEmail(email) {
  const prefix = String(email || "local").split("@")[0];
  return prefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function routeParts(pathname) {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function notFound(res) {
  sendJson(res, 404, { ok: false, error: "Not found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { ok: false, error: message || "Bad request" });
}

module.exports = {
  badRequest,
  contentHash,
  cookie,
  displayNameFromEmail,
  normalizeEmail,
  notFound,
  nowIso,
  parseCookies,
  randomId,
  randomToken,
  readJson,
  routeParts,
  safeJsonParse,
  send,
  sendJson,
  sha256,
  slugify,
  stableStringify,
};
