import { formatShortDate, localDateISO, parseLocalDate } from "./lib/date.js";
import { buildMemoryGraph, buildDeterministicEdges, memoryTypeLabel, normalizeMemoryEdges } from "./memory/graph.js";
import { createLoopPage, ensureEntry, hasVisibleContent, mergeCore, normalizeMemoryItem, normalizeTrackerState } from "./state/schema.js";
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
const MEMORY_TYPE_PRIORITY = {
  mechanism: 1.2,
  root_condition: 1.15,
  principle: 1.1,
  experiment: 1.08,
  recurring_pattern: 1.05,
  open_loop: 1,
  identity_signal: 0.96,
};
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "when",
  "then",
  "will",
  "what",
  "about",
  "should",
  "would",
  "could",
]);

function clippedText(value, fallback = "No detail yet.") {
  const text = String(value || "").trim();
  return text || fallback;
}

function clippedChars(value, max = 52) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function keywordSet(value) {
  const text = String(value || "").toLowerCase();
  const tokens = new Set(
    text
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
      .slice(0, 80)
  );
  for (const match of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < match.length - 1; index += 1) {
      tokens.add(match.slice(index, index + 2));
    }
  }
  return tokens;
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
    this.aiConfig = { defaultModel: "gpt-5.5", defaultReasoningEffort: "high", hasApiKey: false };
    this.currentAnalysis = null;
    this.saveStatusTimer = null;
    this.previousFocus = null;
    this.cardMotionTimer = null;
    this.calendarMonth = parseLocalDate(this.selectedDate);
    this.calendarOpen = false;
    this.fieldSplits = { top: 0.5, bottom: 0.5 };
    this.activeFieldSplit = null;
    this.isLoopSpread = false;
    this.isAnalysisSpread = false;
    this.activeAnalysisId = "";
    this.readerAnalysisId = "";
    this.memoryCandidates = [];
    this.memoryView = "cards";
    this.isMemorySpread = false;
    this.isMemorySettingsOpen = false;
    this.activeMemoryId = "";
    this.graphScope = "current";
    this.graphType = "all";
    this.graphRelation = "all";
    this.isGraphFullscreen = false;
    this.selectedMemoryId = "";
    this.hoveredMemoryId = "";
    this.graphViewBox = { x: 0, y: 0, width: 840, height: 520 };
    this.draggedMemoryId = "";
    this.graphPanStart = null;
    this.memoryNodePositions = new Map();
  }

  async init() {
    this.bindEvents();
    this.dom.datePicker.value = this.formatDateInput(this.selectedDate);
    this.setSaveStatus("Loading...");

    try {
      const [state, aiConfig] = await Promise.all([
        this.repository.loadTracker(),
        this.repository.loadAiConfig().catch(() => null),
      ]);
      this.state = normalizeTrackerState(state);
      this.aiConfig = aiConfig || this.aiConfig;
      this.dom.aiModelInput.value = this.aiConfig.defaultModel || "gpt-5.5";
      this.dom.aiEffortSelect.value = this.aiConfig.defaultReasoningEffort || "high";
      this.dom.memoryModelInput.value = this.aiConfig.defaultModel || "gpt-5.5";
      this.dom.memoryEffortSelect.value = this.aiConfig.defaultReasoningEffort || "high";
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
    this.dom.datePicker.addEventListener("click", () => this.openCalendar());
    this.dom.datePicker.addEventListener("focus", () => this.openCalendar());
    this.dom.datePicker.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        this.openCalendar();
      }
      if (event.key === "Escape") this.closeCalendar();
    });
    this.dom.previousCalendarMonth.addEventListener("click", () => this.shiftCalendarMonth(-1));
    this.dom.nextCalendarMonth.addEventListener("click", () => this.shiftCalendarMonth(1));
    this.dom.calendarGrid.addEventListener("click", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      this.setSelectedDate(day.dataset.calendarDate);
      this.closeCalendar();
    });
    this.dom.calendarGrid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      event.preventDefault();
      this.setSelectedDate(day.dataset.calendarDate);
      this.closeCalendar();
    });
    this.dom.analyzeButton.addEventListener("click", () => this.analyzeWithAi());
    this.dom.aiChatButton.addEventListener("click", () => this.chatWithAi());
    this.dom.saveAnalysisButton.addEventListener("click", () => this.saveCurrentAnalysis());
    this.dom.extractMemoryButton.addEventListener("click", () => this.extractMemoryCandidates());
    this.dom.relatedMemoryList.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-memory]");
      if (trigger) this.openMemoryReader(trigger.dataset.openMemory);
    });
    this.dom.relatedMemoryList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest("[data-open-memory]");
      if (!trigger) return;
      event.preventDefault();
      this.openMemoryReader(trigger.dataset.openMemory);
    });
    this.dom.toggleAnalysisSpread.addEventListener("click", () => this.toggleAnalysisSpread());
    this.dom.aiOutput.addEventListener("input", () => {
      this.handleManualAnalysisInput();
      this.renderRelatedMemory();
      this.setSaveStatus("Unsaved", "dirty");
    });
    this.dom.manualSaveIsland.addEventListener("click", () => this.manualSaveAll());
    this.dom.previousLoopPage.addEventListener("click", () => this.shiftLoopPage(-1));
    this.dom.nextLoopPage.addEventListener("click", () => this.shiftLoopPage(1));
    this.dom.addLoopPage.addEventListener("click", () => this.addLoopPage());
    this.dom.deleteLoopPage.addEventListener("click", () => this.deleteActiveLoopPage());
    this.dom.toggleLoopSpread.addEventListener("click", () => this.toggleLoopSpread());
    this.bindFieldSplitHandle("top", this.dom.topFieldRow, this.dom.topSplitHandle);
    this.bindFieldSplitHandle("bottom", this.dom.bottomFieldRow, this.dom.bottomSplitHandle);
    window.addEventListener("resize", () => this.applyFieldSplits());
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
    this.dom.toggleMemorySpread.addEventListener("click", () => this.toggleMemorySpread());
    this.dom.toggleMemorySettings.addEventListener("click", () => this.toggleMemorySettings());
    this.dom.memoryList.addEventListener("click", (event) => {
      if (event.target.closest("[data-memory-prev]")) {
        this.shiftActiveMemory(-1);
        return;
      }
      if (event.target.closest("[data-memory-next]")) {
        this.shiftActiveMemory(1);
        return;
      }
      if (event.target.closest("[data-open-memory]")) {
        this.openMemoryReader(event.target.closest("[data-open-memory]").dataset.openMemory);
        return;
      }
      const select = event.target.closest("[data-select-memory]");
      if (select) this.setActiveMemory(select.dataset.selectMemory, true);
    });
    this.dom.memoryList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest("[data-open-memory], [data-select-memory]");
      if (!trigger) return;
      event.preventDefault();
      if (trigger.dataset.openMemory) this.openMemoryReader(trigger.dataset.openMemory);
      if (trigger.dataset.selectMemory) this.setActiveMemory(trigger.dataset.selectMemory, true);
    });
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
    this.dom.memoryRelationFilter.addEventListener("change", (event) => {
      this.graphRelation = event.target.value;
      this.renderMemoryPanel();
    });
    this.dom.memoryGraphPanel.addEventListener("click", (event) => {
      if (event.target.closest("#fitMemoryGraph")) {
        this.fitMemoryGraph();
        return;
      }
      if (event.target.closest("#resetMemoryGraph")) {
        this.resetMemoryGraph();
        return;
      }
      if (event.target.closest("#toggleMemoryGraphFullscreen")) {
        this.toggleMemoryGraphFullscreen();
      }
    });
    this.dom.memoryGraphSvg.addEventListener("click", (event) => {
      const node = event.target.closest("[data-memory-node]");
      if (node) this.selectMemoryNode(node.dataset.memoryNode);
    });
    this.dom.memoryGraphSvg.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const node = event.target.closest("[data-memory-node]");
      if (!node) return;
      event.preventDefault();
      this.selectMemoryNode(node.dataset.memoryNode);
    });
    this.dom.memoryGraphSvg.addEventListener("pointerover", (event) => {
      const node = event.target.closest("[data-memory-node]");
      if (!node || node.dataset.memoryNode === this.hoveredMemoryId) return;
      this.hoveredMemoryId = node.dataset.memoryNode;
      this.renderMemoryGraph();
    });
    this.dom.memoryGraphSvg.addEventListener("pointerout", (event) => {
      const node = event.target.closest("[data-memory-node]");
      if (!node) return;
      const next = event.relatedTarget?.closest?.("[data-memory-node]");
      if (next && next.dataset.memoryNode === node.dataset.memoryNode) return;
      this.hoveredMemoryId = "";
      this.renderMemoryGraph();
    });
    this.dom.memoryGraphSvg.addEventListener("pointerdown", (event) => this.handleGraphPointerDown(event));
    this.dom.memoryGraphSvg.addEventListener("pointermove", (event) => this.handleGraphPointerMove(event));
    this.dom.memoryGraphSvg.addEventListener("pointerup", () => this.stopGraphDrag());
    this.dom.memoryGraphSvg.addEventListener("pointerleave", () => this.stopGraphDrag());
    this.dom.memoryGraphSvg.addEventListener("wheel", (event) => this.zoomGraph(event), { passive: false });
    this.dom.memoryDetailPanel.addEventListener("click", (event) => {
      const node = event.target.closest("[data-memory-node]");
      if (node) this.selectMemoryNode(node.dataset.memoryNode);
    });
    document.addEventListener("click", (event) => {
      if (this.calendarOpen && !event.target.closest(".date-control")) this.closeCalendar();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.isGraphFullscreen) this.toggleMemoryGraphFullscreen(false);
      if (!this.dom.analysisModal.hidden) this.closeAnalysisReader();
      if (this.calendarOpen) this.closeCalendar();
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
        this.renderRelatedMemory();
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

  bindFieldSplitHandle(key, row, handle) {
    if (!row || !handle) return;

    handle.addEventListener("pointerdown", (event) => {
      if (!this.canSplitFieldRow(row, handle)) return;
      event.preventDefault();
      this.activeFieldSplit = { key };
      row.classList.add("is-resizing");
      handle.setPointerCapture(event.pointerId);
      this.updateFieldSplitFromPointer(key, row, handle, event.clientX);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!this.activeFieldSplit || this.activeFieldSplit.key !== key) return;
      event.preventDefault();
      this.updateFieldSplitFromPointer(key, row, handle, event.clientX);
    });

    const finishResize = (event) => {
      if (!this.activeFieldSplit || this.activeFieldSplit.key !== key) return;
      if (event && handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      row.classList.remove("is-resizing");
      this.activeFieldSplit = null;
    };

    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);

    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.08 : 0.04;
      if (event.key === "Home") {
        this.fieldSplits[key] = 0.5;
      } else {
        this.fieldSplits[key] += event.key === "ArrowRight" ? step : -step;
      }
      this.applyFieldSplit(key);
    });
  }

  canSplitFieldRow(row, handle) {
    return row && handle && getComputedStyle(handle).display !== "none";
  }

  fieldSplitMetrics(row, handle) {
    const style = getComputedStyle(row);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const handleWidth = handle.offsetWidth || 16;
    const available = Math.max(0, row.clientWidth - handleWidth - (gap * 2));
    const minColumn = available >= 520 ? 260 : available / 2;
    return { available, gap, handleWidth, minColumn };
  }

  updateFieldSplitFromPointer(key, row, handle, clientX) {
    const metrics = this.fieldSplitMetrics(row, handle);
    if (!metrics.available) return;
    const rect = row.getBoundingClientRect();
    const rawLeft = clientX - rect.left - metrics.gap - (metrics.handleWidth / 2);
    const left = Math.min(
      Math.max(rawLeft, metrics.minColumn),
      metrics.available - metrics.minColumn
    );
    this.fieldSplits[key] = left / metrics.available;
    this.applyFieldSplit(key);
  }

  applyFieldSplit(key) {
    const row = key === "top" ? this.dom.topFieldRow : this.dom.bottomFieldRow;
    const handle = key === "top" ? this.dom.topSplitHandle : this.dom.bottomSplitHandle;
    if (!row || !handle) return;
    if (!this.canSplitFieldRow(row, handle)) {
      row.style.removeProperty("--left-column");
      row.style.removeProperty("--right-column");
      return;
    }

    const metrics = this.fieldSplitMetrics(row, handle);
    if (!metrics.available) return;
    const minRatio = metrics.minColumn / metrics.available;
    const ratio = Math.min(
      Math.max(this.fieldSplits[key] || 0.5, minRatio),
      1 - minRatio
    );
    const left = Math.round(metrics.available * ratio);
    const right = Math.max(0, Math.round(metrics.available - left));
    this.fieldSplits[key] = ratio;
    row.style.setProperty("--left-column", left + "px");
    row.style.setProperty("--right-column", right + "px");
  }

  applyFieldSplits() {
    this.applyFieldSplit("top");
    this.applyFieldSplit("bottom");
  }

  formatDateInput(isoDate) {
    return String(isoDate || "").replaceAll("-", "/");
  }

  openCalendar() {
    this.calendarOpen = true;
    this.renderCalendar();
  }

  closeCalendar() {
    this.calendarOpen = false;
    this.renderCalendar();
  }

  shiftCalendarMonth(delta) {
    this.calendarMonth = new Date(
      this.calendarMonth.getFullYear(),
      this.calendarMonth.getMonth() + delta,
      1
    );
    this.renderCalendar();
  }

  calendarMonthName(date) {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(date);
  }

  calendarStatusForDate(isoDate) {
    const today = localDateISO(new Date());
    if (isoDate > today) return "future";
    return hasVisibleContent(this.state.entries[isoDate]) ? "recorded" : "missed";
  }

  renderCalendar() {
    if (!this.dom.calendarPopover || !this.dom.calendarGrid) return;
    this.dom.calendarPopover.hidden = !this.calendarOpen;
    this.dom.datePicker.setAttribute("aria-expanded", this.calendarOpen ? "true" : "false");
    this.dom.calendarMonthLabel.textContent = this.calendarMonthName(this.calendarMonth);

    const today = localDateISO(new Date());
    const monthStart = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const visibleMonth = this.calendarMonth.getMonth();
    const days = [];

    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const isoDate = localDateISO(day);
      const status = this.calendarStatusForDate(isoDate);
      const classNames = [
        "calendar-day",
        status,
        day.getMonth() !== visibleMonth ? "outside-month" : "",
        isoDate === this.selectedDate ? "selected" : "",
        isoDate === today ? "today" : "",
      ].filter(Boolean).join(" ");
      const statusLabel = status === "recorded" ? "recorded" : status === "missed" ? "empty" : "future";
      days.push([
        '<button class="' + classNames + '" type="button" role="gridcell" data-calendar-date="' + isoDate + '"',
        ' aria-label="' + escapeHTML(formatShortDate(isoDate) + ", " + statusLabel) + '">',
        '<span class="calendar-day-number">' + String(day.getDate()) + '</span>',
        '</button>',
      ].join(""));
    }

    this.dom.calendarGrid.innerHTML = days.join("");
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
    const related = this.relatedMemoryItems(12);
    const fallback = this.acceptedMemoryItems().slice(0, 12).map((item) => ({ item, score: 0 }));
    const selected = related.length ? related : fallback;
    return {
      version: this.state.memory?.version || 1,
      retrieval: "related_to_current_card",
      items: selected.map(({ item, score }) => ({
        type: item.type,
        title: item.title,
        body: item.body,
        confidence: item.confidence,
        relevance: Number(score.toFixed(2)),
        source: item.source,
      })),
    };
  }

  acceptedMemoryItems() {
    const items = Array.isArray(this.state.memory?.items) ? this.state.memory.items : [];
    return items.filter((item) => String(item.status || "accepted") === "accepted");
  }

  relatedMemoryItems(limit = 6) {
    const accepted = this.acceptedMemoryItems();
    if (!accepted.length) return [];
    const page = this.activeLoopPage();
    const principle = page.principle || {};
    const query = [
      principle.pattern,
      principle.rootCondition,
      principle.principle,
      principle.mechanism,
      this.dom.aiOutput?.value || "",
    ].join(" ");
    const queryTokens = keywordSet(query);
    return accepted
      .map((item) => {
        const tokens = keywordSet([item.title, item.body].join(" "));
        let overlap = 0;
        for (const token of queryTokens) {
          if (tokens.has(token)) overlap += 1;
        }
        const sameDate = item.source?.date === this.selectedDate ? 2.4 : 0;
        const sameCard = item.source?.loopPageId && item.source.loopPageId === page.id ? 2.2 : 0;
        const confidence = Number(item.confidence) || 0.5;
        const typeBoost = MEMORY_TYPE_PRIORITY[item.type] || 1;
        const score = (overlap * 0.8 + sameDate + sameCard + confidence * 0.7) * typeBoost;
        return { item, score };
      })
      .filter(({ score }) => score > 0.25)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
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
        model: this.dom.memoryModelInput.value,
        reasoningEffort: this.dom.memoryEffortSelect.value,
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
      const fallback = auto ? "Memory extraction skipped" : "Memory unavailable";
      const status =
        error.status === 400
          ? "Missing OPENAI_API_KEY"
          : error.status === 502
            ? "Memory network error"
            : fallback;
      this.setMemoryStatus(
        status,
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
    this.calendarMonth = parseLocalDate(this.selectedDate);
    this.dom.datePicker.value = this.formatDateInput(this.selectedDate);
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
    this.dom.datePicker.value = this.formatDateInput(this.selectedDate);
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
    this.applyFieldSplits();
    this.renderRelatedMemory();
    this.renderAnalysisList();
    this.renderMemoryPanel();
    this.renderCalendar();
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
    this.dom.memoryRelationFilter.value = this.graphRelation;
    this.dom.toggleMemorySpread.textContent = this.isMemorySpread ? "Stack" : "Spread";
    this.dom.toggleMemorySpread.hidden = this.memoryView !== "cards";
    this.dom.memorySettingsPanel.hidden = !this.isMemorySettingsOpen;
    this.dom.toggleMemorySettings.setAttribute("aria-expanded", this.isMemorySettingsOpen ? "true" : "false");
    const memoryBank = this.dom.memoryList.closest(".memory-bank");
    if (memoryBank) memoryBank.hidden = this.memoryView !== "cards";
    this.dom.memoryGraphPanel.hidden = this.memoryView !== "graph";
    this.dom.memoryGraphPanel.classList.toggle("fullscreen", this.isGraphFullscreen && this.memoryView === "graph");
    this.dom.toggleMemoryGraphFullscreen.textContent = this.isGraphFullscreen ? "Exit full screen" : "Full screen";
    document.body.classList.toggle("graph-fullscreen-open", this.isGraphFullscreen && this.memoryView === "graph");
    this.renderMemoryCandidates();
    this.renderAcceptedMemory();
    if (this.memoryView === "graph") this.renderMemoryGraph();
  }

  renderRelatedMemory() {
    const related = this.relatedMemoryItems(5);
    if (!related.length) {
      this.dom.relatedMemoryList.innerHTML = '<p class="muted-copy">Accepted memory will appear here before AI analysis.</p>';
      return;
    }
    this.dom.relatedMemoryList.innerHTML = related.map(({ item, score }) => {
      return [
        '<button class="related-memory-card" type="button" data-open-memory="' + escapeHTML(item.id) + '">',
        '<div>',
        '<span class="memory-type">' + escapeHTML(memoryTypeLabel(item.type)) + '</span>',
        '<strong>' + escapeHTML(clippedText(item.title, "Untitled memory")) + '</strong>',
        '</div>',
        '<p>' + escapeHTML(clippedText(item.body)) + '</p>',
        '<span class="related-memory-score">match ' + escapeHTML(String(Math.round(score * 10) / 10)) + '</span>',
        '</button>',
      ].join("");
    }).join("");
  }

  setMemoryView(view) {
    this.memoryView = view === "graph" ? "graph" : "cards";
    if (this.memoryView !== "graph") this.isGraphFullscreen = false;
    this.renderMemoryPanel();
  }

  toggleMemorySpread(force) {
    this.isMemorySpread = typeof force === "boolean" ? force : !this.isMemorySpread;
    this.renderMemoryPanel();
  }

  toggleMemorySettings(force) {
    this.isMemorySettingsOpen = typeof force === "boolean" ? force : !this.isMemorySettingsOpen;
    this.dom.memorySettingsPanel.hidden = !this.isMemorySettingsOpen;
    this.dom.toggleMemorySettings.setAttribute("aria-expanded", this.isMemorySettingsOpen ? "true" : "false");
  }

  activeMemoryIndex(items = this.acceptedMemoryItems()) {
    if (!items.length) return -1;
    const found = items.findIndex((item) => item.id === this.activeMemoryId);
    return found >= 0 ? found : 0;
  }

  activeMemory(items = this.acceptedMemoryItems()) {
    if (!items.length) return null;
    const index = this.activeMemoryIndex(items);
    const active = items[index] || items[0];
    this.activeMemoryId = active.id;
    return active;
  }

  shiftActiveMemory(delta) {
    const items = this.acceptedMemoryItems();
    if (items.length < 2) return;
    const current = this.activeMemoryIndex(items);
    const next = (current + delta + items.length) % items.length;
    this.activeMemoryId = items[next].id;
    this.renderAcceptedMemory();
  }

  setActiveMemory(id, collapse = false) {
    this.activeMemoryId = id;
    if (collapse) this.isMemorySpread = false;
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
    const items = this.acceptedMemoryItems();
    if (!items.length) {
      this.dom.memoryList.innerHTML = '<p class="muted-copy">No accepted memory yet. Extract memory after a useful card or analysis.</p>';
      return;
    }
    const active = this.activeMemory(items);
    const activeIndex = this.activeMemoryIndex(items);
    this.dom.toggleMemorySpread.disabled = items.length < 2;

    if (this.isMemorySpread && items.length > 1) {
      this.dom.memoryList.innerHTML = [
        '<div class="memory-spread-list">',
        items.slice(0, 48).map((item, index) => this.renderMemorySpreadCard(item, index, item.id === active.id)).join(""),
        '</div>',
      ].join("");
      return;
    }

    this.dom.memoryList.innerHTML = [
      '<div class="memory-stack-shell">',
      '<div class="memory-stack-layer memory-layer-two" aria-hidden="true"></div>',
      '<div class="memory-stack-layer memory-layer-one" aria-hidden="true"></div>',
      this.renderMemoryStackCard(active, activeIndex, items.length),
      '</div>',
    ].join("");
  }

  renderMemoryStackCard(item, index, total) {
    const sourceDate = item.source?.date ? "Source " + item.source.date : "Local memory";
    return [
      '<article class="memory-card memory-stack-card" data-open-memory="' + escapeHTML(item.id) + '">',
      '<span class="memory-number-badge">' + String(index + 1) + '</span>',
      '<div class="memory-card-top">',
      '<div>',
      '<span class="memory-type">' + escapeHTML(memoryTypeLabel(item.type)) + '</span>',
      '<span>' + escapeHTML(sourceDate) + '</span>',
      '</div>',
      '<div class="memory-card-controls">',
      '<button class="mini-icon-button" type="button" data-memory-prev aria-label="Previous memory">&lt;</button>',
      '<span class="loop-card-meta">' + String(index + 1) + ' / ' + String(total) + '</span>',
      '<button class="mini-icon-button" type="button" data-memory-next aria-label="Next memory">&gt;</button>',
      '</div>',
      '</div>',
      '<h3>' + escapeHTML(clippedText(item.title, "Untitled memory")) + '</h3>',
      '<p>' + escapeHTML(clippedText(item.body)) + '</p>',
      '</article>',
    ].join("");
  }

  renderMemorySpreadCard(item, index, active) {
    const sourceDate = item.source?.date ? "Source " + item.source.date : "Local memory";
    return [
      '<button class="memory-card memory-spread-card' + (active ? " active" : "") + '" type="button" data-select-memory="' + escapeHTML(item.id) + '">',
      '<span class="memory-number-badge">' + String(index + 1) + '</span>',
      '<div class="memory-card-top">',
      '<span class="memory-type">' + escapeHTML(memoryTypeLabel(item.type)) + '</span>',
      '<span>' + escapeHTML(sourceDate) + '</span>',
      '</div>',
      '<h3>' + escapeHTML(clippedText(item.title, "Untitled memory")) + '</h3>',
      '<p>' + escapeHTML(clippedText(item.body)) + '</p>',
      '</button>',
    ].join("");
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
    const filteredEdges = this.graphRelation === "all"
      ? graph.edges
      : graph.edges.filter((edge) => edge.type === this.graphRelation);
    const laidOut = this.layoutMemoryFocusGraph(graph.nodes, filteredEdges);
    const nodes = laidOut.map((node) => {
      const saved = this.memoryNodePositions.get(node.id);
      return saved ? { ...node, ...saved } : node;
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const visibleEdges = filteredEdges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to));
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

    const focusMemoryId = this.hoveredMemoryId || this.selectedMemoryId;
    const neighborIds = new Set();
    for (const edge of visibleEdges) {
      if (edge.from === focusMemoryId) neighborIds.add(edge.to);
      if (edge.to === focusMemoryId) neighborIds.add(edge.from);
    }

    const lines = visibleEdges.map((edge, index) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const active = edge.from === focusMemoryId || edge.to === focusMemoryId ? " active" : "";
      const selectedEdge = edge.from === this.selectedMemoryId || edge.to === this.selectedMemoryId ? " selected" : "";
      const relationLabel = active ? edge.type.replace(/_/g, " ") : "";
      const path = this.memoryEdgePath(from, to);
      const edgePathId = "memory-edge-path-" + String(index);
      return [
        '<path class="memory-edge edge-' + escapeHTML(edge.type) + active + selectedEdge + '"',
        ' id="' + edgePathId + '" d="' + path + '" marker-end="url(#memoryArrow)"',
        ' stroke-width="' + (0.9 + edge.weight * 1.8).toFixed(1) + '"></path>',
        relationLabel
          ? '<text class="memory-edge-label"><textPath href="#' + edgePathId + '" startOffset="50%">' + escapeHTML(relationLabel) + '</textPath></text>'
          : '',
      ].join("");
    }).join("");

    const nodeMarkup = nodes.map((node) => {
      const active = node.id === this.selectedMemoryId ? " active" : "";
      const hovered = node.id === this.hoveredMemoryId ? " hovered" : "";
      const related = neighborIds.has(node.id) ? " related" : "";
      const titleLines = this.svgTextLines(clippedText(node.title, memoryTypeLabel(node.type)), 19, 2);
      const bodyLines = this.svgTextLines(node.body || "", 28, 2);
      const nodeWidth = node.id === this.selectedMemoryId || node.id === this.hoveredMemoryId ? 224 : 188;
      const nodeHeight = node.id === this.selectedMemoryId || node.id === this.hoveredMemoryId ? 112 : 92;
      return [
        '<g class="memory-node node-' + escapeHTML(node.type) + active + hovered + related + '" tabindex="0" role="button" data-memory-node="' + escapeHTML(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')">',
        '<rect class="memory-node-card" x="' + (-nodeWidth / 2) + '" y="' + (-nodeHeight / 2) + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="12"></rect>',
        '<rect class="memory-node-accent" x="' + (-nodeWidth / 2) + '" y="' + (-nodeHeight / 2) + '" width="5" height="' + nodeHeight + '" rx="3"></rect>',
        '<text class="memory-node-type" x="' + (-nodeWidth / 2 + 16) + '" y="' + (-nodeHeight / 2 + 22) + '">' + escapeHTML(memoryTypeLabel(node.type)) + '</text>',
        '<text class="memory-node-title" x="' + (-nodeWidth / 2 + 16) + '" y="' + (-nodeHeight / 2 + 44) + '">' + titleLines.map((line, index) => '<tspan x="' + (-nodeWidth / 2 + 16) + '" dy="' + (index ? 15 : 0) + '">' + escapeHTML(line) + '</tspan>').join("") + '</text>',
        '<text class="memory-node-body" x="' + (-nodeWidth / 2 + 16) + '" y="' + (nodeHeight / 2 - 26) + '">' + bodyLines.map((line, index) => '<tspan x="' + (-nodeWidth / 2 + 16) + '" dy="' + (index ? 13 : 0) + '">' + escapeHTML(line) + '</tspan>').join("") + '</text>',
        '<title>' + escapeHTML(memoryTypeLabel(node.type) + ": " + clippedText(node.title)) + '</title>',
        '</g>',
      ].join("");
    }).join("");

    this.dom.memoryGraphSvg.innerHTML = [
      '<defs>',
      '<filter id="memoryGlow" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#1d1b18" flood-opacity="0.13"/></filter>',
      '<marker id="memoryArrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>',
      '</defs>',
      '<g class="memory-graph-grid" aria-hidden="true"><path d="M118 120 C240 58 600 58 722 120"></path><path d="M96 390 C250 470 590 470 744 390"></path><path d="M420 72 C520 148 520 372 420 448 C320 372 320 148 420 72"></path></g>',
      '<g class="memory-edge-layer">' + lines + '</g>',
      '<g class="memory-node-layer">' + nodeMarkup + '</g>',
    ].join("");
    this.renderMemoryDetail(selected, visibleEdges);
  }

  currentMemoryGraphLayout() {
    const graph = buildMemoryGraph({
      items: this.state.memory?.items || [],
      edges: this.state.memory?.edges || [],
      scope: this.graphScope,
      date: this.selectedDate,
      type: this.graphType,
    });
    const filteredEdges = this.graphRelation === "all"
      ? graph.edges
      : graph.edges.filter((edge) => edge.type === this.graphRelation);
    const nodes = this.layoutMemoryFocusGraph(graph.nodes, filteredEdges).map((node) => {
      const saved = this.memoryNodePositions.get(node.id);
      return saved ? { ...node, ...saved } : node;
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return {
      nodes,
      edges: filteredEdges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to)),
    };
  }

  fitMemoryGraph() {
    const { nodes } = this.currentMemoryGraphLayout();
    if (!nodes.length) {
      this.resetMemoryGraph();
      return;
    }
    const minX = Math.min(...nodes.map((node) => node.x)) - 150;
    const maxX = Math.max(...nodes.map((node) => node.x)) + 150;
    const minY = Math.min(...nodes.map((node) => node.y)) - 110;
    const maxY = Math.max(...nodes.map((node) => node.y)) + 110;
    const width = Math.max(560, maxX - minX);
    const height = Math.max(360, maxY - minY);
    this.graphViewBox = {
      x: Math.round(minX - Math.max(0, 840 - width) / 2),
      y: Math.round(minY - Math.max(0, 520 - height) / 2),
      width: Math.round(Math.max(width, 840)),
      height: Math.round(Math.max(height, 520)),
    };
    this.renderMemoryGraph();
  }

  resetMemoryGraph() {
    this.graphViewBox = { x: 0, y: 0, width: 840, height: 520 };
    this.memoryNodePositions.clear();
    this.stopGraphDrag();
    this.renderMemoryGraph();
  }

  toggleMemoryGraphFullscreen(force) {
    this.isGraphFullscreen = typeof force === "boolean" ? force : !this.isGraphFullscreen;
    if (this.isGraphFullscreen) this.memoryView = "graph";
    this.renderMemoryPanel();
    if (this.memoryView === "graph") window.setTimeout(() => this.fitMemoryGraph(), 0);
  }

  layoutMemoryFocusGraph(nodes, edges) {
    if (!nodes.length) return [];
    const selected = nodes.find((node) => node.id === this.selectedMemoryId) || nodes[0];
    const selectedId = selected.id;
    const degree = new Map(nodes.map((node) => [node.id, 0]));
    const neighborIds = new Set();
    for (const edge of edges) {
      degree.set(edge.from, (degree.get(edge.from) || 0) + edge.weight);
      degree.set(edge.to, (degree.get(edge.to) || 0) + edge.weight);
      if (edge.from === selectedId) neighborIds.add(edge.to);
      if (edge.to === selectedId) neighborIds.add(edge.from);
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const neighbors = [...neighborIds]
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0));
    const distant = nodes
      .filter((node) => node.id !== selectedId && !neighborIds.has(node.id))
      .sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0));

    const placed = new Map();
    placed.set(selectedId, { ...selected, x: 420, y: 260, graphRole: "focus" });

    const neighborCount = Math.max(1, neighbors.length);
    neighbors.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / neighborCount) * Math.PI * 2;
      placed.set(node.id, {
        ...node,
        x: Math.round(420 + Math.cos(angle) * 265),
        y: Math.round(260 + Math.sin(angle) * 158),
        graphRole: "neighbor",
      });
    });

    const distantCount = Math.max(1, distant.length);
    distant.forEach((node, index) => {
      const angle = -Math.PI / 2 + ((index + 0.5) / distantCount) * Math.PI * 2;
      placed.set(node.id, {
        ...node,
        x: Math.round(420 + Math.cos(angle) * 335),
        y: Math.round(260 + Math.sin(angle) * 215),
        graphRole: "distant",
      });
    });

    return nodes.map((node) => placed.get(node.id) || node);
  }

  memoryEdgePath(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const curve = Math.min(58, distance * 0.16);
    const nx = -dy / distance;
    const ny = dx / distance;
    const c1x = Math.round(from.x + dx * 0.34 + nx * curve);
    const c1y = Math.round(from.y + dy * 0.34 + ny * curve);
    const c2x = Math.round(from.x + dx * 0.66 + nx * curve);
    const c2y = Math.round(from.y + dy * 0.66 + ny * curve);
    return "M " + from.x + " " + from.y + " C " + c1x + " " + c1y + " " + c2x + " " + c2y + " " + to.x + " " + to.y;
  }

  svgTextLines(value, maxChars = 18, maxLines = 2) {
    const text = clippedChars(value || "", maxChars * maxLines + 6);
    if (!text) return [""];
    const lines = [];
    let remaining = text;
    while (remaining && lines.length < maxLines) {
      if (remaining.length <= maxChars) {
        lines.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf(" ", maxChars);
      if (cut < Math.floor(maxChars * 0.55)) cut = maxChars;
      lines.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining && lines.length) {
      lines[lines.length - 1] = clippedChars(lines[lines.length - 1], Math.max(4, maxChars - 1));
    }
    return lines.length ? lines : [text];
  }

  renderMemoryDetail(node, edges) {
    if (!node) return;
    const relatedEdges = edges.filter((edge) => edge.from === node.id || edge.to === node.id);
    const items = new Map((this.state.memory?.items || []).map((item) => [item.id, item]));
    const relationMarkup = relatedEdges.slice(0, 5).map((edge) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const other = items.get(otherId);
      return [
        '<button class="memory-relation-chip" type="button" data-memory-node="' + escapeHTML(otherId) + '">',
        '<span>' + escapeHTML(edge.type.replace(/_/g, " ")) + '</span>',
        '<strong>' + escapeHTML(clippedText(other?.title, "Related memory")) + '</strong>',
        '</button>',
      ].join("");
    }).join("");
    this.dom.memoryDetailPanel.innerHTML = [
      '<p class="eyebrow">' + escapeHTML(memoryTypeLabel(node.type)) + '</p>',
      '<h3>' + escapeHTML(clippedText(node.title, "Untitled memory")) + '</h3>',
      '<p>' + escapeHTML(clippedText(node.body)) + '</p>',
      '<dl class="memory-detail-meta">',
      '<div><dt>Source</dt><dd>' + escapeHTML(node.source?.date || "Local") + '</dd></div>',
      '<div><dt>Relations</dt><dd>' + String(relatedEdges.length) + '</dd></div>',
      '<div><dt>Confidence</dt><dd>' + String(Math.round((Number(node.confidence) || 0.5) * 100)) + '%</dd></div>',
      '</dl>',
      relationMarkup ? '<div class="memory-relation-list">' + relationMarkup + '</div>' : '',
    ].join("");
  }

  selectMemoryNode(id) {
    this.selectedMemoryId = id;
    this.hoveredMemoryId = "";
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
    this.dom.previousAnalysisReader.hidden = false;
    this.dom.nextAnalysisReader.hidden = false;
    this.dom.previousAnalysisReader.disabled = analyses.length < 2;
    this.dom.nextAnalysisReader.disabled = analyses.length < 2;
    this.renderAnalysisReaderNav();
    this.dom.analysisModal.hidden = false;
    document.body.classList.add("modal-open");
    this.dom.analysisModal.querySelector("[data-close-analysis]")?.focus();
  }

  openMemoryReader(id) {
    const items = this.acceptedMemoryItems();
    const memory = items.find((item) => item.id === id);
    if (!memory) return;
    const sourceDate = memory.source?.date ? "Source " + memory.source.date : "Local memory";
    const confidence = String(Math.round((Number(memory.confidence) || 0.5) * 100)) + "%";

    this.previousFocus = document.activeElement;
    this.readerAnalysisId = "";
    this.dom.analysisModalTitle.textContent = clippedText(memory.title, "Untitled memory");
    this.dom.analysisModalMeta.textContent = [
      "Memory",
      memoryTypeLabel(memory.type),
      sourceDate,
      "Confidence " + confidence,
    ].join(" / ");
    this.dom.analysisModalBody.innerHTML = markdownToHtml(memory.body || "No memory detail saved.");
    this.dom.previousAnalysisReader.hidden = true;
    this.dom.nextAnalysisReader.hidden = true;
    this.dom.analysisReaderNav.innerHTML = "";
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
