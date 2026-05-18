import { formatShortDate, localDateISO, parseLocalDate } from "./lib/date.js";
import { createLoopPage, ensureEntry, mergeCore, normalizeTrackerState } from "./state/schema.js";

const SAVE_DELAY_MS = 700;

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatInlineMarkdown(value) {
  return escapeHTML(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
      html.push("<h3>" + formatInlineMarkdown(heading[1]) + "</h3>");
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push("<li>" + formatInlineMarkdown(bullet[1]) + "</li>");
      continue;
    }
    closeList();
    html.push("<p>" + formatInlineMarkdown(trimmed) + "</p>");
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
    this.previousFocus = null;
    this.cardMotionTimer = null;
    this.isLoopSpread = false;
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

  renderAnalysisList() {
    const analyses = this.currentEntry().aiAnalyses || [];
    if (!analyses.length) {
      this.dom.analysisList.innerHTML = '<p class="muted-copy">No saved AI analyses for this date.</p>';
      return;
    }
    this.dom.analysisList.innerHTML = analyses.map((analysis) => {
      const created = analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : "Saved analysis";
      const text = String(analysis.analysisText || "").trim();
      const preview = text || "No analysis text saved.";
      return [
        '<article class="analysis-card" data-open-analysis="' + escapeHTML(analysis.id) + '" tabindex="0" role="button">',
        '<div class="analysis-card-header">',
        '<div>',
        '<strong>' + escapeHTML(analysis.model || "AI model") + '</strong>',
        '<span>' + escapeHTML(created) + '</span>',
        '</div>',
        '<span class="analysis-read-button" data-open-analysis="' + escapeHTML(analysis.id) + '">Zoom out</span>',
        '</div>',
        '<p class="analysis-preview">' + escapeHTML(preview) + '</p>',
        '</article>',
      ].join("");
    }).join("");
  }

  openAnalysisReader(id) {
    const analyses = this.currentEntry().aiAnalyses || [];
    const analysis = analyses.find((item) => item.id === id);
    if (!analysis) return;
    const created = analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : "Saved analysis";
    const model = analysis.model || "AI model";

    this.previousFocus = document.activeElement;
    this.dom.analysisModalTitle.textContent = model;
    this.dom.analysisModalMeta.textContent = created;
    this.dom.analysisModalBody.innerHTML = markdownToHtml(analysis.analysisText || "No analysis text saved.");
    this.dom.analysisModal.hidden = false;
    document.body.classList.add("modal-open");
    this.dom.analysisModal.querySelector("[data-close-analysis]")?.focus();
  }

  closeAnalysisReader() {
    this.dom.analysisModal.hidden = true;
    document.body.classList.remove("modal-open");
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
}
