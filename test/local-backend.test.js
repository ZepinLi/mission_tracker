const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const auth = require("../server/auth");
const pages = require("../server/services/pages");
const comments = require("../server/services/comments");

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

test("local backend supports page save conflicts and comments", () => {
  const { user } = auth.signUp({
    email: uniqueEmail("owner"),
    password: "test-password",
  });

  const page = pages.createPage({
    title: "Test Page",
    core: { mission: "Test mission" },
    owner: user,
  });

  const firstSave = pages.saveWeek({
    pageId: page.id,
    weekKey: "2026-W18",
    weekStart: "2026-04-27",
    weekEnd: "2026-05-03",
    entries: {
      "2026-04-30": {
        reflection: { win: "first" },
      },
    },
    expectedRevision: 0,
    user,
  });

  assert.equal(firstSave.conflict, false);
  assert.equal(firstSave.row.revision, 1);

  const staleSave = pages.saveWeek({
    pageId: page.id,
    weekKey: "2026-W18",
    weekStart: "2026-04-27",
    weekEnd: "2026-05-03",
    entries: {
      "2026-04-30": {
        reflection: { win: "stale" },
      },
    },
    expectedRevision: 0,
    user,
  });

  assert.equal(staleSave.conflict, true);

  const thread = comments.createThread({
    pageId: page.id,
    anchor: "core:mission",
    body: "Discuss this mission.",
    author: user,
  });

  assert.equal(thread.thread.anchor, "core:mission");
  assert.equal(thread.comment.body, "Discuss this mission.");
});

test("local backend supports invite and share-link membership", () => {
  const ownerResult = auth.signUp({
    email: uniqueEmail("owner"),
    password: "test-password",
  });
  const memberResult = auth.signUp({
    email: uniqueEmail("member"),
    password: "test-password",
  });
  const linkResult = auth.signUp({
    email: uniqueEmail("link"),
    password: "test-password",
  });

  const page = pages.createPage({
    title: "Shared Test Page",
    core: { mission: "Share test" },
    owner: ownerResult.user,
  });

  const invite = pages.createInvite({
    pageId: page.id,
    pageTitle: page.title,
    inviteEmail: memberResult.user.email,
    role: "editor",
    inviter: ownerResult.user,
  });

  const acceptedPageId = pages.acceptInvite(invite.id, memberResult.user);
  assert.equal(acceptedPageId, page.id);

  const share = pages.createShareLink({
    pageId: page.id,
    pageTitle: page.title,
    role: "commenter",
    creator: ownerResult.user,
  });

  const joinedPageId = pages.joinShareLink(share.rawToken, linkResult.user);
  assert.equal(joinedPageId, page.id);

  const members = pages.listMembers(page.id, ownerResult.user);
  const roles = new Map(members.map((member) => [member.email, member.role]));
  assert.equal(roles.get(memberResult.user.email), "editor");
  assert.equal(roles.get(linkResult.user.email), "commenter");
});


const personalTracker = require("../server/services/personal-tracker");

test("loop pages can be deleted and renumbered", () => {
  const previousState = fs.existsSync(personalTracker.STATE_FILE)
    ? fs.readFileSync(personalTracker.STATE_FILE, "utf8")
    : null;

  try {
    const date = "2099-02-01";
    const saved = personalTracker.saveTracker({
      entries: {
        [date]: {
          activeLoopPageId: "loop-page-3",
          loopPages: [
            {
              id: "loop-page-1",
              principle: { pattern: "First signal.", principle: "First rule." },
            },
            {
              id: "loop-page-3",
              cardNumber: 3,
              principle: { pattern: "Third signal.", principle: "Third rule." },
            },
          ],
        },
      },
    });

    assert.equal(saved.entries[date].loopPages.length, 2);
    assert.equal(saved.entries[date].loopPages[0].cardNumber, 1);
    assert.equal(saved.entries[date].loopPages[1].cardNumber, 2);
    assert.equal(saved.entries[date].principle.pattern, "Third signal.");
    assert.equal(saved.entries[date].activeLoopPageId, "loop-page-3");
  } finally {
    if (previousState == null) {
      fs.rmSync(personalTracker.STATE_FILE, { force: true });
    } else {
      fs.writeFileSync(personalTracker.STATE_FILE, previousState);
    }
  }
});

