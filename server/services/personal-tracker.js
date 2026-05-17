const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("../utils");

const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "personal-tracker.json");
const LEGACY_STATE_FILE = path.join(DATA_DIR, "mission-tracker-state.json");
const LEGACY_CORE_FILE = path.join(DATA_DIR, "core.json");
const LEGACY_WEEKS_DIR = path.join(DATA_DIR, "weeks");

const defaultCore = {
  version: 2,
  mission: "Turn each mistake into a better system.",
  identities: [
    {
      id: "venture",
      title: "Entrepreneur",
      question: "Did I make one reality-facing move?",
      accent: "#b76e1e",
      soft: "#f5ead8",
    },
    {
      id: "research",
      title: "RL Research",
      question: "Did I create one compounding research artifact?",
      accent: "#2f5f98",
      soft: "#e2ebf7",
    },
    {
      id: "family",
      title: "Family",
      question: "Did I offer presence or companionship?",
      accent: "#1f7a73",
      soft: "#dcefe9",
    },
  ],
  actions: [],
};

function emptyEntry() {
  return {
    version: 2,
    actions: {},
    keyActions: {},
    reflection: {
      oneThing: "",
      avoid: "",
      win: "",
      lesson: "",
    },
    principle: {
      pattern: "",
      rootCondition: "",
      principle: "",
      mechanism: "",
    },
    aiAnalyses: [],
  };
}

function normalizeEntry(entry = {}) {
  return {
    ...emptyEntry(),
    ...entry,
    actions: entry.actions && typeof entry.actions === "object" ? entry.actions : {},
    keyActions: ["venture", "research", "family"].reduce((result, key) => {
      result[key] = String(entry.keyActions?.[key] || "");
      return result;
    }, {}),
    reflection: {
      ...emptyEntry().reflection,
      ...(entry.reflection && typeof entry.reflection === "object" ? entry.reflection : {}),
    },
    principle: {
      ...emptyEntry().principle,
      ...(entry.principle && typeof entry.principle === "object" ? entry.principle : {}),
      pattern: String(entry.principle?.pattern || ""),
      rootCondition: String(entry.principle?.rootCondition || ""),
      principle: String(entry.principle?.principle || ""),
      mechanism: String(entry.principle?.mechanism || ""),
    },
    aiAnalyses: Array.isArray(entry.aiAnalyses) ? entry.aiAnalyses : [],
  };
}

function normalizeState(payload = {}) {
  const entries = Object.entries(payload.entries || {}).reduce((result, [date, entry]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result[date] = normalizeEntry(entry);
    }
    return result;
  }, {});

  return {
    version: 1,
    core: {
      ...defaultCore,
      ...(payload.core && typeof payload.core === "object" ? payload.core : {}),
    },
    entries,
    systemLog: Array.isArray(payload.systemLog) ? payload.systemLog : [],
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };
}

function readJsonFile(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return safeJsonParse(fs.readFileSync(file, "utf8"), fallback);
}

function loadLegacyWeeklyState() {
  const corePayload = readJsonFile(LEGACY_CORE_FILE, null);
  if (!corePayload && !fs.existsSync(LEGACY_WEEKS_DIR)) return null;

  const entries = {};
  if (fs.existsSync(LEGACY_WEEKS_DIR)) {
    for (const file of fs.readdirSync(LEGACY_WEEKS_DIR)) {
      if (!file.endsWith(".json")) continue;
      const week = readJsonFile(path.join(LEGACY_WEEKS_DIR, file), null);
      Object.assign(entries, week?.entries || {});
    }
  }

  return {
    core: corePayload?.core || corePayload || defaultCore,
    entries,
    systemLog: corePayload?.systemLog || [],
    createdAt: corePayload?.createdAt,
  };
}

function loadTracker() {
  const personal = readJsonFile(STATE_FILE, null);
  if (personal) return normalizeState(personal);

  const legacyState = readJsonFile(LEGACY_STATE_FILE, null) || loadLegacyWeeklyState() || {};
  return normalizeState(legacyState);
}

function saveTracker(payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const state = normalizeState({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

module.exports = {
  STATE_FILE,
  emptyEntry,
  loadTracker,
  normalizeState,
  saveTracker,
};
