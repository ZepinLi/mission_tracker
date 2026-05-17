const { randomId, nowIso } = require("../utils");

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function configuredModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function configuredBaseUrl() {
  return String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
}

function configuredReasoningEffort() {
  return sanitizeReasoningEffort(process.env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT);
}

function config() {
  return {
    defaultModel: configuredModel(),
    defaultReasoningEffort: configuredReasoningEffort(),
    baseUrl: configuredBaseUrl(),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
  };
}

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY. Add it to .env and restart the local app.");
    error.status = 400;
    error.code = "missing_openai_api_key";
    throw error;
  }
  return process.env.OPENAI_API_KEY;
}

function sanitizeModel(model) {
  return String(model || configuredModel()).trim() || configuredModel();
}

function sanitizeReasoningEffort(effort) {
  const value = String(effort || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  return ["low", "medium", "high"].includes(value) ? value : DEFAULT_REASONING_EFFORT;
}

function pickEntrySummary(entry = {}) {
  const principle = entry.principle || {};
  const keyActions = entry.keyActions || {};
  return {
    signalMistake: String(principle.pattern || ""),
    rootCondition: String(principle.rootCondition || ""),
    principle: String(principle.principle || ""),
    mechanismNextMove: String(principle.mechanism || ""),
    ambitionAnchors: {
      entrepreneur: String(keyActions.venture || ""),
      rlResearch: String(keyActions.research || ""),
      family: String(keyActions.family || ""),
    },
  };
}

function recentContext(recentEntries = {}) {
  return Object.entries(recentEntries || {})
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 7)
    .map(([date, entry]) => ({
      date,
      ...pickEntrySummary(entry),
    }));
}

function dynamicsInstructions() {
  return [
    "You are an AI dynamics model for a local personal No Second Mistake system.",
    "Treat the user's record as signals from a personal dynamics system, not as moral failure.",
    "Analyze causal structure, incentives, friction, feedback loops, environment design, and next experiment.",
    "Be concrete, non-moralizing, and action-oriented.",
    "Do not provide therapy, medical, legal, or financial claims.",
    "Return concise Markdown with exactly these sections: State, Forces, Likely Trajectory, Intervention, Next Experiment.",
  ].join("\n");
}

function analysisInput({ date, entry, recentEntries, core }) {
  return [
    { role: "developer", content: dynamicsInstructions() },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "Build a practical dynamics-model analysis for this daily No Second Mistake record.",
          date,
          mission: core?.mission || "Turn each mistake into a better system.",
          today: pickEntrySummary(entry),
          recentContext: recentContext(recentEntries),
        },
        null,
        2
      ),
    },
  ];
}

function chatInput({ date, entry, analysis, messages, userMessage }) {
  return [
    {
      role: "developer",
      content: [
        dynamicsInstructions(),
        "Continue the conversation. Answer the user's follow-up while preserving the dynamics-model frame.",
        "When useful, update the action implication explicitly.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          date,
          today: pickEntrySummary(entry),
          currentAnalysis: analysis || "",
          previousMessages: (messages || []).slice(-10),
          followUp: String(userMessage || ""),
        },
        null,
        2
      ),
    },
  ];
}

function normalizeOutput(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const pieces = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) pieces.push(content.text);
      if (content.type === "text" && content.text) pieces.push(content.text);
    }
  }
  return pieces.join("\n").trim();
}

function parseSseResponse(text) {
  const pieces = [];
  let completedText = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(raw);
    } catch (_error) {
      continue;
    }
    if (event.type === "response.output_text.delta" && event.delta) {
      pieces.push(event.delta);
    }
    if (event.type === "response.output_text.done" && event.text) {
      completedText = event.text;
    }
    if (event.type === "response.completed") {
      const normalized = normalizeOutput(event.response || {});
      if (normalized) completedText = normalized;
    }
  }
  return completedText || pieces.join("").trim();
}

function parseOpenAiResponseText(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("event:")) {
    return { payload: null, outputText: parseSseResponse(trimmed) };
  }
  const payload = trimmed ? JSON.parse(trimmed) : {};
  return { payload, outputText: normalizeOutput(payload) };
}

async function callOpenAI({ model, reasoningEffort, input }) {
  const apiKey = requireApiKey();
  const response = await fetch(configuredBaseUrl() + "/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: sanitizeModel(model),
      input,
      reasoning: { effort: sanitizeReasoningEffort(reasoningEffort) },
    }),
  });
  const text = await response.text();
  const { payload, outputText } = parseOpenAiResponseText(text);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || outputText || "AI request failed.");
    error.status = response.status;
    error.code = payload?.error?.code || "openai_request_failed";
    throw error;
  }
  return outputText || "No analysis returned.";
}

async function analyze(payload = {}) {
  const model = sanitizeModel(payload.model);
  const reasoningEffort = sanitizeReasoningEffort(payload.reasoningEffort);
  const analysisText = await callOpenAI({ model, reasoningEffort, input: analysisInput(payload) });
  const createdAt = nowIso();
  return {
    id: randomId(),
    createdAt,
    model,
    reasoningEffort,
    promptType: "dynamics-analysis",
    inputSummary: pickEntrySummary(payload.entry),
    analysisText,
    messages: [{ role: "assistant", content: analysisText, createdAt }],
  };
}

async function chat(payload = {}) {
  const model = sanitizeModel(payload.model);
  const reasoningEffort = sanitizeReasoningEffort(payload.reasoningEffort);
  const message = await callOpenAI({ model, reasoningEffort, input: chatInput(payload) });
  const nextMessages = [
    ...(Array.isArray(payload.messages) ? payload.messages : []),
    { role: "user", content: String(payload.userMessage || ""), createdAt: nowIso() },
    { role: "assistant", content: message, createdAt: nowIso() },
  ];
  return { message, messages: nextMessages };
}

module.exports = {
  analysisInput,
  analyze,
  chat,
  config,
  parseSseResponse,
  pickEntrySummary,
  sanitizeReasoningEffort,
};