test("personal tracker persists local daily loop", () => {
  const previousState = fs.existsSync(personalTracker.STATE_FILE)
    ? fs.readFileSync(personalTracker.STATE_FILE, "utf8")
    : null;

  try {
  const firstDate = "2099-01-05";
  const secondDate = "2099-01-06";
  const loaded = personalTracker.loadTracker();

  assert.ok(loaded.core);
  assert.ok(loaded.entries);

  const saved = personalTracker.saveTracker({
    ...loaded,
    entries: {
      ...loaded.entries,
      [firstDate]: {
        principle: {
          pattern: "Missed the research block.",
          rootCondition: "No protected calendar slot.",
          principle: "Important work needs a visible appointment.",
          mechanism: "Block tomorrow's first 90 minutes before sleep.",
        },
        keyActions: {
          venture: "Message one founder.",
          research: "Write one experiment note.",
          family: "Evening walk.",
        },
      },
    },
  });

  assert.equal(saved.entries[firstDate].principle.rootCondition, "No protected calendar slot.");
  assert.equal(saved.entries[firstDate].loopPages[0].principle.pattern, "Missed the research block.");
  assert.equal(saved.entries[firstDate].loopPages[0].cardNumber, 1);
  assert.equal(personalTracker.loadTracker().entries[firstDate].keyActions.family, "Evening walk.");

  const beforeSecondSave = personalTracker.loadTracker();
  personalTracker.saveTracker({
    ...beforeSecondSave,
    entries: {
      ...beforeSecondSave.entries,
      [secondDate]: {
        principle: {
          pattern: "Context switched too early.",
          rootCondition: "Inbox was open.",
          principle: "Start deep work with closed loops.",
          mechanism: "Close email before opening code.",
        },
      },
    },
  });

  const withPages = personalTracker.loadTracker();
  personalTracker.saveTracker({
    ...withPages,
    entries: {
      ...withPages.entries,
      [firstDate]: {
        ...withPages.entries[firstDate],
        activeLoopPageId: "loop-page-2",
        loopPages: [
          withPages.entries[firstDate].loopPages[0],
          {
            id: "loop-page-2",
            cardNumber: 2,
            title: "Card 2",
            principle: {
              pattern: "Second signal.",
              rootCondition: "Second condition.",
              principle: "Second rule.",
              mechanism: "Second mechanism.",
            },
          },
        ],
      },
    },
  });

  const reloaded = personalTracker.loadTracker();
  assert.equal(reloaded.entries[firstDate].loopPages.length, 2);
  assert.equal(reloaded.entries[firstDate].loopPages[1].cardNumber, 2);
  assert.equal(reloaded.entries[firstDate].activeLoopPageId, "loop-page-2");
  assert.equal(reloaded.entries[firstDate].principle.pattern, "Second signal.");
  assert.equal(reloaded.entries[firstDate].loopPages[0].principle.pattern, "Missed the research block.");
  assert.equal(reloaded.entries[secondDate].principle.mechanism, "Close email before opening code.");
  } finally {
    if (previousState == null) {
      fs.rmSync(personalTracker.STATE_FILE, { force: true });
    } else {
      fs.writeFileSync(personalTracker.STATE_FILE, previousState);
    }
  }
});


const aiDynamics = require("../server/services/ai-dynamics");

