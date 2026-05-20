import { formatShortDate, localDateISO, parseLocalDate } from "./lib/date.js";
import { buildMemoryGraph, buildDeterministicEdges, memoryTypeLabel, normalizeMemoryEdges } from "./memory/graph.js";
import { createLoopPage, ensureEntry, mergeCore, normalizeMemoryItem, normalizeTrackerState } from "./state/schema.js";
import { escapeHTML, markdownToHtml, markdownToPlainText } from "./ui/markdown.js";

const SAVE_DELAY_MS = 700;
const MEMORY_TYPE_VALUES = [
  "recurring_pattern",
  "root_condition",
  "principle",
  "mechanism",
  "open_loop",
  "experiment",
  "identity_signal",
];

function clippedText(value, fallback = "No detail yet.") {
  const text = String(value || "").trim();
  return text || fallback;
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
    this.previousFocus = null;
    this.cardMotionTimer = null;
    this.isLoopSpread = false;
    this.isAnalysisSpread = false;
    this.activeAnalysisId = "";
    this.readerAnalysisId = "";
    this.memoryCandidates = [];
    this.memoryView = "cards";
    this.graphScope = "current";
    this.graphType = "all";
    this.selectedMemoryId = "";
    this.graphViewBox = { x: 0, y: 0, width: 840, height: 520 };
    this.draggedMemoryId = "";
    this.graphPanStart = null;
    this.memoryNodePositions = new Map();
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
    this.dom.extractMemoryButton.addEventListener("click", () => this.extractMemoryCandidates());
    this.dom.toggleAnalysisSpread.addEventListener("click", () => this.toggleAnalysisSpread());
    this.dom.aiOutput.addEventListener("input", () => {
      this.handleManualAnalysisInput();
      this.setSaveStatus("Unsaved", "dirty");
    });
    this.dom.manualSaveIsland.addEventListener("click", () => this.manualSaveAll());
    this.dom.previousLoopPage.addEventListener("click", () => this.shiftLoopPage(-1));
    this.dom.nextLoopPage.addEventListener("click", () => this.shiftLoopPage(1));
    this.dom.addLoopPage.addEventListener("click", () => this.addLoopPage());
    this.dom.deleteLoopPage.addEventListener("click", () => this.deleteActiveLoopPage());
    this.dom.toggleLoopSpread.addEventListener("click", () => this.toggleLoopSpread());
    this.dom.loopSpreadList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-loop-page-id]");
      if (card) this.selectLoopPageFromSpread(card.dataset.loopPageId);
    });
    this.dom.loopSpreadList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-loop-page-id]");
      if (!card) return;
      event.preventDefault();
      this.selectLoopPageFromSpread(card.dataset.loopPageId);
    });
    this.dom.journalPanel.addEventListener("click", (event) => {
      if (!this.isLoopSpread) return;
      if (event.target.closest(".loop-card-controls, .loop-spread-tray, textarea, button, input")) return;
      this.toggleLoopSpread(false);
    });
    this.dom.analysisList.addEventListener("click", (event) => {
      if (event.target.closest("[data-analysis-prev]")) {
        this.shiftActiveAnalysis(-1);
        return;
      }
      if (event.target.closest("[data-analysis-next]")) {
        this.shiftActiveAnalysis(1);
        return;
      }
      if (event.target.closest("[data-toggle-analysis-spread]")) {
        this.toggleAnalysisSpread();
        return;
      }
      const select = event.target.closest("[data-select-analysis]");
      if (select) {
        this.setActiveAnalysis(select.dataset.selectAnalysis, true);
        return;
      }
      const trigger = event.target.closest("[data-open-analysis]");
      if (trigger) this.openAnalysisReader(trigger.dataset.openAnalysis);
    });
    this.dom.analysisList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest("[data-open-analysis]");
      if (!trigger) return;
      event.preventDefault();
      this.openAnalysisReader(trigger.dataset.openAnalysis);
    });
    this.dom.analysisModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-analysis]")) this.closeAnalysisReader();
    });
    this.dom.analysisReaderNav.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-reader-analysis]");
      if (trigger) this.openAnalysisReader(trigger.dataset.readerAnalysis);
    });
    this.dom.previousAnalysisReader.addEventListener("click", () => this.shiftAnalysisReader(-1));
    this.dom.nextAnalysisReader.addEventListener("click", () => this.shiftAnalysisReader(1));
    this.dom.memoryCandidateList.addEventListener("click", (event) => {
      const accept = event.target.closest("[data-accept-memory]");
      const reject = event.target.closest("[data-reject-memory]");
      if (accept) this.acceptMemoryCandidate(accept.dataset.acceptMemory);
      if (reject) this.rejectMemoryCandidate(reject.dataset.rejectMemory);
    });
    this.dom.memoryCandidateList.addEventListener("input", (event) => {
      const field = event.target.closest("[data-memory-candidate-field]");
      if (!field) return;
      this.updateMemoryCandidateField(
        field.dataset.memoryCandidateId,
        field.dataset.memoryCandidateField,
        field.value
      );
    });
    this.dom.memoryCardsView.addEventListener("click", () => this.setMemoryView("cards"));
    this.dom.memoryGraphView.addEventListener("click", () => this.setMemoryView("graph"));
    this.dom.memoryScopeSelect.addEventListener("change", (event) => {
      this.graphScope = event.target.value;
      this.selectedMemoryId = "";
      this.renderMemoryPanel();
    });
    this.dom.memoryTypeFilter.addEventListener("change", (event) => {
      this.graphType = event.target.value;
      this.selectedMemoryId = "";
      this.renderMemoryPanel();
    });
    this.dom.memoryGraphSvg.addEventListener("click", (event) => {
      const node = event.target.closest("[data-memory-node]");
      if (node) this.selectMemoryNode(node.dataset.memoryNode);
    });
    this.dom.memoryGraphSvg.addEventListener("pointerdown", (event) => this.handleGraphPointerDown(event));
    this.dom.memoryGraphSvg.addEventListener("pointermove", (event) => this.handleGraphPointerMove(event));
    this.dom.memoryGraphSvg.addEventListener("pointerup", () => this.stopGraphDrag());
    this.dom.memoryGraphSvg.addEventListener("pointerleave", () => this.stopGraphDrag());
    this.dom.memoryGraphSvg.addEventListener("wheel", (event) => this.zoomGraph(event), { passive: false });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.dom.analysisModal.hidden) this.closeAnalysisReader();
    });

    const loopBindings = [
      [this.dom.signalInput, (principle, value) => { principle.pattern = value; }],
      [this.dom.rootConditionInput, (principle, value) => { principle.rootCondition = value; }],
      [this.dom.principleInput, (principle, value) => { principle.principle = value; }],
      [this.dom.mechanismInput, (principle, value) => { principle.mechanism = value; }],
    ];
    const actionBindings = [
      [this.dom.ventureActionInput, (entry, value) => { entry.keyActions.venture = value; }],
      [this.dom.researchActionInput, (entry, value) => { entry.keyActions.research = value; }],
      [this.dom.familyActionInput, (entry, value) => { entry.keyActions.family = value; }],
    ];

    for (const [element, assign] of loopBindings) {
      element.addEventListener("input", (event) => {
        this.updateActiveLoopPage((principle) => assign(principle, event.target.value));
        this.markDirty();
      });
    }
    for (const [element, assign] of actionBindings) {
      element.addEventListener("input", (event) => {
        assign(this.currentEntry(), event.target.value);
        this.markDirty();
      });
    }
  }

  currentEntry() {
    return ensureEntry(this.state.entries, this.selectedDate);
  }

  activeLoopPage(entry = this.currentEntry()) {
    if (!Array.isArray(entry.loopPages) || !entry.loopPages.length) {
      const firstPage = createLoopPage({ principle: entry.principle || {} }, 0);
      entry.loopPages = [firstPage];
      entry.activeLoopPageId = firstPage.id;
    }
    let page = entry.loopPages.find((item) => item.id === entry.activeLoopPageId);
    if (!page) {
      page = entry.loopPages[0];
      entry.activeLoopPageId = page.id;
    }
    return page;
  }

  activeLoopPageIndex(entry = this.currentEntry()) {
    const page = this.activeLoopPage(entry);
    return Math.max(0, entry.loopPages.findIndex((item) => item.id === page.id));
  }

  syncLegacyPrinciple(entry = this.currentEntry()) {
    this.renumberLoopPages(entry);
    const page = this.activeLoopPage(entry);
    entry.principle = { ...page.principle };
    return page;
  }

  renumberLoopPages(entry = this.currentEntry()) {
    entry.loopPages = (entry.loopPages || []).map((page, index) => ({
      ...page,
      cardNumber: index + 1,
      title: page.title || "Card " + (index + 1),
    }));
  }

  updateActiveLoopPage(assign) {
    const entry = this.currentEntry();
    const page = this.activeLoopPage(entry);
    assign(page.principle, page, entry);
    page.updatedAt = new Date().toISOString();
    this.syncLegacyPrinciple(entry);
  }

  setActiveLoopPage(pageId, motion = "slide") {
    const entry = this.currentEntry();
    const page = entry.loopPages.find((item) => item.id === pageId);
    if (!page || page.id === entry.activeLoopPageId) return;
    entry.activeLoopPageId = page.id;
    this.syncLegacyPrinciple(entry);
    this.currentAnalysis = null;
    this.activeAnalysisId = "";
    this.memoryCandidates = [];
    this.markDirty();
    this.render(motion);
  }

  shiftLoopPage(delta) {
    const entry = this.currentEntry();
    const pages = entry.loopPages || [];
    if (pages.length < 2) return;
    const currentIndex = this.activeLoopPageIndex(entry);
    const nextIndex = (currentIndex + delta + pages.length) % pages.length;
    this.setActiveLoopPage(pages[nextIndex].id, delta > 0 ? "next" : "previous");
  }

  addLoopPage() {
    const entry = this.currentEntry();
    const now = new Date().toISOString();
    const nextIndex = (entry.loopPages || []).length;
    const page = createLoopPage({
      id: "loop-page-" + Date.now(),
      title: "Card " + (nextIndex + 1),
      createdAt: now,
      updatedAt: now,
    }, nextIndex);
    entry.loopPages = [...(entry.loopPages || []), page];
    entry.activeLoopPageId = page.id;
    this.isLoopSpread = false;
    this.syncLegacyPrinciple(entry);
    this.currentAnalysis = null;
    this.activeAnalysisId = "";
    this.memoryCandidates = [];
    this.markDirty();
    this.render("deal");
  }

  deleteActiveLoopPage() {
    const entry = this.currentEntry();
    const pages = entry.loopPages || [];
    if (pages.length <= 1) return;
    const currentIndex = this.activeLoopPageIndex(entry);
    const removedId = this.activeLoopPage(entry).id;
    entry.loopPages = pages.filter((page) => page.id !== removedId);
    this.renumberLoopPages(entry);
    const nextIndex = Math.min(currentIndex, entry.loopPages.length - 1);
    entry.activeLoopPageId = entry.loopPages[nextIndex].id;
    this.isLoopSpread = false;
    this.syncLegacyPrinciple(entry);
    this.currentAnalysis = null;
    this.activeAnalysisId = "";
    this.memoryCandidates = [];
    this.markDirty();
    this.render("delete");
  }

  toggleLoopSpread(force) {
    this.isLoopSpread = typeof force === "boolean" ? force : !this.isLoopSpread;
    this.render(this.isLoopSpread ? "spread" : "stack");
  }

  selectLoopPageFromSpread(pageId) {
    const entry = this.currentEntry();
    const page = entry.loopPages.find((item) => item.id === pageId);
    if (!page) return;
    entry.activeLoopPageId = page.id;
    this.isLoopSpread = false;
    this.syncLegacyPrinciple(entry);
    this.currentAnalysis = null;
    this.activeAnalysisId = "";
    this.memoryCandidates = [];
    this.markDirty();
    this.render("spread-select");
  }

  renderCardMotion(motion) {
    if (!this.dom.journalPanel) return;
    window.clearTimeout(this.cardMotionTimer);
    this.dom.journalPanel.dataset.motion = motion || "idle";
    if (motion && motion !== "idle") {
      this.cardMotionTimer = window.setTimeout(() => {
        this.dom.journalPanel.dataset.motion = "idle";
      }, 360);
    }
  }

  loopPreviewText(page) {
    const principle = page.principle || {};
    const signal = String(principle.pattern || "").trim();
    const rule = String(principle.principle || "").trim();
    return {
      signal: signal || "No signal yet.",
      principle: rule || "No principle yet.",
    };
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

    this.syncLegacyPrinciple(this.currentEntry());
    if (this.state.memory?.items?.length) this.refreshMemoryEdges();

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

  compactMemoryForAi() {
    const items = Array.isArray(this.state.memory?.items) ? this.state.memory.items : [];
    return {
      version: this.state.memory?.version || 1,
      items: items
        .filter((item) => String(item.status || "accepted") === "accepted")
        .slice(0, 24)
        .map((item) => ({
          type: item.type,
          title: item.title,
          body: item.body,
          confidence: item.confidence,
          source: item.source,
        })),
    };
  }

  currentMemorySource() {
    const page = this.activeLoopPage();
    return {
      date: this.selectedDate,
      loopPageId: page.id,
      analysisId: this.currentAnalysis?.id || "",
    };
  }

  async analyzeWithAi() {
    this.syncLegacyPrinciple(this.currentEntry());
    await this.saveNow();
    this.setAiStatus("AI thinking...", "thinking");
    this.dom.analyzeButton.disabled = true;
    this.dom.saveAnalysisButton.disabled = true;

    try {
      const page = this.activeLoopPage();
      const result = await this.repository.analyzeWithAi({
        date: this.selectedDate,
        model: this.dom.aiModelInput.value,
        reasoningEffort: this.dom.aiEffortSelect.value,
        entry: this.currentEntry(),
        recentEntries: this.recentEntries(),
        memoryContext: this.compactMemoryForAi(),
        core: this.state.core,
      });
      this.currentAnalysis = {
        ...result,
        loopPageId: page.id,
        inputSummary: {
          ...(result.inputSummary || {}),
          loopPageId: page.id,
          loopCard: this.activeLoopPageIndex() + 1,
        },
      };
      this.renderAiOutput();
      this.setAiStatus("Analysis ready");
      this.dom.saveAnalysisButton.disabled = false;
      await this.extractMemoryCandidates({ auto: true, mergeAnalysis: false });
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
        memoryContext: this.compactMemoryForAi(),
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
    await this.extractMemoryCandidates({ auto: true, mergeAnalysis: false });
  }

  async extractMemoryCandidates(options = {}) {
    const auto = Boolean(options.auto);
    const mergeAnalysis = options.mergeAnalysis !== false;
    this.ensureDraftAnalysis();
    if (mergeAnalysis && this.mergeCurrentAnalysisIntoEntry()) {
      this.isDirty = true;
    }
    if (!auto) await this.saveNow();
    this.setMemoryStatus("Extracting memory...", "thinking");
    this.dom.extractMemoryButton.disabled = true;

    try {
      const result = await this.repository.extractMemory({
        date: this.selectedDate,
        model: this.dom.aiModelInput.value,
        reasoningEffort: this.dom.aiEffortSelect.value,
        entry: this.currentEntry(),
        analysis: this.currentAnalysis?.analysisText || this.dom.aiOutput.value,
        recentEntries: this.recentEntries(),
        memoryContext: this.compactMemoryForAi(),
        core: this.state.core,
        source: this.currentMemorySource(),
      });
      this.mergeMemoryCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      this.renderMemoryPanel();
      this.setMemoryStatus(this.memoryCandidates.length ? "Review candidates" : "No durable memory found");
    } catch (error) {
      this.setMemoryStatus(
        error.status === 400 ? "Missing OPENAI_API_KEY" : auto ? "Memory extraction skipped" : "Memory unavailable",
        "error"
      );
    } finally {
      this.dom.extractMemoryButton.disabled = false;
    }
  }

  mergeMemoryCandidates(candidates = []) {
    const seen = new Set(this.memoryCandidates.map((item) => [item.type, item.title, item.body].join("::")));
    const next = [];
    for (const candidate of candidates) {
      const key = [candidate.type, candidate.title, candidate.body].join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(candidate);
    }
    this.memoryCandidates = [...next, ...this.memoryCandidates].slice(0, 12);
  }

  updateMemoryCandidateField(id, field, value) {
    const candidate = this.memoryCandidates.find((item) => item.id === id);
    if (!candidate || !["type", "title", "body", "confidence"].includes(field)) return;
    candidate[field] = field === "confidence" ? Number(value) : value;
  }

  acceptMemoryCandidate(id) {
    const candidate = this.memoryCandidates.find((item) => item.id === id);
    if (!candidate) return;
    const now = new Date().toISOString();
    const memoryItem = normalizeMemoryItem({
      ...candidate,
      id: "memory-" + Date.now(),
      source: {
        ...this.currentMemorySource(),
        ...(candidate.source || {}),
      },
      status: "accepted",
      createdAt: candidate.createdAt || now,
      updatedAt: now,
    });
    this.state.memory = this.state.memory || { version: 1, items: [] };
    const existing = Array.isArray(this.state.memory.items) ? this.state.memory.items : [];
    this.state.memory.items = [memoryItem, ...existing].slice(0, 160);
    this.refreshMemoryEdges();
    this.memoryCandidates = this.memoryCandidates.filter((item) => item.id !== id);
    this.setMemoryStatus("Memory accepted");
    this.markDirty();
    this.renderMemoryPanel();
  }

  rejectMemoryCandidate(id) {
    this.memoryCandidates = this.memoryCandidates.filter((item) => item.id !== id);
    this.setMemoryStatus("Candidate rejected");
    this.renderMemoryPanel();
  }

  refreshMemoryEdges() {
    this.state.memory = this.state.memory || { version: 1, items: [], edges: [] };
    const manualEdges = (this.state.memory.edges || []).filter((edge) => edge.source !== "deterministic");
    this.state.memory.edges = normalizeMemoryEdges([
      ...manualEdges,
      ...buildDeterministicEdges(this.state.memory.items || []),
    ]);
  }

  mergeCurrentAnalysisIntoEntry() {
    this.ensureDraftAnalysis();
    if (!this.currentAnalysis) return false;
    const entry = this.currentEntry();
    const page = this.activeLoopPage(entry);
    const analysis = {
      ...this.currentAnalysis,
      loopPageId: this.currentAnalysis.loopPageId || page.id,
    };
    const existing = Array.isArray(entry.aiAnalyses) ? entry.aiAnalyses : [];
    entry.aiAnalyses = [analysis, ...existing.filter((item) => item.id !== analysis.id)].slice(0, 20);
    this.currentAnalysis = analysis;
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
    this.activeAnalysisId = "";
    this.readerAnalysisId = "";
    this.memoryCandidates = [];
    ensureEntry(this.state.entries, this.selectedDate);
    this.dom.datePicker.value = this.selectedDate;
    this.render();
  }

  shiftDay(delta) {
    const date = parseLocalDate(this.selectedDate);
    date.setDate(date.getDate() + delta);
    this.setSelectedDate(localDateISO(date));
  }

  render(motion = "idle") {
    const entry = this.currentEntry();
    const page = this.activeLoopPage(entry);
    const principle = page.principle || {};
    const keyActions = entry.keyActions || {};

    this.syncLegacyPrinciple(entry);
    this.dom.selectedDateLabel.textContent = formatShortDate(this.selectedDate);
    this.dom.datePicker.value = this.selectedDate;
    this.dom.signalInput.value = principle.pattern || "";
    this.dom.rootConditionInput.value = principle.rootCondition || "";
    this.dom.principleInput.value = principle.principle || "";
    this.dom.mechanismInput.value = principle.mechanism || "";
    this.dom.ventureActionInput.value = keyActions.venture || "";
    this.dom.researchActionInput.value = keyActions.research || "";
    this.dom.familyActionInput.value = keyActions.family || "";
    this.renderLoopPageMeta(entry);
    this.renderLoopSpread(entry);
    this.renderCardMotion(motion);
    this.renderAnalysisList();
    this.renderMemoryPanel();
    if (!this.currentAnalysis) {
      this.dom.aiOutput.value = "";
    }
  }

  renderLoopPageMeta(entry = this.currentEntry()) {
    const pages = entry.loopPages || [];
    const index = this.activeLoopPageIndex(entry);
    const page = pages[index] || this.activeLoopPage(entry);
    const currentNumber = index + 1;
    const total = pages.length;

    this.renumberLoopPages(entry);
    this.dom.loopCardMeta.textContent = currentNumber + " / " + total;
    this.dom.loopCardBadge.textContent = String(currentNumber);
    this.dom.previousLoopPage.disabled = total < 2;
    this.dom.nextLoopPage.disabled = total < 2;
    this.dom.deleteLoopPage.disabled = total < 2;
    this.dom.toggleLoopSpread.textContent = this.isLoopSpread ? "Stack" : "Spread";
    this.dom.toggleLoopSpread.disabled = total < 2;
    this.dom.journalPanel.classList.toggle("has-multiple-cards", total > 1);
    this.dom.journalPanel.classList.toggle("is-spread", this.isLoopSpread);
    this.dom.journalPanel.dataset.spread = this.isLoopSpread ? "true" : "false";
  }

  renderLoopSpread(entry = this.currentEntry()) {
    const pages = entry.loopPages || [];
    this.dom.loopSpreadTray.hidden = !this.isLoopSpread || pages.length < 2;
    if (this.dom.loopSpreadTray.hidden) {
      this.dom.loopSpreadList.innerHTML = "";
      return;
    }
    const activeId = this.activeLoopPage(entry).id;
    this.dom.loopSpreadList.innerHTML = pages.map((page, index) => {
      const preview = this.loopPreviewText(page);
      const active = page.id === activeId ? " active" : "";
      return [
        '<button class="loop-spread-card' + active + '" type="button" data-loop-page-id="' + escapeHTML(page.id) + '">',
        '<span class="loop-spread-badge">' + String(index + 1) + '</span>',
        '<strong>Signal</strong>',
        '<p>' + escapeHTML(preview.signal) + '</p>',
        '<strong>Principle</strong>',
        '<p>' + escapeHTML(preview.principle) + '</p>',
        '</button>',
      ].join("");
    }).join("");
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
      loopPageId: this.currentAnalysis?.loopPageId || this.activeLoopPage().id,
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

  currentAnalyses() {
    return this.currentEntry().aiAnalyses || [];
  }

  activeAnalysis() {
    const analyses = this.currentAnalyses();
    if (!analyses.length) return null;
    const found = analyses.find((analysis) => analysis.id === this.activeAnalysisId);
    if (found) return found;
    this.activeAnalysisId = analyses[0].id;
    return analyses[0];
  }

  activeAnalysisIndex() {
    const analyses = this.currentAnalyses();
    const active = this.activeAnalysis();
    return Math.max(0, analyses.findIndex((analysis) => analysis.id === active?.id));
  }

  setActiveAnalysis(id, collapse = false) {
    const analyses = this.currentAnalyses();
    if (!analyses.some((analysis) => analysis.id === id)) return;
    this.activeAnalysisId = id;
    if (collapse) this.isAnalysisSpread = false;
    this.renderAnalysisList();
  }

  shiftActiveAnalysis(delta) {
    const analyses = this.currentAnalyses();
    if (analyses.length < 2) return;
    const nextIndex = (this.activeAnalysisIndex() + delta + analyses.length) % analyses.length;
    this.setActiveAnalysis(analyses[nextIndex].id);
  }

  toggleAnalysisSpread(force) {
    const analyses = this.currentAnalyses();
    if (analyses.length < 2) return;
    this.isAnalysisSpread = typeof force === "boolean" ? force : !this.isAnalysisSpread;
    this.renderAnalysisList();
  }

  analysisPreview(analysis) {
    return markdownToPlainText(analysis.analysisText || "No analysis text saved.");
  }

  renderAnalysisList() {
    const analyses = this.currentAnalyses();
    if (!analyses.length) {
      this.dom.toggleAnalysisSpread.disabled = true;
      this.dom.analysisList.innerHTML = '<p class="muted-copy">No saved AI analyses for this date.</p>';
      return;
    }
    this.dom.toggleAnalysisSpread.disabled = analyses.length < 2;
    this.dom.toggleAnalysisSpread.textContent = this.isAnalysisSpread ? "Stack" : "Spread";
    const active = this.activeAnalysis();
    const activeIndex = this.activeAnalysisIndex();
    if (this.isAnalysisSpread && analyses.length > 1) {
      this.dom.analysisList.innerHTML = [
        '<div class="analysis-spread-list">',
        analyses.map((analysis, index) => this.renderAnalysisSpreadCard(analysis, index, analysis.id === active.id)).join(""),
        '</div>',
      ].join("");
      return;
    }

    this.dom.analysisList.innerHTML = [
      '<div class="analysis-stack-shell">',
      '<div class="analysis-stack-layer analysis-layer-two" aria-hidden="true"></div>',
      '<div class="analysis-stack-layer analysis-layer-one" aria-hidden="true"></div>',
      '<article class="analysis-card analysis-stack-card" data-open-analysis="' + escapeHTML(active.id) + '">',
      '<span class="analysis-number-badge">' + String(activeIndex + 1) + '</span>',
      '<div class="analysis-card-header">',
      '<div>',
      '<strong>' + escapeHTML(active.model || "AI model") + '</strong>',
      '<span>' + escapeHTML(active.createdAt ? new Date(active.createdAt).toLocaleString() : "Saved analysis") + '</span>',
      '</div>',
      '<div class="analysis-card-controls">',
      '<button class="mini-icon-button" type="button" data-analysis-prev aria-label="Previous saved analysis">&lt;</button>',
      '<span class="loop-card-meta">' + String(activeIndex + 1) + ' / ' + String(analyses.length) + '</span>',
      '<button class="mini-icon-button" type="button" data-analysis-next aria-label="Next saved analysis">&gt;</button>',
      '<button class="text-button analysis-read-button" type="button" data-open-analysis="' + escapeHTML(active.id) + '">Zoom out</button>',
      '</div>',
      '</div>',
      '<div class="analysis-preview-rich">' + markdownToHtml(this.analysisPreview(active)) + '</div>',
      '</article>',
      '</div>',
    ].join("");
  }

  renderAnalysisSpreadCard(analysis, index, active) {
    return [
      '<button class="analysis-spread-card' + (active ? " active" : "") + '" type="button" data-select-analysis="' + escapeHTML(analysis.id) + '">',
      '<span class="analysis-number-badge">' + String(index + 1) + '</span>',
      '<strong>' + escapeHTML(analysis.model || "AI model") + '</strong>',
      '<span>' + escapeHTML(analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : "Saved analysis") + '</span>',
      '<p>' + escapeHTML(this.analysisPreview(analysis)) + '</p>',
      '</button>',
    ].join("");
  }

  renderMemoryPanel() {
    this.dom.memoryCardsView.classList.toggle("active", this.memoryView === "cards");
    this.dom.memoryGraphView.classList.toggle("active", this.memoryView === "graph");
    this.dom.memoryScopeSelect.value = this.graphScope;
    this.dom.memoryTypeFilter.value = this.graphType;
    const memoryBank = this.dom.memoryList.closest(".memory-bank");
    if (memoryBank) memoryBank.hidden = this.memoryView !== "cards";
    this.dom.memoryGraphPanel.hidden = this.memoryView !== "graph";
    this.renderMemoryCandidates();
    this.renderAcceptedMemory();
    if (this.memoryView === "graph") this.renderMemoryGraph();
  }

  setMemoryView(view) {
    this.memoryView = view === "graph" ? "graph" : "cards";
    this.renderMemoryPanel();
  }

  renderMemoryCandidates() {
    if (!this.memoryCandidates.length) {
      this.dom.memoryCandidateList.innerHTML = '<p class="muted-copy">No memory candidates waiting for review.</p>';
      return;
    }
    this.dom.memoryCandidateList.innerHTML = this.memoryCandidates.map((candidate) => {
      const typeOptions = MEMORY_TYPE_VALUES.map((type) => {
        const selected = type === candidate.type ? " selected" : "";
        return '<option value="' + escapeHTML(type) + '"' + selected + '>' + escapeHTML(memoryTypeLabel(type)) + '</option>';
      }).join("");
      const confidence = Math.round((Number(candidate.confidence) || 0.5) * 100);
      return [
        '<article class="memory-candidate-card">',
        '<div class="memory-candidate-head">',
        '<label>',
        '<span>Type</span>',
        '<select data-memory-candidate-id="' + escapeHTML(candidate.id) + '" data-memory-candidate-field="type">',
        typeOptions,
        '</select>',
        '</label>',
        '<span class="memory-confidence">' + String(confidence) + '%</span>',
        '</div>',
        '<label>',
        '<span>Title</span>',
        '<input value="' + escapeHTML(candidate.title) + '" data-memory-candidate-id="' + escapeHTML(candidate.id) + '" data-memory-candidate-field="title">',
        '</label>',
        '<label>',
        '<span>Memory</span>',
        '<textarea rows="4" data-memory-candidate-id="' + escapeHTML(candidate.id) + '" data-memory-candidate-field="body">' + escapeHTML(candidate.body) + '</textarea>',
        '</label>',
        '<div class="memory-card-actions">',
        '<button class="text-button memory-accept-button" type="button" data-accept-memory="' + escapeHTML(candidate.id) + '">Accept</button>',
        '<button class="text-button memory-reject-button" type="button" data-reject-memory="' + escapeHTML(candidate.id) + '">Reject</button>',
        '</div>',
        '</article>',
      ].join("");
    }).join("");
  }

  renderAcceptedMemory() {
    const items = (this.state.memory?.items || []).filter((item) => String(item.status || "accepted") === "accepted");
    if (!items.length) {
      this.dom.memoryList.innerHTML = '<p class="muted-copy">No accepted memory yet. Extract memory after a useful card or analysis.</p>';
      return;
    }
    this.dom.memoryList.innerHTML = items.slice(0, 24).map((item) => {
      const sourceDate = item.source?.date ? "Source " + item.source.date : "Local memory";
      return [
        '<article class="memory-card">',
        '<div class="memory-card-top">',
        '<span class="memory-type">' + escapeHTML(memoryTypeLabel(item.type)) + '</span>',
        '<span>' + escapeHTML(sourceDate) + '</span>',
        '</div>',
        '<h3>' + escapeHTML(clippedText(item.title, "Untitled memory")) + '</h3>',
        '<p>' + escapeHTML(clippedText(item.body)) + '</p>',
        '</article>',
      ].join("");
    }).join("");
  }

  renderMemoryGraph() {
    const items = this.state.memory?.items || [];
    const edges = this.state.memory?.edges || [];
    const graph = buildMemoryGraph({
      items,
      edges,
      scope: this.graphScope,
      date: this.selectedDate,
      type: this.graphType,
    });
    const nodes = graph.nodes.map((node) => {
      const saved = this.memoryNodePositions.get(node.id);
      return saved ? { ...node, ...saved } : node;
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const visibleEdges = graph.edges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to));
    const selected = nodes.find((node) => node.id === this.selectedMemoryId) || nodes[0] || null;
    if (selected && this.selectedMemoryId !== selected.id) this.selectedMemoryId = selected.id;

    this.dom.memoryGraphSvg.setAttribute("viewBox", [
      this.graphViewBox.x,
      this.graphViewBox.y,
      this.graphViewBox.width,
      this.graphViewBox.height,
    ].join(" "));

    if (!nodes.length) {
      this.dom.memoryGraphSvg.innerHTML = '<text class="memory-graph-empty" x="420" y="260" text-anchor="middle">No memory nodes in this view.</text>';
      this.dom.memoryDetailPanel.innerHTML = '<p class="eyebrow">Node Detail</p><p class="muted-copy">No accepted memory matches this scope.</p>';
      return;
    }

    const neighborIds = new Set();
    for (const edge of visibleEdges) {
      if (edge.from === this.selectedMemoryId) neighborIds.add(edge.to);
      if (edge.to === this.selectedMemoryId) neighborIds.add(edge.from);
    }

    const lines = visibleEdges.map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const active = edge.from === this.selectedMemoryId || edge.to === this.selectedMemoryId ? " active" : "";
      return [
        '<line class="memory-edge edge-' + escapeHTML(edge.type) + active + '"',
        ' x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '"',
        ' stroke-width="' + (1.2 + edge.weight * 2.4).toFixed(1) + '"></line>',
      ].join("");
    }).join("");

    const nodeMarkup = nodes.map((node) => {
      const active = node.id === this.selectedMemoryId ? " active" : neighborIds.has(node.id) ? " related" : "";
      const label = clippedText(node.title, memoryTypeLabel(node.type)).slice(0, 26);
      return [
        '<g class="memory-node node-' + escapeHTML(node.type) + active + '" data-memory-node="' + escapeHTML(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')">',
        '<circle r="30"></circle>',
        '<text text-anchor="middle" y="5">' + escapeHTML(label) + '</text>',
        '<title>' + escapeHTML(memoryTypeLabel(node.type) + ": " + clippedText(node.title)) + '</title>',
        '</g>',
      ].join("");
    }).join("");

    this.dom.memoryGraphSvg.innerHTML = [
      '<defs>',
      '<filter id="memoryGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
      '</defs>',
      '<g class="memory-edge-layer">' + lines + '</g>',
      '<g class="memory-node-layer">' + nodeMarkup + '</g>',
    ].join("");
    this.renderMemoryDetail(selected, visibleEdges);
  }

  renderMemoryDetail(node, edges) {
    if (!node) return;
    const relatedCount = edges.filter((edge) => edge.from === node.id || edge.to === node.id).length;
    this.dom.memoryDetailPanel.innerHTML = [
      '<p class="eyebrow">' + escapeHTML(memoryTypeLabel(node.type)) + '</p>',
      '<h3>' + escapeHTML(clippedText(node.title, "Untitled memory")) + '</h3>',
      '<p>' + escapeHTML(clippedText(node.body)) + '</p>',
      '<dl class="memory-detail-meta">',
      '<div><dt>Source</dt><dd>' + escapeHTML(node.source?.date || "Local") + '</dd></div>',
      '<div><dt>Relations</dt><dd>' + String(relatedCount) + '</dd></div>',
      '<div><dt>Confidence</dt><dd>' + String(Math.round((Number(node.confidence) || 0.5) * 100)) + '%</dd></div>',
      '</dl>',
    ].join("");
  }

  selectMemoryNode(id) {
    this.selectedMemoryId = id;
    this.renderMemoryGraph();
  }

  graphPoint(event) {
    const rect = this.dom.memoryGraphSvg.getBoundingClientRect();
    return {
      x: this.graphViewBox.x + ((event.clientX - rect.left) / rect.width) * this.graphViewBox.width,
      y: this.graphViewBox.y + ((event.clientY - rect.top) / rect.height) * this.graphViewBox.height,
    };
  }

  handleGraphPointerDown(event) {
    const node = event.target.closest("[data-memory-node]");
    if (node) {
      this.draggedMemoryId = node.dataset.memoryNode;
      this.selectedMemoryId = this.draggedMemoryId;
      this.dom.memoryGraphSvg.setPointerCapture?.(event.pointerId);
      this.renderMemoryGraph();
      event.preventDefault();
      return;
    }
    this.graphPanStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox: { ...this.graphViewBox },
    };
  }

  handleGraphPointerMove(event) {
    if (this.draggedMemoryId) {
      const point = this.graphPoint(event);
      this.memoryNodePositions.set(this.draggedMemoryId, { x: Math.round(point.x), y: Math.round(point.y) });
      this.renderMemoryGraph();
      return;
    }
    if (this.graphPanStart) {
      const rect = this.dom.memoryGraphSvg.getBoundingClientRect();
      const dx = ((event.clientX - this.graphPanStart.clientX) / rect.width) * this.graphPanStart.viewBox.width;
      const dy = ((event.clientY - this.graphPanStart.clientY) / rect.height) * this.graphPanStart.viewBox.height;
      this.graphViewBox = {
        ...this.graphPanStart.viewBox,
        x: this.graphPanStart.viewBox.x - dx,
        y: this.graphPanStart.viewBox.y - dy,
      };
      this.renderMemoryGraph();
    }
  }

  stopGraphDrag() {
    this.draggedMemoryId = "";
    this.graphPanStart = null;
  }

  zoomGraph(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.08 : 0.92;
    const point = this.graphPoint(event);
    const nextWidth = Math.min(1400, Math.max(420, this.graphViewBox.width * factor));
    const nextHeight = Math.min(900, Math.max(260, this.graphViewBox.height * factor));
    const rx = (point.x - this.graphViewBox.x) / this.graphViewBox.width;
    const ry = (point.y - this.graphViewBox.y) / this.graphViewBox.height;
    this.graphViewBox = {
      x: point.x - rx * nextWidth,
      y: point.y - ry * nextHeight,
      width: nextWidth,
      height: nextHeight,
    };
    this.renderMemoryGraph();
  }

  openAnalysisReader(id) {
    const analyses = this.currentAnalyses();
    const analysis = analyses.find((item) => item.id === id);
    if (!analysis) return;
    const created = analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : "Saved analysis";
    const model = analysis.model || "AI model";
    const index = analyses.findIndex((item) => item.id === id);

    this.previousFocus = document.activeElement;
    this.readerAnalysisId = id;
    this.dom.analysisModalTitle.textContent = model;
    this.dom.analysisModalMeta.textContent = "Analysis " + String(index + 1) + " of " + String(analyses.length) + " / " + created;
    this.dom.analysisModalBody.innerHTML = markdownToHtml(analysis.analysisText || "No analysis text saved.");
    this.dom.previousAnalysisReader.disabled = analyses.length < 2;
    this.dom.nextAnalysisReader.disabled = analyses.length < 2;
    this.renderAnalysisReaderNav();
    this.dom.analysisModal.hidden = false;
    document.body.classList.add("modal-open");
    this.dom.analysisModal.querySelector("[data-close-analysis]")?.focus();
  }

  shiftAnalysisReader(delta) {
    const analyses = this.currentAnalyses();
    if (analyses.length < 2) return;
    const currentIndex = Math.max(0, analyses.findIndex((analysis) => analysis.id === this.readerAnalysisId));
    const nextIndex = (currentIndex + delta + analyses.length) % analyses.length;
    this.openAnalysisReader(analyses[nextIndex].id);
  }

  renderAnalysisReaderNav() {
    const analyses = this.currentAnalyses();
    if (analyses.length < 2) {
      this.dom.analysisReaderNav.innerHTML = "";
      return;
    }
    this.dom.analysisReaderNav.innerHTML = analyses.map((analysis, index) => {
      const active = analysis.id === this.readerAnalysisId ? " active" : "";
      return [
        '<button class="analysis-reader-chip' + active + '" type="button" data-reader-analysis="' + escapeHTML(analysis.id) + '">',
        '<span>' + String(index + 1) + '</span>',
        '<strong>' + escapeHTML(analysis.model || "AI") + '</strong>',
        '</button>',
      ].join("");
    }).join("");
  }

  closeAnalysisReader() {
    this.dom.analysisModal.hidden = true;
    document.body.classList.remove("modal-open");
    this.readerAnalysisId = "";
    if (this.previousFocus && typeof this.previousFocus.focus === "function") {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
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

  setMemoryStatus(message, state = "ready") {
    this.dom.memoryStatus.textContent = message;
    this.dom.memoryStatus.className = ("memory-status " + (state === "ready" ? "" : state)).trim();
  }
}
