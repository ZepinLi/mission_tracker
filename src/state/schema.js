import { isoWeekInfo, lastNDates, localDateISO, parseLocalDate } from "../lib/date.js";
import { average, clampNumber, clone } from "../lib/utils.js";
import { normalizeMemoryEdges } from "../memory/graph.js";

export const CORE_VERSION = 2;
export const ENTRY_VERSION = 2;
export const MEMORY_VERSION = 1;

export const MEMORY_TYPES = [
  "recurring_pattern",
  "root_condition",
  "principle",
  "mechanism",
  "open_loop",
  "experiment",
  "identity_signal",
];

export const defaultCore = {
  version: CORE_VERSION,
  mission:
    "Build deep RL insight into products that help real people, while being a present and reliable husband.",
  identities: [
    {
      id: "venture",
      title: "Entrepreneur",
      question: "Did I talk to reality and move a real offer forward?",
      accent: "#b76e1e",
      soft: "#f5ead8",
    },
    {
      id: "research",
      title: "RL Researcher",
      question: "Did I create compounding research evidence today?",
      accent: "#2f5f98",
      soft: "#e2ebf7",
    },
    {
      id: "family",
      title: "Family Man",
      question: "Did my family feel protected, seen, and accompanied?",
      accent: "#1f7a73",
      soft: "#dcefe9",
    },
  ],
  actions: [
    {
      id: "rl_deep_work",
      identityId: "research",
      title: "RL deep work",
      unit: "min",
      minimum: 25,
      target: 90,
      prompt: "Paper, proof, experiment, code, or research memo.",
    },
    {
      id: "research_artifact",
      identityId: "research",
      title: "Research artifact",
      unit: "artifact",
      minimum: 1,
      target: 1,
      prompt: "A saved note, chart, result, derivation, or next hypothesis.",
    },
    {
      id: "reality_contact",
      identityId: "venture",
      title: "Reality contact",
      unit: "person",
      minimum: 1,
      target: 3,
      prompt: "Customer, founder, researcher, investor, or operator.",
    },
    {
      id: "venture_build",
      identityId: "venture",
      title: "Venture build",
      unit: "min",
      minimum: 25,
      target: 75,
      prompt: "Offer, demo, prototype, content, sales, or market map.",
    },
    {
      id: "family_presence",
      identityId: "family",
      title: "Family presence",
      unit: "min",
      minimum: 10,
      target: 60,
      prompt: "Phone away. Conversation, walk, meal, care, or shared plan.",
    },
    {
      id: "wife_companionship",
      identityId: "family",
      title: "Wife companionship",
      unit: "ritual",
      minimum: 1,
      target: 1,
      prompt: "A real check-in, help, date, or uninterrupted time together.",
    },
  ],
};

export function emptyPrinciple() {
  return {
    pattern: "",
    rootCondition: "",
    principle: "",
    mechanism: "",
  };
}

export function normalizePrinciple(principle = {}) {
  return {
    pattern: String(principle?.pattern || ""),
    rootCondition: String(principle?.rootCondition || ""),
    principle: String(principle?.principle || ""),
    mechanism: String(principle?.mechanism || ""),
  };
}