test("AI dynamics config reports missing API key", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    assert.equal(aiDynamics.config().hasApiKey, false);
    await assert.rejects(
      () => aiDynamics.analyze({ date: "2099-01-07", entry: {}, model: "gpt-5.2" }),
      /Missing OPENAI_API_KEY/
    );
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("AI dynamics prompt payload excludes API key", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-secret-key";

  try {
    const payload = aiDynamics.analysisInput({
      date: "2099-01-07",
      entry: {
        principle: {
          pattern: "Repeated context switching.",
          rootCondition: "Notifications stayed on.",
          principle: "Deep work starts by removing live inputs.",
          mechanism: "Turn on focus mode before opening papers.",
        },
        keyActions: {
          venture: "Talk to one user.",
          research: "Write one result note.",
          family: "Phone away dinner.",
        },
      },
      recentEntries: {},
      memoryContext: {
        items: [
          {
            type: "root_condition",
            title: "Input pressure",
            body: "Open inbox before planning repeatedly displaces deep work.",
            status: "accepted",
          },
        ],
      },
      core: { mission: "Test mission" },
    });

    assert.match(JSON.stringify(payload), /Repeated context switching/);
    assert.match(JSON.stringify(payload), /Input pressure/);
    assert.doesNotMatch(JSON.stringify(payload), /test-secret-key/);
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("AI dynamics memory extraction prompt includes source and existing memory", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const payload = aiDynamics.memoryExtractionInput({
      date: "2099-01-10",
      entry: {
        principle: {
          pattern: "Skipped a user call.",
          rootCondition: "Research task felt safer than reality contact.",
          principle: "Reality contact comes before internal refinement.",
          mechanism: "Book the call before opening the paper queue.",
        },
      },
      analysis: "The system drifts toward safer internal work unless reality contact is scheduled.",
      source: { date: "2099-01-10", loopPageId: "loop-page-2", analysisId: "analysis-2" },
      memoryContext: {
        items: [
          {
            type: "recurring_pattern",
            title: "Safety drift",
            body: "Abstract work can become avoidance when no external contact is scheduled.",
            status: "accepted",
          },
        ],
      },
    });

    const promptText = JSON.stringify(payload);
    assert.match(promptText, /loop-page-2/);
    assert.match(promptText, /Safety drift/);
    await assert.rejects(
      () => aiDynamics.extractMemory({ date: "2099-01-10", entry: {}, model: "gpt-5.2" }),
      /Missing OPENAI_API_KEY/
    );
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("personal tracker preserves saved AI analyses", () => {
  const previousState = fs.existsSync(personalTracker.STATE_FILE)
    ? fs.readFileSync(personalTracker.STATE_FILE, "utf8")
    : null;

  try {
    const date = "2099-01-08";
    const saved = personalTracker.saveTracker({
      entries: {
        [date]: {
          principle: {
            pattern: "Skipped planning.",
            rootCondition: "Started day in inbox.",
            principle: "Planning must precede inputs.",
            mechanism: "Open tracker before browser.",
          },
          aiAnalyses: [
            {
              id: "analysis-1",
              createdAt: "2099-01-08T00:00:00.000Z",
              model: "gpt-5.2",
              promptType: "dynamics-analysis",
              inputSummary: { signalMistake: "Skipped planning." },
              analysisText: "State: planning lost to input pressure.",
              messages: [{ role: "assistant", content: "State: planning lost to input pressure." }],
            },
          ],
        },
      },
    });

    assert.equal(saved.entries[date].aiAnalyses[0].id, "analysis-1");
    assert.equal(personalTracker.loadTracker().entries[date].aiAnalyses[0].model, "gpt-5.2");
  } finally {
    if (previousState == null) {
      fs.rmSync(personalTracker.STATE_FILE, { force: true });
    } else {
      fs.writeFileSync(personalTracker.STATE_FILE, previousState);
    }
  }
});

test("personal tracker normalizes and persists accepted memory", () => {
  const previousState = fs.existsSync(personalTracker.STATE_FILE)
    ? fs.readFileSync(personalTracker.STATE_FILE, "utf8")
    : null;

  try {
    const withoutMemory = personalTracker.saveTracker({ entries: {} });
    assert.deepEqual(withoutMemory.memory.items, []);

    const saved = personalTracker.saveTracker({
      ...withoutMemory,
      memory: {
        items: [
          {
            id: "memory-1",
            type: "principle",
            title: "Protect reality contact",
            body: "When work becomes abstract, create one reality-facing interaction before optimizing.",
            source: { date: "2099-01-09", loopPageId: "loop-page-1", analysisId: "analysis-1" },
            confidence: 0.82,
            status: "accepted",
          },
        ],
      },
    });

    assert.equal(saved.memory.version, 1);
    assert.equal(saved.memory.items[0].id, "memory-1");
    assert.equal(saved.memory.items[0].source.date, "2099-01-09");
    assert.equal(personalTracker.loadTracker().memory.items[0].title, "Protect reality contact");
  } finally {
    if (previousState == null) {
      fs.rmSync(personalTracker.STATE_FILE, { force: true });
    } else {
      fs.writeFileSync(personalTracker.STATE_FILE, previousState);
    }
  }
});


test("AI dynamics sanitizes reasoning effort", () => {
  assert.equal(aiDynamics.sanitizeReasoningEffort("high"), "high");
  assert.equal(aiDynamics.sanitizeReasoningEffort("medium"), "medium");
  assert.equal(aiDynamics.sanitizeReasoningEffort("instant"), "high");
});


test("AI dynamics parses SSE response output", () => {
  const text = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"o"}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"k"}',
    '',
    'event: response.output_text.done',
    'data: {"type":"response.output_text.done","text":"ok"}',
    '',
  ].join("\n");
  assert.equal(aiDynamics.parseSseResponse(text), "ok");
});
