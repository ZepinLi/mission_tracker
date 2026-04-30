export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function safeJsonParse(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

export function stableStringify(value) {
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

export function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export function hashContent(value) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function slugify(value, fallback = "page") {
  const source = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return source || fallback;
}

export function createSlugCandidate(title, suffix = "") {
  const base = slugify(title || "mission-page");
  return suffix ? `${base}-${suffix}` : base;
}

export function makeClientId(prefix = "mt") {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}_${timePart}${randomPart}`;
}

export function toTitleCase(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function average(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

export function clampNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

export function toPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function roleRank(role) {
  const ranks = {
    viewer: 1,
    commenter: 2,
    editor: 3,
    owner: 4,
  };
  return ranks[role] || 0;
}

export function canComment(role) {
  return roleRank(role) >= roleRank("commenter");
}

export function canEdit(role) {
  return roleRank(role) >= roleRank("editor");
}

export function canManage(role) {
  return roleRank(role) >= roleRank("owner");
}

export function displayNameFromEmail(email) {
  if (!email) return "Anonymous";
  const prefix = String(email).split("@")[0];
  return prefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function avatarSeedFromEmail(email) {
  return String(email || "mission").toLowerCase();
}

export function arrayToMap(items, keyField = "id") {
  return (items || []).reduce((result, item) => {
    if (item && item[keyField] != null) {
      result[item[keyField]] = item;
    }
    return result;
  }, {});
}

export function compactObject(value) {
  return Object.entries(value || {}).reduce((result, [key, entry]) => {
    if (entry !== undefined) {
      result[key] = entry;
    }
    return result;
  }, {});
}

export function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

export function randomToken(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function sha256Hex(value) {
  const payload = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