export function createLoopPage(seed = {}, index = 0, fallbackPrinciple = {}) {
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

function normalizeLoopPages(savedEntry = {}) {
  const savedPages = Array.isArray(savedEntry.loopPages) ? savedEntry.loopPages : [];
  const sourcePages = savedPages.length
    ? savedPages
    : [{ id: savedEntry.activeLoopPageId || "loop-page-1", title: "Card 1", principle: savedEntry.principle || {} }];
  return sourcePages.map((page, index) => createLoopPage(page, index, savedEntry.principle || {}));
}

export function createEmptyEntry() {
  const firstPage = createLoopPage({}, 0);
  return {
    version: ENTRY_VERSION,
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

export function normalizeMemoryType(type) {
  const value = String(type || "").trim().toLowerCase();
  return MEMORY_TYPES.includes(value) ? value : "recurring_pattern";
}

export function normalizeMemorySource(source = {}) {
  return {
    date: String(source?.date || ""),
    loopPageId: String(source?.loopPageId || ""),
    analysisId: String(source?.analysisId || ""),
  };
}

export function normalizeMemoryItem(item = {}) {
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

export function normalizeMemory(memory = {}) {
  return {
    version: MEMORY_VERSION,
    items: Array.isArray(memory.items)
      ? memory.items.map(normalizeMemoryItem).filter((item) => item.title.trim() || item.body.trim())
      : [],
    edges: normalizeMemoryEdges(memory.edges),
  };
}

export function mergeCore(savedCore) {
  if (!savedCore || typeof savedCore !== "object") {
    return clone(defaultCore);
  }
  return {
    ...clone(defaultCore),
    ...savedCore,
    version: CORE_VERSION,
    identities: Array.isArray(savedCore.identities)
      ? savedCore.identities.map((identity) => ({
          ...identity,
        }))
      : clone(defaultCore.identities),
    actions: Array.isArray(savedCore.actions)
      ? savedCore.actions.map((action) => ({
          ...action,
        }))
      : clone(defaultCore.actions),
  };
}

export function normalizeEntry(savedEntry) {
  const base = createEmptyEntry();
  if (!savedEntry || typeof savedEntry !== "object") {
    return base;
  }

  const actions = Object.entries(savedEntry.actions || {}).reduce((result, [actionId, record]) => {
    result[actionId] = {
      value: clampNumber(record && record.value),
      note: String((record && record.note) || ""),
    };
    return result;
  }, {});
  const loopPages = normalizeLoopPages(savedEntry);
  const requestedActiveId = String(savedEntry.activeLoopPageId || "");
  const activeLoopPageId = loopPages.some((page) => page.id === requestedActiveId)
    ? requestedActiveId
    : loopPages[0].id;
  const activeLoopPage = loopPages.find((page) => page.id === activeLoopPageId) || loopPages[0];

  return {
    version: ENTRY_VERSION,
    actions,
    keyActions: Object.entries(savedEntry.keyActions || {}).reduce((result, [identityId, value]) => {
      result[identityId] = String(value || "");
      return result;
    }, {}),
    reflection: {
      oneThing: String(savedEntry.reflection?.oneThing || ""),
      avoid: String(savedEntry.reflection?.avoid || ""),
      win: String(savedEntry.reflection?.win || ""),
      lesson: String(savedEntry.reflection?.lesson || ""),
    },
    principle: normalizePrinciple(activeLoopPage.principle),
    loopPages,
    activeLoopPageId,
    aiAnalyses: Array.isArray(savedEntry.aiAnalyses) ? savedEntry.aiAnalyses : [],
  };
}

export function normalizeEntries(savedEntries) {
  return Object.entries(savedEntries || {}).reduce((result, [date, entry]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result[date] = normalizeEntry(entry);
    }
    return result;
  }, {});
}

export function normalizeTrackerState(payload = {}) {
  return {
    core: mergeCore(payload.core),
    entries: normalizeEntries(payload.entries),
    memory: normalizeMemory(payload.memory),
    systemLog: Array.isArray(payload.systemLog) ? payload.systemLog : [],
    createdAt: payload.createdAt || new Date().toISOString(),
  };
}

export function ensureEntry(entries, date) {
  if (!entries[date]) {
    entries[date] = createEmptyEntry();
  }
  entries[date] = normalizeEntry(entries[date]);
  return entries[date];
}

export function ensureActionRecord(entries, date, actionId) {
  const entry = ensureEntry(entries, date);
  if (!entry.actions[actionId]) {
    entry.actions[actionId] = { value: 0, note: "" };
  }
  return entry.actions[actionId];
}

export function getActionRecord(entries, date, actionId) {
  const entry = entries[date];
  if (!entry || !entry.actions || !entry.actions[actionId]) {
    return { value: 0, note: "" };
  }
  return entry.actions[actionId];
}

export function actionsForIdentity(core, identityId) {
  return (core.actions || []).filter((action) => action.identityId === identityId);
}

export function actionScore(action, entries, date) {
  const record = getActionRecord(entries, date, action.id);
  const value = Number(record.value) || 0;
  if (value >= action.target) return 1;
  if (value >= action.minimum) return 0.5;
  return 0;
}

export function identityScore(core, entries, date, identityId) {
  const actions = actionsForIdentity(core, identityId);
  if (!actions.length) return 0;
  return average(actions.map((action) => actionScore(action, entries, date)));
}

export function dayScore(core, entries, date) {
  return average((core.identities || []).map((identity) => identityScore(core, entries, date, identity.id)));
}

export function currentStreak(core, entries) {
  let streak = 0;
  const date = parseLocalDate(localDateISO(new Date()));
  while (streak < 365) {
    const isoDate = localDateISO(date);
    if (dayScore(core, entries, isoDate) < 0.5) break;
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

export function hasVisibleContent(entry) {
  if (!entry) return false;
  const normalized = normalizeEntry(entry);
  const actionHasValue = Object.values(normalized.actions).some((record) => {
    return Number(record.value) > 0 || String(record.note || "").trim();
  });
  if (actionHasValue) return true;
  if (Object.values(normalized.keyActions).some((value) => String(value || "").trim())) return true;
  if (Object.values(normalized.reflection).some((value) => String(value || "").trim())) return true;
  if (Object.values(normalized.principle).some((value) => String(value || "").trim())) return true;
  if ((normalized.loopPages || []).some((page) => {
    return Object.values(page.principle || {}).some((value) => String(value || "").trim());
  })) return true;
  return false;
}

export function compactEntries(entries) {
  return Object.entries(normalizeEntries(entries)).reduce((result, [date, entry]) => {
    if (hasVisibleContent(entry)) {
      result[date] = entry;
    }
    return result;
  }, {});
}

export function groupEntriesByISOWeek(entries) {
  const weeks = new Map();
  for (const [date, entry] of Object.entries(compactEntries(entries))) {
    const info = isoWeekInfo(date);
    if (!weeks.has(info.key)) {
      weeks.set(info.key, {
        schemaVersion: ENTRY_VERSION,
        weekKey: info.key,
        range: {
          start: info.start,
          end: info.end,
        },
        entries: {},
      });
    }
    weeks.get(info.key).entries[date] = normalizeEntry(entry);
  }
  return weeks;
}

export function recentPrinciples(entries) {
  return Object.entries(compactEntries(entries))
    .filter(([, entry]) => {
      return Object.values(entry.principle || {}).some((value) => String(value || "").trim());
    })
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 5);
}

export function lastWeekDates(anchorDate) {
  return lastNDates(anchorDate, 7);
}
