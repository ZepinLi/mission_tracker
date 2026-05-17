import { formatShortDate, localDateISO, parseLocalDate } from "./lib/date.js";
import { ensureEntry, mergeCore, normalizeTrackerState } from "./state/schema.js";

const SAVE_DELAY_MS = 700;

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push("<h3>" + escapeHTML(heading[1]) + "</h3>");
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push("<li>" + escapeHTML(bullet[1]) + "</li>");
      continue;
    }
    closeList();
    html.push("<p>" + escapeHTML(trimmed) + "</p>");
  }
  closeList();
  return html.join("");
}

export class MissionTrackerController {
  constructor({ dom, repository }) {
    this.dom = dom;
    this.repository = repository;
    this.state = normalizeTrackerState({});
    this.selectedDate = localDateISO(new Date());
    this.saveTimer = null;
    this.isDirty = false;
    this.isSaving = false;
    this.aiConfig = { defaultModel: "gpt-5.2", defaultReasoningEffort: "high", hasApiKey: false };
    this.currentAnalysis = null;
    this.saveStatusTimer = null;
  }

  async init() {
    this.bindEvents();
    this.dom.datePicker.value = this.selectedDate;
    this.setSaveStatus("Loading...");

    try {
      const [state, aiConfig] = await Promise.all([
        this.repository.loadTracker(),
        this.repository.loadAiConfig().catch(() => null),
      ]);
      this.state = normalizeTrackerState(state);
      this.aiConfig = aiConfig || this.aiConfig;
      this.dom.aiModelInput.value = this.aiConfig.defaultModel || "gpt-5.2";
      this.dom.aiEffortSelect.value = this.aiConfig.defaultReasoningEffort || "high";
      ensureEntry(this.state.entries, this.selectedDate);
      this.isDirty = false;
      this.render();
      this.setSaveStatus("Saved locally");
      this.setAiStatus(
        this.aiConfig.hasApiKey ? "AI ready" : "Missing OPENAI_API_KEY",
        this.aiConfig.hasApiKey ? "ready" : "error"
      );
    } catch (error) {
      this.state = normalizeTrackerState({});
      ensureEntry(this.state.entries, this.selectedDate);
      this.render();
      this.setSaveStatus("Could not save", "error");
      this.setAiStatus("AI unavailable", "error");
    }
  }

  bindEvents() {
    this.dom.previousDay.addEventListener("click", () => this.shiftDay(-1));
    this.dom.nextDay.addEventListener("click", () => this.shiftDay(1));
    this.dom.todayButton.addEventListener("click", () => this.setSelectedDate(localDateISO(new Date())));
    this.dom.datePicker.addEventListener("change", (event) => this.setSelectedDate(event.target.value));
    this.dom.analyzeButton.addEventListener("click", () => this.analyzeWithAi());
    this.dom.aiChatButton.addEventListener("click", () => this.chatWithAi());
    this.dom.saveAnalysisButton.addEventListener("click", () => this.saveCurrentAnalysis());
    this.dom.aiOutput.addEventListener("input", () => {
      this.handleManualAnalysisInput();
      this.setSaveStatus("Unsaved", "dirty");
    });
    this.dom.manualSaveIsland.addEventListener("click", () => this.manualSaveAll());

    const bindings = [
      [this.dom.signalInput, (entry, value) => { entry.principle.pattern = value; }],
      [this.dom.rootConditionInput, (entry, value) => { entry.principle.rootCondition = value; }],
      [this.dom.principleInput, (entry, value) => { entry.principle.principle = value; }],
      [this.dom.mechanismInput, (entry, value) => { entry.principle.mechanism = value; }],
      [this.dom.ventureActionInput, (entry, value) => { entry.keyActions.venture = value; }],
      [this.dom.researchActionInput, (entry, value) => { entry.keyActions.research = value; }],
      [this.dom.familyActionInput, (entry, value) => { entry.keyActions.family = value; }],
    ];

    for (const [element, assign] of bindings) {
      element.addEventListener("input", (event) => {
        assign(this.currentEntry(), event.target.value);
        this.markDirty();
      });
    }
  }

  currentEntry() {
    return ensureEntry(this.state.entries, this.selectedDate);
  }

