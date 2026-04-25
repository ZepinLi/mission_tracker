(function () {
  "use strict";

  const STORAGE_KEY = "missionTracker.v1";

  const defaultCore = {
    version: 1,
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

  const dom = {
    datePicker: document.getElementById("datePicker"),
    previousDay: document.getElementById("previousDay"),
    nextDay: document.getElementById("nextDay"),
    todayButton: document.getElementById("todayButton"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput"),
    clearDayButton: document.getElementById("clearDayButton"),
    missionInput: document.getElementById("missionInput"),
    identityGrid: document.getElementById("identityGrid"),
    todayRing: document.getElementById("todayRing"),
    todayScore: document.getElementById("todayScore"),
    weekScore: document.getElementById("weekScore"),
    streakCount: document.getElementById("streakCount"),
    balanceBars: document.getElementById("balanceBars"),
    selectedDateLabel: document.getElementById("selectedDateLabel"),
    actionBoard: document.getElementById("actionBoard"),
    oneThingInput: document.getElementById("oneThingInput"),
    avoidInput: document.getElementById("avoidInput"),
    winInput: document.getElementById("winInput"),
    lessonInput: document.getElementById("lessonInput"),
    patternInput: document.getElementById("patternInput"),
    principleInput: document.getElementById("principleInput"),
    mechanismInput: document.getElementById("mechanismInput"),
    principleList: document.getElementById("principleList"),
    heatmap: document.getElementById("heatmap"),
  };

  let state = loadState();
  let selectedDate = localDateISO(new Date());

  init();

  function init() {
    dom.datePicker.value = selectedDate;
    attachEvents();
    renderAll();
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        core: clone(defaultCore),
        entries: {},
        systemLog: [],
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        core: mergeCore(parsed.core),
        entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
        systemLog: Array.isArray(parsed.systemLog) ? parsed.systemLog : [],
        createdAt: parsed.createdAt || new Date().toISOString(),
      };
    } catch (error) {
      console.warn("Unable to parse saved tracker state.", error);
      return {
        core: clone(defaultCore),
        entries: {},
        systemLog: [],
        createdAt: new Date().toISOString(),
      };
    }
  }

  function mergeCore(savedCore) {
    if (!savedCore || typeof savedCore !== "object") {
      return clone(defaultCore);
    }

    return {
      ...clone(defaultCore),
      ...savedCore,
      identities: Array.isArray(savedCore.identities)
        ? savedCore.identities
        : clone(defaultCore.identities),
      actions: Array.isArray(savedCore.actions) ? savedCore.actions : clone(defaultCore.actions),
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function attachEvents() {
    dom.previousDay.addEventListener("click", () => shiftDay(-1));
    dom.nextDay.addEventListener("click", () => shiftDay(1));
    dom.todayButton.addEventListener("click", () => setSelectedDate(localDateISO(new Date())));
    dom.datePicker.addEventListener("change", (event) => setSelectedDate(event.target.value));

    dom.missionInput.addEventListener("input", (event) => {
      state.core.mission = event.target.value;
      saveState();
    });

    dom.exportButton.addEventListener("click", exportState);
    dom.importInput.addEventListener("change", importState);
    dom.clearDayButton.addEventListener("click", clearSelectedDay);

    dom.actionBoard.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action-level]");
      if (!button) return;

      const action = findAction(button.dataset.actionId);
      const record = ensureActionRecord(action.id);
      const level = button.dataset.actionLevel;

      if (level === "none") {
        record.value = 0;
      } else if (level === "minimum") {
        record.value = action.minimum;
      } else {
        record.value = action.target;
      }

      saveState();
      renderAll();
    });

    dom.actionBoard.addEventListener("change", (event) => {
      const valueInput = event.target.closest("[data-action-value]");
      if (!valueInput) return;

      const action = findAction(valueInput.dataset.actionId);
      const record = ensureActionRecord(action.id);
      record.value = clampNumber(valueInput.value);
      saveState();
      renderAll();
    });

    dom.actionBoard.addEventListener("input", (event) => {
      const noteInput = event.target.closest("[data-action-note]");
      if (!noteInput) return;

      const record = ensureActionRecord(noteInput.dataset.actionId);
      record.note = noteInput.value;
      saveState();
    });

    [
      ["oneThingInput", "oneThing"],
      ["avoidInput", "avoid"],
      ["winInput", "win"],
      ["lessonInput", "lesson"],
    ].forEach(([elementId, field]) => {
      dom[elementId].addEventListener("input", (event) => {
        const entry = ensureEntry(selectedDate);
        entry.reflection[field] = event.target.value;
        saveState();
      });
    });

    [
      ["patternInput", "pattern"],
      ["principleInput", "principle"],
      ["mechanismInput", "mechanism"],
    ].forEach(([elementId, field]) => {
      dom[elementId].addEventListener("input", (event) => {
        const entry = ensureEntry(selectedDate);
        entry.principle[field] = event.target.value;
        saveState();
        renderPrinciples();
      });
    });
  }

  function renderAll() {
    const entry = ensureEntry(selectedDate);
    dom.datePicker.value = selectedDate;
    dom.missionInput.value = state.core.mission;
    dom.selectedDateLabel.textContent = formatShortDate(selectedDate);

    renderReflection(entry);
    renderPrincipleForm(entry);
    renderIdentities();
    renderScores();
    renderActions();
    renderPrinciples();
    renderHeatmap();
  }

  function renderIdentities() {
    dom.identityGrid.innerHTML = state.core.identities
      .map((identity) => {
        const score = identityScore(selectedDate, identity.id);
        const week = average(lastNDates(selectedDate, 7).map((date) => identityScore(date, identity.id)));
        return `
          <article class="identity-card" style="--accent: ${identity.accent}">
            <h3>${escapeHTML(identity.title)}</h3>
            <p>${escapeHTML(identity.question)}</p>
            <div class="mini-stat">
              <strong>${toPercent(score)}</strong>
              <div class="track" aria-hidden="true">
                <div class="fill" style="--accent: ${identity.accent}; --fill: ${toPercent(score)}"></div>
              </div>
            </div>
            <p>${toPercent(week)} last 7 days</p>
          </article>
        `;
      })
      .join("");
  }

  function renderScores() {
    const today = dayScore(selectedDate);
    const week = average(lastNDates(selectedDate, 7).map(dayScore));
    dom.todayScore.textContent = toPercent(today);
    dom.todayRing.style.setProperty("--score", `${Math.round(today * 360)}deg`);
    dom.weekScore.textContent = toPercent(week);
    dom.streakCount.textContent = String(currentStreak());

    dom.balanceBars.innerHTML = state.core.identities
      .map((identity) => {
        const score = average(lastNDates(selectedDate, 7).map((date) => identityScore(date, identity.id)));
        return `
          <div class="balance-row" style="--accent: ${identity.accent}">
            <span class="balance-name">${escapeHTML(identity.title)}</span>
            <div class="track" aria-hidden="true">
              <div class="fill" style="--accent: ${identity.accent}; --fill: ${toPercent(score)}"></div>
            </div>
            <span class="balance-value">${toPercent(score)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderActions() {
    dom.actionBoard.innerHTML = state.core.identities
      .map((identity) => {
        const actions = actionsForIdentity(identity.id);
        const laneScore = identityScore(selectedDate, identity.id);
        return `
          <div class="action-lane" style="--lane-bg: ${identity.soft}">
            <div class="lane-head">
              <h3>${escapeHTML(identity.title)}</h3>
              <span>${toPercent(laneScore)}</span>
            </div>
            <div class="action-list">
              ${actions.map(renderAction).join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderAction(action) {
    const record = getActionRecord(selectedDate, action.id);
    const value = record.value || 0;
    const level = scoreLevel(actionScore(action, selectedDate));
    return `
      <article class="action-item">
        <div class="action-main">
          <h4>${escapeHTML(action.title)}</h4>
          <p>Min ${action.minimum} ${escapeHTML(action.unit)} / Target ${action.target} ${escapeHTML(action.unit)}</p>
          <p>${escapeHTML(action.prompt)}</p>
        </div>
        <label class="action-controls">
          <span class="field-label">Value</span>
          <input
            class="action-number"
            data-action-value
            data-action-id="${action.id}"
            min="0"
            step="1"
            type="number"
            value="${value}"
          >
        </label>
        <div class="action-controls">
          <div class="segmented" aria-label="${escapeHTML(action.title)} status">
            <button type="button" data-action-level="none" data-action-id="${action.id}" class="${level === "none" ? "active" : ""}">0</button>
            <button type="button" data-action-level="minimum" data-action-id="${action.id}" class="${level === "minimum" ? "active" : ""}">Min</button>
            <button type="button" data-action-level="target" data-action-id="${action.id}" class="${level === "target" ? "active" : ""}">Done</button>
          </div>
          <input
            class="action-note"
            data-action-note
            data-action-id="${action.id}"
            type="text"
            value="${escapeAttr(record.note || "")}"
            placeholder="Evidence"
          >
        </div>
      </article>
    `;
  }

  function renderReflection(entry) {
    dom.oneThingInput.value = entry.reflection.oneThing || "";
    dom.avoidInput.value = entry.reflection.avoid || "";
    dom.winInput.value = entry.reflection.win || "";
    dom.lessonInput.value = entry.reflection.lesson || "";
  }

  function renderPrincipleForm(entry) {
    dom.patternInput.value = entry.principle.pattern || "";
    dom.principleInput.value = entry.principle.principle || "";
    dom.mechanismInput.value = entry.principle.mechanism || "";
  }

  function renderPrinciples() {
    const items = Object.entries(state.entries)
      .filter(([, entry]) => {
        const principle = entry.principle || {};
        return principle.pattern || principle.principle || principle.mechanism;
      })
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 5);

    if (!items.length) {
      dom.principleList.innerHTML = "";
      return;
    }

    dom.principleList.innerHTML = items
      .map(([date, entry]) => {
        const principle = entry.principle || {};
        return `
          <article class="principle-card">
            <strong>${formatShortDate(date)}</strong>
            ${principle.pattern ? `<p>Pattern: ${escapeHTML(principle.pattern)}</p>` : ""}
            ${principle.principle ? `<p>Principle: ${escapeHTML(principle.principle)}</p>` : ""}
            ${principle.mechanism ? `<p>Mechanism: ${escapeHTML(principle.mechanism)}</p>` : ""}
          </article>
        `;
      })
      .join("");
  }

  function renderHeatmap() {
    const dates = lastNDates(selectedDate, 7);
    const header = `
      <div class="heatmap-row">
        <div class="heatmap-label">Action</div>
        ${dates.map((date) => `<div class="heatmap-day">${formatTinyDate(date)}</div>`).join("")}
      </div>
    `;

    const rows = state.core.actions
      .map((action) => {
        return `
          <div class="heatmap-row">
            <div class="heatmap-label">${escapeHTML(action.title)}</div>
            ${dates
              .map((date) => {
                const score = actionScore(action, date);
                const bg = score >= 1 ? "#dcefe9" : score >= 0.5 ? "#f5ead8" : "#f0f3f5";
                const label = score >= 1 ? "Done" : score >= 0.5 ? "Min" : "";
                return `<div class="heatmap-cell" style="--cell-bg: ${bg}">${label}</div>`;
              })
              .join("")}
          </div>
        `;
      })
      .join("");

    dom.heatmap.innerHTML = `<div class="heatmap-grid">${header}${rows}</div>`;
  }

  function setSelectedDate(nextDate) {
    if (!nextDate) return;
    selectedDate = nextDate;
    ensureEntry(selectedDate);
    renderAll();
  }

  function shiftDay(delta) {
    const date = parseLocalDate(selectedDate);
    date.setDate(date.getDate() + delta);
    setSelectedDate(localDateISO(date));
  }

  function clearSelectedDay() {
    const ok = window.confirm(`Clear tracker data for ${formatShortDate(selectedDate)}?`);
    if (!ok) return;
    delete state.entries[selectedDate];
    saveState();
    renderAll();
  }

  function exportState() {
    const payload = {
      ...state,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mission-tracker-${localDateISO(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importState(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Invalid tracker file");
        }
        state = {
          core: mergeCore(parsed.core),
          entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
          systemLog: Array.isArray(parsed.systemLog) ? parsed.systemLog : [],
          createdAt: parsed.createdAt || new Date().toISOString(),
        };
        saveState();
        renderAll();
      } catch (error) {
        window.alert("Import failed. Choose a valid mission tracker JSON file.");
        console.error(error);
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function ensureEntry(date) {
    if (!state.entries[date]) {
      state.entries[date] = {
        actions: {},
        reflection: {},
        principle: {},
      };
      saveState();
    }
    return state.entries[date];
  }

  function ensureActionRecord(actionId) {
    const entry = ensureEntry(selectedDate);
    if (!entry.actions[actionId]) {
      entry.actions[actionId] = { value: 0, note: "" };
    }
    return entry.actions[actionId];
  }

  function getActionRecord(date, actionId) {
    const entry = state.entries[date];
    if (!entry || !entry.actions || !entry.actions[actionId]) {
      return { value: 0, note: "" };
    }
    return entry.actions[actionId];
  }

  function findAction(actionId) {
    return state.core.actions.find((action) => action.id === actionId);
  }

  function actionsForIdentity(identityId) {
    return state.core.actions.filter((action) => action.identityId === identityId);
  }

  function actionScore(action, date) {
    const record = getActionRecord(date, action.id);
    const value = Number(record.value) || 0;
    if (value >= action.target) return 1;
    if (value >= action.minimum) return 0.5;
    return 0;
  }

  function identityScore(date, identityId) {
    const actions = actionsForIdentity(identityId);
    if (!actions.length) return 0;
    return average(actions.map((action) => actionScore(action, date)));
  }

  function dayScore(date) {
    return average(state.core.identities.map((identity) => identityScore(date, identity.id)));
  }

  function currentStreak() {
    let streak = 0;
    const date = parseLocalDate(localDateISO(new Date()));
    while (streak < 365) {
      const iso = localDateISO(date);
      if (dayScore(iso) < 0.5) break;
      streak += 1;
      date.setDate(date.getDate() - 1);
    }
    return streak;
  }

  function scoreLevel(score) {
    if (score >= 1) return "target";
    if (score >= 0.5) return "minimum";
    return "none";
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function toPercent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function clampNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed);
  }

  function lastNDates(anchorDate, count) {
    const dates = [];
    const date = parseLocalDate(anchorDate);
    date.setDate(date.getDate() - count + 1);
    for (let index = 0; index < count; index += 1) {
      dates.push(localDateISO(date));
      date.setDate(date.getDate() + 1);
    }
    return dates;
  }

  function parseLocalDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function localDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatShortDate(isoDate) {
    return parseLocalDate(isoDate).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  }

  function formatTinyDate(isoDate) {
    return parseLocalDate(isoDate).toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
    });
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHTML(value).replaceAll("\n", " ");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
})();
