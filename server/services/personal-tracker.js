const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("../utils");

const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "personal-tracker.json");
const LEGACY_STATE_FILE = path.join(DATA_DIR, "mission-tracker-state.json");
const LEGACY_CORE_FILE = path.join(DATA_DIR, "core.json");
const LEGACY_WEEKS_DIR = path.join(DATA_DIR, "weeks");
const MEMORY_TYPES = [
  "recurring_pattern",
  "root_condition",
  "principle",
  "mechanism",
  "open_loop",
  "experiment",
  "identity_signal",
];

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

function emptyPrinciple() {
  return {
    pattern: "",
    rootCondition: "",
    principle: "",
    mechanism: "",
  };
}

function normalizePrinciple(principle = {}) {
  return {
    pattern: String(principle?.pattern || ""),
    rootCondition: String(principle?.rootCondition || ""),
    principle: String(principle?.principle || ""),
    mechanism: String(principle?.mechanism || ""),
  };
}

function createLoopPage(seed = {}, index = 0, fallbackPrinciple = {}) {
  const cardNumber = index + 1;
  return {
    id: String(seed.id || "loop-page-" + cardNumber),
    cardNumber,
    title: String(seed.title || "Card " + cardNumber),
    createdAt: String(seed.createdAt || ""),
    updatedAt: String(seed.updatedAt || ""),
    principle: normalizePrinciple(seed.principle || fallbackPrinciple),
  };
}

function normalizeLoopPages(entry = {}) {
  const savedPages = Array.isArray(entry.loopPages) ? entry.loopPages : [];
  const sourcePages = savedPages.length
    ? savedPages
    : [{ id: entry.activeLoopPageId || "loop-page-1", title: "Card 1", principle: entry.principle || {} }];
  return sourcePages.map((page, index) => createLoopPage(page, index, entry.principle || {}));
}

function emptyEntry() {
  const firstPage = createLoopPage({}, 0);
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
    principle: normalizePrinciple(firstPage.principle),
    loopPages: [firstPage],
    activeLoopPageId: firstPage.id,
    aiAnalyses: [],
  };
}

function normalizeMemoryType(type) {
  const value = String(type || "").trim().toLowerCase();
  return MEMORY_TYPES.includes(value) ? value : "recurring_pattern";
}

function normalizeMemorySource(source = {}) {
  return {
    date: String(source?.date || ""),
    loopPageId: String(source?.loopPageId || ""),
    analysisId: String(source?.analysisId || ""),
  };
}

function normalizeMemoryItem(item = {}) {
  const confidence = Number(item.confidence);
  return {
    id: String(item.id || "memory-" + Date.now()),
    type: normalizeMemoryType(item.type),
    title: String(item.title || ""),
    body: String(item.body || ""),
    source: normalizeMemorySource(item.source),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    status: String(item.status || "accepted"),
    createdAt: String(item.createdAt || ""),
    updatedAt: String(item.updatedAt || ""),
  };
}

function normalizeMemory(memory = {}) {
  return {
    version: 1,
    items: Array.isArray(memory.items)
      ? memory.items.map(normalizeMemoryItem).filter((item) => item.title.trim() || item.body.trim())
      : [],
  };
}

function normalizeEntry(entry = {}) {
  const loopPages = normalizeLoopPages(entry);
  const requestedActiveId = String(entry.activeLoopPageId || "");
  const activeLoopPageId = loopPages.some((page) => page.id === requestedActiveId)
    ? requestedActiveId
    : loopPages[0].id;
  const activeLoopPage = loopPages.find((page) => page.id === activeLoopPageId) || loopPages[0];

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
    principle: normalizePrinciple(activeLoopPage.principle),
    loopPages,
    activeLoopPageId,
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
    memory: normalizeMemory(payload.memory),
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