  markDirty() {
    this.isDirty = true;
    this.setSaveStatus("Unsaved", "dirty");
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveNow();
    }, SAVE_DELAY_MS);
  }

  async saveNow(options = {}) {
    const force = Boolean(options.force);
    const manual = Boolean(options.manual);
    if ((!this.isDirty && !force) || this.isSaving) return;
    window.clearTimeout(this.saveTimer);
    this.isSaving = true;
    this.setSaveStatus("Saving...", "saving");

    try {
      const saved = await this.repository.saveTracker({
        ...this.state,
        core: mergeCore(this.state.core),
        updatedAt: new Date().toISOString(),
      });
      this.state = normalizeTrackerState(saved);
      ensureEntry(this.state.entries, this.selectedDate);
      this.isDirty = false;
      this.setSaveStatus(manual ? "Saved now" : "Saved locally");
      if (manual) this.scheduleSavedReset();
    } catch (error) {
      this.setSaveStatus("Could not save", "error");
    } finally {
      this.isSaving = false;
    }
  }

  recentEntries() {
    const dates = Object.keys(this.state.entries || {})
      .filter((date) => date <= this.selectedDate)
      .sort()
      .slice(-7);
    return dates.reduce((result, date) => {
      result[date] = this.state.entries[date];
      return result;
    }, {});
  }

  async analyzeWithAi() {
    await this.saveNow();
    this.setAiStatus("AI thinking...", "thinking");
    this.dom.analyzeButton.disabled = true;
    this.dom.saveAnalysisButton.disabled = true;

    try {
      this.currentAnalysis = await this.repository.analyzeWithAi({
        date: this.selectedDate,
        model: this.dom.aiModelInput.value,
        reasoningEffort: this.dom.aiEffortSelect.value,
        entry: this.currentEntry(),
        recentEntries: this.recentEntries(),
        core: this.state.core,
      });
      this.renderAiOutput();
      this.setAiStatus("Analysis ready");
      this.dom.saveAnalysisButton.disabled = false;
    } catch (error) {
      this.renderAiError(error.message || "AI unavailable");
      this.setAiStatus(error.status === 400 ? "Missing OPENAI_API_KEY" : "AI unavailable", "error");
    } finally {
      this.dom.analyzeButton.disabled = false;
    }
  }

  async chatWithAi() {
    const userMessage = this.dom.aiChatInput.value.trim();
    this.ensureDraftAnalysis();
    if (!userMessage || !this.currentAnalysis) return;
    this.setAiStatus("AI thinking...", "thinking");
    this.dom.aiChatButton.disabled = true;

    try {
      const result = await this.repository.chatWithAi({
        date: this.selectedDate,
        model: this.dom.aiModelInput.value,
        reasoningEffort: this.dom.aiEffortSelect.value,
        entry: this.currentEntry(),
        analysis: this.currentAnalysis.analysisText,
        messages: this.currentAnalysis.messages || [],
        userMessage,
      });
      this.currentAnalysis = {
        ...this.currentAnalysis,
        analysisText: this.currentAnalysis.analysisText + "\n\n### Follow-up\n" + result.message,
        messages: result.messages,
      };
      this.dom.aiChatInput.value = "";
      this.renderAiOutput();
      this.setAiStatus("Analysis ready");
      this.dom.saveAnalysisButton.disabled = false;
    } catch (error) {
      this.renderAiError(error.message || "AI unavailable");
      this.setAiStatus(error.status === 400 ? "Missing OPENAI_API_KEY" : "AI unavailable", "error");
    } finally {
      this.dom.aiChatButton.disabled = false;
    }
  }

  async saveCurrentAnalysis() {
    this.ensureDraftAnalysis();
    if (!this.currentAnalysis) return;
    this.mergeCurrentAnalysisIntoEntry();
    this.isDirty = true;
    await this.saveNow();
    this.renderAnalysisList();
    this.setAiStatus("Analysis saved");
  }

  mergeCurrentAnalysisIntoEntry() {
    this.ensureDraftAnalysis();
    if (!this.currentAnalysis) return false;
    const entry = this.currentEntry();
    const existing = Array.isArray(entry.aiAnalyses) ? entry.aiAnalyses : [];
    entry.aiAnalyses = [this.currentAnalysis, ...existing.filter((item) => item.id !== this.currentAnalysis.id)].slice(0, 20);
    return true;
  }

  async manualSaveAll() {
    this.mergeCurrentAnalysisIntoEntry();
    this.isDirty = true;
    await this.saveNow({ force: true, manual: true });
    this.renderAnalysisList();
  }

  async setSelectedDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return;
    await this.saveNow();
    this.selectedDate = date;
    this.currentAnalysis = null;
    ensureEntry(this.state.entries, this.selectedDate);
    this.dom.datePicker.value = this.selectedDate;
    this.render();
  }

  shiftDay(delta) {
    const date = parseLocalDate(this.selectedDate);
    date.setDate(date.getDate() + delta);
    this.setSelectedDate(localDateISO(date));
  }

  render() {
    const entry = this.currentEntry();
    const principle = entry.principle || {};
    const keyActions = entry.keyActions || {};

    this.dom.selectedDateLabel.textContent = formatShortDate(this.selectedDate);
    this.dom.datePicker.value = this.selectedDate;
    this.dom.signalInput.value = principle.pattern || "";
    this.dom.rootConditionInput.value = principle.rootCondition || "";
    this.dom.principleInput.value = principle.principle || "";
    this.dom.mechanismInput.value = principle.mechanism || "";
    this.dom.ventureActionInput.value = keyActions.venture || "";
    this.dom.researchActionInput.value = keyActions.research || "";
    this.dom.familyActionInput.value = keyActions.family || "";
    this.renderAnalysisList();
    if (!this.currentAnalysis) {
      this.dom.aiOutput.value = "";
    }
  }

  handleManualAnalysisInput() {
    const text = this.dom.aiOutput.value.trim();
    if (!text) {
      this.currentAnalysis = null;
      return;
    }
    const createdAt = new Date().toISOString();
    this.currentAnalysis = {
      id: this.currentAnalysis?.id || "manual-" + Date.now(),
      createdAt: this.currentAnalysis?.createdAt || createdAt,
      model: this.currentAnalysis?.model || "manual / external",
      reasoningEffort: this.currentAnalysis?.reasoningEffort || "manual",
      promptType: this.currentAnalysis?.promptType || "manual-dynamics-analysis",
      inputSummary: this.currentAnalysis?.inputSummary || {},
      analysisText: text,
      messages: this.currentAnalysis?.messages || [],
    };
  }

  ensureDraftAnalysis() {
    this.handleManualAnalysisInput();
  }

  renderAiOutput() {
    if (!this.currentAnalysis) return;
    this.dom.aiOutput.value = this.currentAnalysis.analysisText || "";
  }

  renderAiError(message) {
    this.dom.aiOutput.value = [
      this.dom.aiOutput.value.trim(),
      "AI unavailable: " + message,
    ].filter(Boolean).join("\n\n");
    this.handleManualAnalysisInput();
  }

  renderAnalysisList() {
    const analyses = this.currentEntry().aiAnalyses || [];
    if (!analyses.length) {
      this.dom.analysisList.innerHTML = '<p class="muted-copy">No saved AI analyses for this date.</p>';
      return;
    }
    this.dom.analysisList.innerHTML = analyses.map((analysis) => {
      const created = analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : "Saved analysis";
      const text = String(analysis.analysisText || "");
      return [
        '<article class="analysis-card">',
        '<div>',
        '<strong>' + escapeHTML(analysis.model || "AI model") + '</strong>',
        '<span>' + escapeHTML(created) + '</span>',
        '</div>',
        '<p>' + escapeHTML(text.slice(0, 220)) + (text.length > 220 ? '...' : '') + '</p>',
        '</article>',
      ].join("");
    }).join("");
  }

  setSaveStatus(message, state = "saved") {
    this.dom.saveStatus.textContent = message;
    this.dom.saveStatus.className = ("save-status " + (state === "saved" ? "" : state)).trim();

    const islandLabel = state === "dirty" ? "Unsaved" : state === "saving" ? "Saving" : state === "error" ? "Retry" : message === "Saved now" ? "Saved now" : "Saved";
    this.dom.manualSaveLabel.textContent = islandLabel;
    this.dom.manualSaveIsland.dataset.state = state;
    this.dom.manualSaveIsland.disabled = state === "saving";
  }

  scheduleSavedReset() {
    window.clearTimeout(this.saveStatusTimer);
    this.saveStatusTimer = window.setTimeout(() => {
      if (!this.isDirty && !this.isSaving) {
        this.setSaveStatus("Saved locally");
      }
    }, 1400);
  }

  setAiStatus(message, state = "ready") {
    this.dom.aiStatus.textContent = message;
    this.dom.aiStatus.className = ("ai-status " + (state === "ready" ? "" : state)).trim();
  }
}
