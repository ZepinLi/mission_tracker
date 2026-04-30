import {
  describeAnchor,
  makeMissionAnchor,
  makePrincipleAnchor,
  makeReflectionAnchor,
} from "./lib/anchors.js";
import { localDateISO, parseLocalDate } from "./lib/date.js";
import { applyConflictStrategy, threeWayMerge } from "./state/merge.js";
import {
  compactEntries,
  createEmptyEntry,
  dayScore,
  ensureActionRecord,
  ensureEntry,
  mergeCore,
  normalizeTrackerState,
} from "./state/schema.js";
import {
  canComment,
  canEdit,
  canManage,
  deepEqual,
  displayNameFromEmail,
  hashContent,
  safeJsonParse,
  toPercent,
} from "./lib/utils.js";
import {
  clearPendingShareToken,
  getPendingShareToken,
  getRecentShareLink,
  getSelectedPageSlug,
  readLegacyLocalState,
  readPageCache,
  setPendingShareToken,
  setRecentShareLink,
  setSelectedPageSlug,
  writePageCache,
} from "./storage/local-cache.js";
import {
  buildCommentStats,
  computeDashboardStats,
  renderActionBoard,
  renderBalanceBars,
  renderCommentThreads,
  renderConflictSummary,
  renderIdentities,
  renderInviteList,
  renderMemberList,
  renderPageOptions,
  renderPendingInvites,
  renderPrincipleCards,
  renderShareLinks,
  renderHeatmap,
} from "./ui/render.js";

function entriesFromWeeks(weeks) {
  return (weeks || []).reduce((result, week) => {
    Object.assign(result, week.entries || {});
    return result;
  }, {});
}

function weekRevisionsFromRows(weeks) {
  return (weeks || []).reduce((result, row) => {
    result[row.weekKey] = {
      id: row.id,
      revision: row.revision,
      updatedAt: row.updatedAt,
    };
    return result;
  }, {});
}

function cacheMatchesRemote(cache, remoteSnapshot) {
  if (!cache?.base) return false;
  if (Number(cache.base.pageRevision || 0) !== Number(remoteSnapshot.pageRevision || 0)) {
    return false;
  }
  const localKeys = Object.keys(cache.base.weekRevisions || {}).sort();
  const remoteKeys = Object.keys(remoteSnapshot.weekRevisions || {}).sort();
  if (localKeys.join("|") !== remoteKeys.join("|")) {
    return false;
  }
  return remoteKeys.every((key) => {
    return Number(cache.base.weekRevisions[key]?.revision || 0) === Number(remoteSnapshot.weekRevisions[key]?.revision || 0);
  });
}

function snapshotFromBundle(bundle) {
  return {
    state: {
      title: bundle.page.title,
      visibility: bundle.page.visibility,
      core: mergeCore(bundle.page.core),
      entries: entriesFromWeeks(bundle.weeks),
    },
    pageRevision: bundle.page.revision,
    weekRevisions: weekRevisionsFromRows(bundle.weeks),
  };
}

function commentsByThreadId(comments) {
  return (comments || []).reduce((result, comment) => {
    if (!result[comment.threadId]) {
      result[comment.threadId] = [];
    }
    result[comment.threadId].push(comment);
    return result;
  }, {});
}

function getRouteState() {
  const path = window.location.pathname || "/";
  const joinMatch = path.match(/^\/join\/([^/]+)/);
  if (joinMatch) {
    return {
      kind: "join",
      token: decodeURIComponent(joinMatch[1]),
    };
  }
  const pageMatch = path.match(/^\/p\/([^/]+)/);
  if (pageMatch) {
    return {
      kind: "page",
      slug: decodeURIComponent(pageMatch[1]),
    };
  }
  return {
    kind: "home",
  };
}

export class MissionTrackerController {
  constructor({ dom, repository }) {
    this.dom = dom;
    this.repository = repository;
    this.user = null;
    this.profile = null;
    this.pages = [];
    this.pendingInvites = [];
    this.currentPage = null;
    this.currentRole = "viewer";
    this.members = [];
    this.invites = [];
    this.shareLinks = [];
    this.threads = [];
    this.comments = [];
    this.draft = {
      title: "Untitled Page",
      visibility: "private",
      core: mergeCore({}),
      entries: {},
    };
    this.baseSnapshot = null;
    this.selectedDate = localDateISO(new Date());
    this.selectedAnchor = "";
    this.currentTab = "comments";
    this.conflicts = [];
    this.pendingConflictState = null;
    this.saveTimer = null;
    this.remoteRefreshTimer = null;
    this.unsubscribeRealtime = () => {};
    this.isSaving = false;
    this.isDirty = false;
    this.notice = null;
    this.recentShareLink = getRecentShareLink();
    this.cloudEnabled = this.repository.isCloudEnabled();
  }

  async init() {
    this.bindEvents();
    this.dom.datePicker.value = this.selectedDate;

    if (!this.cloudEnabled) {
      this.bootstrapLocalDraftMode();
      this.render();
      return;
    }

    this.user = await this.repository.getSessionUser();
    this.repository.onAuthStateChange(async (user) => {
      this.user = user;
      if (user) {
        await this.bootstrapAuthenticatedSession();
      } else {
        this.profile = null;
        this.pages = [];
        this.currentPage = null;
        this.members = [];
        this.invites = [];
        this.shareLinks = [];
        this.threads = [];
        this.comments = [];
        this.unsubscribeRealtime();
        this.render();
      }
    });

    if (this.user) {
      await this.bootstrapAuthenticatedSession();
    }

    this.render();
  }

  bindEvents() {
    window.addEventListener("popstate", async () => {
      if (this.user && this.cloudEnabled) {
        await this.openPageFromRoute();
      }
    });

    this.dom.pageSelect.addEventListener("change", async (event) => {
      const pageId = event.target.value;
      const page = this.pages.find((item) => item.id === pageId);
      if (page) {
        await this.openPage(page);
      }
    });

    this.dom.newPageButton.addEventListener("click", async () => {
      await this.createPage();
    });

    this.dom.copyPageUrlButton.addEventListener("click", async () => {
      if (!this.currentPage) return;
      await navigator.clipboard.writeText(this.pageUrl(this.currentPage));
      this.setNotice("Page URL copied.");
      this.render();
    });

    this.dom.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await this.repository.signIn(this.dom.authEmail.value.trim(), this.dom.authPassword.value);
        this.setAuthMessage("Signed in. Loading your pages...", "success");
      } catch (error) {
        this.setAuthMessage(error.message || "Unable to sign in.", "error");
      }
      this.render();
    });

    this.dom.signUpButton.addEventListener("click", async () => {
      try {
        await this.repository.signUp(this.dom.authEmail.value.trim(), this.dom.authPassword.value);
        this.setAuthMessage("Account created. Check your email if confirmation is enabled.", "success");
      } catch (error) {
        this.setAuthMessage(error.message || "Unable to sign up.", "error");
      }
      this.render();
    });

    this.dom.signOutButton.addEventListener("click", async () => {
      try {
        await this.repository.signOut();
      } catch (error) {
        this.setAuthMessage(error.message || "Unable to sign out.", "error");
      }
    });

    this.dom.previousDay.addEventListener("click", () => this.shiftDay(-1));
    this.dom.nextDay.addEventListener("click", () => this.shiftDay(1));
    this.dom.todayButton.addEventListener("click", () => this.setSelectedDate(localDateISO(new Date())));
    this.dom.datePicker.addEventListener("change", (event) => this.setSelectedDate(event.target.value));
    this.dom.saveButton.addEventListener("click", async () => this.saveDraft("manual"));
    this.dom.exportButton.addEventListener("click", () => this.exportPage());
    this.dom.importInput.addEventListener("change", async (event) => this.importPage(event));
    this.dom.clearDayButton.addEventListener("click", async () => this.clearSelectedDay());

    this.dom.noticeAcceptButton.addEventListener("click", async () => {
      if (this.notice?.cta?.run) {
        await this.notice.cta.run();
      }
      this.notice = null;
      this.render();
    });
    this.dom.noticeDismissButton.addEventListener("click", () => {
      this.notice = null;
      this.render();
    });

    this.dom.missionInput.addEventListener("input", (event) => {
      this.draft.core.mission = event.target.value;
      this.markDirty();
    });

    this.dom.pageTitleInput.addEventListener("input", (event) => {
      this.draft.title = event.target.value;
      this.markDirty();
    });

    this.dom.pageVisibilitySelect.addEventListener("change", (event) => {
      this.draft.visibility = event.target.value;
      this.markDirty();
    });

    this.dom.actionBoard.addEventListener("click", (event) => this.handleActionBoardClick(event));
    this.dom.actionBoard.addEventListener("input", (event) => this.handleActionBoardInput(event));
    this.dom.actionBoard.addEventListener("change", (event) => this.handleActionBoardChange(event));

    [
      [this.dom.oneThingInput, "oneThing"],
      [this.dom.avoidInput, "avoid"],
      [this.dom.winInput, "win"],
      [this.dom.lessonInput, "lesson"],
    ].forEach(([element, field]) => {
      element.addEventListener("input", (event) => {
        ensureEntry(this.draft.entries, this.selectedDate).reflection[field] = event.target.value;
        this.markDirty();
      });
    });

    [
      [this.dom.patternInput, "pattern"],
      [this.dom.principleInput, "principle"],
      [this.dom.mechanismInput, "mechanism"],
    ].forEach(([element, field]) => {
      element.addEventListener("input", (event) => {
        ensureEntry(this.draft.entries, this.selectedDate).principle[field] = event.target.value;
        this.markDirty();
        this.render();
      });
    });

    this.dom.sidebarTabs.forEach((button) => {
      button.addEventListener("click", () => {
        this.currentTab = button.dataset.sidebarTab;
        this.render();
      });
    });

    document.addEventListener("click", async (event) => {
      const commentButton = event.target.closest("[data-comment-anchor]");
      if (commentButton) {
        this.selectedAnchor = commentButton.dataset.commentAnchor;
        this.currentTab = "comments";
        this.render();
        return;
      }

      const acceptInvite = event.target.closest("[data-accept-invite]");
      if (acceptInvite) {
        await this.acceptInvite(acceptInvite.dataset.acceptInvite);
        return;
      }

      const revokeInvite = event.target.closest("[data-revoke-invite]");
      if (revokeInvite) {
        await this.revokeInvite(revokeInvite.dataset.revokeInvite);
        return;
      }

      const revokeShareLink = event.target.closest("[data-revoke-share-link]");
      if (revokeShareLink) {
        await this.revokeShareLink(revokeShareLink.dataset.revokeShareLink);
        return;
      }

      const removeMember = event.target.closest("[data-remove-member]");
      if (removeMember) {
        await this.removeMember(removeMember.dataset.removeMember);
        return;
      }

      const resolveThread = event.target.closest("[data-resolve-thread]");
      if (resolveThread) {
        await this.setThreadStatus(resolveThread.dataset.resolveThread, "resolved");
        return;
      }

      const reopenThread = event.target.closest("[data-reopen-thread]");
      if (reopenThread) {
        await this.setThreadStatus(reopenThread.dataset.reopenThread, "open");
        return;
      }

      const replyThread = event.target.closest("[data-reply-thread]");
      if (replyThread) {
        await this.replyToThread(replyThread.dataset.replyThread);
      }
    });

    document.addEventListener("change", async (event) => {
      const roleSelect = event.target.closest("[data-member-role]");
      if (roleSelect) {
        await this.updateMemberRole(roleSelect.dataset.memberRole, roleSelect.value);
      }
    });

    this.dom.inviteButton.addEventListener("click", async () => {
      await this.createInvite();
    });

    this.dom.createShareLinkButton.addEventListener("click", async () => {
      await this.createShareLink();
    });

    this.dom.createThreadButton.addEventListener("click", async () => {
      await this.createThread();
    });

    this.dom.useLocalConflictsButton.addEventListener("click", async () => {
      await this.resolveConflict("local");
    });

    this.dom.useRemoteConflictsButton.addEventListener("click", async () => {
      await this.resolveConflict("remote");
    });
  }

  bootstrapLocalDraftMode() {
    const legacy = normalizeTrackerState(readLegacyLocalState() || {});
    this.currentPage = {
      id: "local-sandbox",
      ownerId: "local",
      slug: "local-sandbox",
      title: "Local Sandbox",
      visibility: "private",
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    this.pages = [this.currentPage];
    this.currentRole = "owner";
    this.draft = {
      title: "Local Sandbox",
      visibility: "private",
      core: mergeCore(legacy.core),
      entries: legacy.entries || {},
    };
    this.selectedAnchor = makeMissionAnchor();
    this.notice = {
      message: "Supabase is not configured. Running in local draft mode without sharing or realtime sync.",
    };
  }

  async bootstrapAuthenticatedSession() {
    this.profile = await this.repository.ensureProfile(this.user);
    this.pendingInvites = await this.repository.listPendingInvitesForUser(this.user);
    this.pages = await this.repository.listPages();

    if (!this.pages.length) {
      await this.createDefaultPageForUser();
      this.pages = await this.repository.listPages();
    }

    await this.maybeJoinPendingShareLink();
    await this.openPageFromRoute();
    this.render();
  }

  async maybeJoinPendingShareLink() {
    const route = getRouteState();
    const pendingShareToken = route.kind === "join" ? route.token : getPendingShareToken();
    if (!pendingShareToken || !this.user) return;

    try {
      const joinedPageId = await this.repository.joinShareLink(pendingShareToken);
      clearPendingShareToken();
      this.pages = await this.repository.listPages();
      const joinedPage = this.pages.find((page) => page.id === joinedPageId);
      if (joinedPage) {
        await this.openPage(joinedPage);
      }
      this.setNotice("Joined shared page.");
    } catch (error) {
      setPendingShareToken(pendingShareToken);
      this.setNotice(error.message || "Unable to join that share link.");
    }
  }

  async createDefaultPageForUser() {
    const legacyCloud = await this.repository.loadLegacyPersonalTracker(this.user.id);
    const legacyLocal = normalizeTrackerState(readLegacyLocalState() || {});
    const seed = legacyCloud || legacyLocal || normalizeTrackerState({});
    const title = seed.core?.mission
      ? `${seed.core.mission.split(".")[0].slice(0, 28) || "My Mission"}`
      : "My Mission Page";

    await this.repository.createPage({
      title,
      core: seed.core,
      owner: this.profile,
    });
  }

  async openPageFromRoute() {
    const route = getRouteState();

    if (route.kind === "join") {
      if (!this.user) {
        setPendingShareToken(route.token);
        this.setNotice("Sign in to join the shared page.", {
          label: "I am signed in",
          run: async () => {
            await this.bootstrapAuthenticatedSession();
          },
        });
        this.render();
        return;
      }
      await this.maybeJoinPendingShareLink();
      return;
    }

    let page = null;
    if (route.kind === "page") {
      page = this.pages.find((item) => item.slug === route.slug) || null;
    }

    if (!page) {
      const selectedSlug = getSelectedPageSlug();
      page = this.pages.find((item) => item.slug === selectedSlug) || null;
    }

    if (!page) {
      page = this.pages.find((item) => item.id === this.profile?.defaultPageId) || this.pages[0] || null;
    }

    if (page) {
      await this.openPage(page);
    }
  }

  async openPage(page) {
    if (!page) return;
    this.unsubscribeRealtime();
    const bundle = await this.repository.loadPageBundle(page.id);
    await this.applyBundle(bundle);
    this.subscribeToPage(page.id);
    this.navigateToPage(bundle.page);
  }

  async applyBundle(bundle) {
    const remoteSnapshot = snapshotFromBundle(bundle);
    const cache = readPageCache(bundle.page.id);
    const baseState = remoteSnapshot.state;
    const remoteRole =
      bundle.members.find((member) => member.userId === this.user?.id)?.role ||
      (bundle.page.ownerId === this.user?.id ? "owner" : "viewer");

    let nextDraft = baseState;
    this.conflicts = [];
    this.pendingConflictState = null;

    if (cache?.draft && cache?.base) {
      if (cacheMatchesRemote(cache, remoteSnapshot)) {
        nextDraft = cache.draft;
        this.setNotice("Restored your unsaved local draft.");
      } else {
        const mergeResult = threeWayMerge(cache.base.state, cache.draft, baseState, ["page"]);
        nextDraft = mergeResult.merged;
        this.conflicts = mergeResult.conflicts;
        this.pendingConflictState = {
          merged: mergeResult.merged,
          remote: baseState,
          conflicts: mergeResult.conflicts,
        };
        if (!mergeResult.conflicts.length) {
          this.setNotice("Merged remote updates with your local draft.");
        } else {
          this.setNotice("Remote updates conflicted with your unsaved local draft.");
        }
      }
    }

    this.currentPage = bundle.page;
    this.currentRole = remoteRole;
    this.members = bundle.members;
    this.invites = bundle.invites;
    this.shareLinks = bundle.shareLinks;
    this.threads = bundle.threads;
    this.comments = bundle.comments;
    this.draft = {
      title: nextDraft.title || bundle.page.title,
      visibility: nextDraft.visibility || bundle.page.visibility,
      core: mergeCore(nextDraft.core),
      entries: nextDraft.entries || {},
    };
    this.baseSnapshot = remoteSnapshot;
    this.selectedAnchor = this.selectedAnchor || makeMissionAnchor();
    this.isDirty = cache?.draft && !deepEqual(cache.draft, remoteSnapshot.state);
    this.persistLocalCache();
    this.render();
  }

  subscribeToPage(pageId) {
    this.unsubscribeRealtime = this.repository.subscribeToPage(pageId, {
      onPageChange: (payload) => {
        if (payload.new?.last_writer_id === this.user?.id) return;
        this.queueRemoteRefresh();
      },
      onWeeksChange: (payload) => {
        if (payload.new?.last_writer_id === this.user?.id) return;
        this.queueRemoteRefresh();
      },
      onThreadsChange: (payload) => {
        if (payload.new?.author_id === this.user?.id) return;
        this.queueRemoteRefresh();
      },
      onCommentsChange: (payload) => {
        if (payload.new?.author_id === this.user?.id) return;
        this.queueRemoteRefresh();
      },
      onMembersChange: (payload) => {
        if (payload.new?.user_id === this.user?.id) return;
        this.queueRemoteRefresh();
      },
    });
  }

  queueRemoteRefresh() {
    window.clearTimeout(this.remoteRefreshTimer);
    this.remoteRefreshTimer = window.setTimeout(async () => {
      if (!this.currentPage) return;
      const bundle = await this.repository.loadPageBundle(this.currentPage.id);
      await this.applyBundle(bundle);
      this.setNotice("Remote changes synced.");
      this.render();
    }, 450);
  }

  pageUrl(page) {
    return `${window.location.origin}/p/${page.slug}`;
  }

  navigateToPage(page) {
    const path = `/p/${page.slug}`;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setSelectedPageSlug(page.slug);
  }

  markDirty() {
    this.isDirty = true;
    this.persistLocalCache();
    if (canEdit(this.currentRole) && this.cloudEnabled && this.user && this.currentPage) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        this.saveDraft("auto");
      }, 800);
    }
    this.render();
  }

  persistLocalCache() {
    if (!this.currentPage) return;
    writePageCache(this.currentPage.id, {
      draft: this.draft,
      base: this.baseSnapshot,
      selectedDate: this.selectedDate,
      selectedAnchor: this.selectedAnchor,
      savedAt: new Date().toISOString(),
    });
  }

  setSelectedDate(date) {
    if (!date) return;
    this.selectedDate = date;
    ensureEntry(this.draft.entries, this.selectedDate);
    this.persistLocalCache();
    this.render();
  }

  shiftDay(delta) {
    const date = parseLocalDate(this.selectedDate);
    date.setDate(date.getDate() + delta);
    this.setSelectedDate(localDateISO(date));
  }

  async saveDraft(mode = "auto") {
    if (!this.currentPage || !this.user || !this.cloudEnabled || !canEdit(this.currentRole)) {
      return;
    }
    if (!this.baseSnapshot) return;
    if (!this.isDirty && mode !== "manual") return;
    if (!this.isDirty && mode === "manual") {
      this.setNotice("No unsaved changes.");
      this.render();
      return;
    }
    this.isSaving = true;
    this.render();

    try {
      const coreChanged = !deepEqual(
        {
          title: this.draft.title,
          visibility: this.draft.visibility,
          core: this.draft.core,
        },
        {
          title: this.baseSnapshot.state.title,
          visibility: this.baseSnapshot.state.visibility,
          core: this.baseSnapshot.state.core,
        }
      );

      if (coreChanged) {
        const pageSave = await this.repository.savePageCore({
          pageId: this.currentPage.id,
          title: this.draft.title,
          visibility: this.draft.visibility,
          core: this.draft.core,
          expectedRevision: this.baseSnapshot.pageRevision,
          userId: this.user.id,
        });
        if (pageSave.conflict) {
          await this.handleSaveConflict();
          return;
        }
        this.currentPage = pageSave.page;
      }

      const existingWeeksByKey = this.baseSnapshot.weekRevisions;
      const weekSave = await this.repository.saveEntriesForPage({
        pageId: this.currentPage.id,
        entries: this.draft.entries,
        existingWeeksByKey,
        userId: this.user.id,
      });

      if (weekSave.conflicts.length) {
        await this.handleSaveConflict();
        return;
      }

      const freshBundle = await this.repository.loadPageBundle(this.currentPage.id);
      this.baseSnapshot = snapshotFromBundle(freshBundle);
      this.currentPage = freshBundle.page;
      this.members = freshBundle.members;
      this.invites = freshBundle.invites;
      this.shareLinks = freshBundle.shareLinks;
      this.threads = freshBundle.threads;
      this.comments = freshBundle.comments;
      this.draft = {
        title: this.currentPage.title,
        visibility: this.currentPage.visibility,
        core: mergeCore(this.currentPage.core),
        entries: entriesFromWeeks(freshBundle.weeks),
      };
      this.isDirty = false;
      this.conflicts = [];
      this.pendingConflictState = null;
      this.persistLocalCache();
      this.setNotice(mode === "manual" ? "Page saved." : "Synced.");
    } catch (error) {
      this.setNotice(error.message || "Unable to save right now.");
    } finally {
      this.isSaving = false;
      this.render();
    }
  }

  async handleSaveConflict() {
    const freshBundle = await this.repository.loadPageBundle(this.currentPage.id);
    const remoteSnapshot = snapshotFromBundle(freshBundle);
    const mergeResult = threeWayMerge(this.baseSnapshot.state, this.draft, remoteSnapshot.state, ["page"]);

    this.currentPage = freshBundle.page;
    this.members = freshBundle.members;
    this.invites = freshBundle.invites;
    this.shareLinks = freshBundle.shareLinks;
    this.threads = freshBundle.threads;
    this.comments = freshBundle.comments;
    this.baseSnapshot = remoteSnapshot;
    this.draft = mergeResult.merged;
    this.conflicts = mergeResult.conflicts;
    this.pendingConflictState = {
      merged: mergeResult.merged,
      remote: remoteSnapshot.state,
      conflicts: mergeResult.conflicts,
    };
    this.persistLocalCache();

    if (!mergeResult.conflicts.length) {
      this.setNotice("Remote updates merged automatically. Saving again...");
      await this.saveDraft("auto");
      return;
    }

    this.isDirty = true;
    this.setNotice("Save conflict detected. Choose whether to keep your edits or the remote version.");
    this.render();
  }

  async resolveConflict(strategy) {
    if (!this.pendingConflictState) return;
    this.draft = applyConflictStrategy(
      this.pendingConflictState.merged,
      this.pendingConflictState.conflicts,
      strategy
    );
    this.conflicts = [];
    this.pendingConflictState = null;
    this.isDirty = true;
    this.persistLocalCache();
    this.render();
    await this.saveDraft("manual");
  }

  handleActionBoardClick(event) {
    if (!canEdit(this.currentRole)) return;
    const button = event.target.closest("[data-action-level]");
    if (!button) return;
    const actionId = button.dataset.actionId;
    const record = ensureActionRecord(this.draft.entries, this.selectedDate, actionId);
    const action = this.draft.core.actions.find((item) => item.id === actionId);
    if (!action) return;

    if (button.dataset.actionLevel === "none") {
      record.value = 0;
    } else if (button.dataset.actionLevel === "minimum") {
      record.value = action.minimum;
    } else {
      record.value = action.target;
    }
    this.markDirty();
    this.render();
  }

  handleActionBoardInput(event) {
    if (!canEdit(this.currentRole)) return;
    const keyActionInput = event.target.closest("[data-key-action]");
    if (keyActionInput) {
      ensureEntry(this.draft.entries, this.selectedDate).keyActions[keyActionInput.dataset.identityId] =
        keyActionInput.value;
      this.markDirty();
      return;
    }

    const noteInput = event.target.closest("[data-action-note]");
    if (noteInput) {
      ensureActionRecord(this.draft.entries, this.selectedDate, noteInput.dataset.actionId).note =
        noteInput.value;
      this.markDirty();
    }
  }

  handleActionBoardChange(event) {
    if (!canEdit(this.currentRole)) return;
    const valueInput = event.target.closest("[data-action-value]");
    if (!valueInput) return;
    ensureActionRecord(this.draft.entries, this.selectedDate, valueInput.dataset.actionId).value =
      Number(valueInput.value || 0);
    this.markDirty();
    this.render();
  }

  async createPage() {
    if (!this.user || !this.profile || !this.cloudEnabled) return;
    const newPage = await this.repository.createPage({
      title: `New Page ${this.pages.length + 1}`,
      core: mergeCore({}),
      owner: this.profile,
    });
    this.pages = await this.repository.listPages();
    await this.openPage(newPage);
    this.setNotice("Created a new page.");
    this.render();
  }

  async createInvite() {
    if (!this.cloudEnabled || !this.user || !this.profile || !canManage(this.currentRole) || !this.currentPage) {
      return;
    }
    const email = this.dom.inviteEmailInput.value.trim();
    if (!email) return;
    await this.repository.createInvite({
      pageId: this.currentPage.id,
      pageTitle: this.currentPage.title,
      inviteEmail: email,
      role: this.dom.inviteRoleSelect.value,
      inviter: this.profile,
    });
    this.dom.inviteEmailInput.value = "";
    this.invites = await this.repository.listPageInvites(this.currentPage.id);
    this.render();
  }

  async revokeInvite(inviteId) {
    if (!this.cloudEnabled || !this.user || !this.currentPage) return;
    await this.repository.revokeInvite(inviteId);
    this.invites = await this.repository.listPageInvites(this.currentPage.id);
    this.render();
  }

  async acceptInvite(inviteId) {
    if (!this.cloudEnabled || !this.user) return;
    const acceptedPageId = await this.repository.acceptInvite(inviteId);
    this.pendingInvites = await this.repository.listPendingInvitesForUser(this.user);
    this.pages = await this.repository.listPages();
    const page = this.pages.find((item) => item.id === acceptedPageId);
    if (page) {
      await this.openPage(page);
    } else {
      await this.openPageFromRoute();
    }
    this.render();
  }

  async createShareLink() {
    if (!this.cloudEnabled || !this.user || !this.profile || !canManage(this.currentRole) || !this.currentPage) {
      return;
    }
    const { link, rawToken } = await this.repository.createShareLink({
      pageId: this.currentPage.id,
      pageTitle: this.currentPage.title,
      role: this.dom.shareRoleSelect.value,
      creator: this.profile,
    });
    const rawUrl = `${window.location.origin}/join/${rawToken}`;
    this.recentShareLink = {
      ...link,
      rawUrl,
    };
    setRecentShareLink(this.recentShareLink);
    await navigator.clipboard.writeText(rawUrl);
    this.shareLinks = await this.repository.listShareLinks(this.currentPage.id);
    this.setNotice("Share link created and copied. The raw link is only shown once.");
    this.render();
  }

  async revokeShareLink(linkId) {
    if (!this.cloudEnabled || !this.user || !this.currentPage) return;
    await this.repository.revokeShareLink(linkId);
    this.shareLinks = await this.repository.listShareLinks(this.currentPage.id);
    this.render();
  }

  async updateMemberRole(userId, role) {
    if (!this.cloudEnabled || !this.user || !canManage(this.currentRole)) return;
    await this.repository.updateMemberRole(this.currentPage.id, userId, role);
    this.members = await this.repository.listPageMembers(this.currentPage.id);
    this.render();
  }

  async removeMember(userId) {
    if (!this.cloudEnabled || !this.user || !canManage(this.currentRole)) return;
    await this.repository.removeMember(this.currentPage.id, userId);
    this.members = await this.repository.listPageMembers(this.currentPage.id);
    this.render();
  }

  async createThread() {
    if (
      !this.cloudEnabled ||
      !this.user ||
      !this.profile ||
      !this.currentPage ||
      !this.selectedAnchor ||
      !canComment(this.currentRole)
    ) {
      return;
    }
    const body = this.dom.newCommentBody.value.trim();
    if (!body) return;
    await this.repository.createThread({
      pageId: this.currentPage.id,
      anchor: this.selectedAnchor,
      body,
      author: this.profile,
    });
    this.dom.newCommentBody.value = "";
    this.threads = await this.repository.listCommentThreads(this.currentPage.id);
    this.comments = await this.repository.listComments(this.currentPage.id);
    this.currentTab = "comments";
    this.render();
  }

  async replyToThread(threadId) {
    if (!this.cloudEnabled || !this.user || !this.profile || !canComment(this.currentRole)) return;
    const input = document.querySelector(`[data-reply-input="${threadId}"]`);
    const body = input?.value.trim();
    if (!body) return;
    await this.repository.createComment({
      threadId,
      pageId: this.currentPage.id,
      body,
      author: this.profile,
    });
    input.value = "";
    this.threads = await this.repository.listCommentThreads(this.currentPage.id);
    this.comments = await this.repository.listComments(this.currentPage.id);
    this.render();
  }

  async setThreadStatus(threadId, status) {
    if (!this.cloudEnabled || !this.user || !this.profile || !canComment(this.currentRole)) return;
    await this.repository.setThreadStatus({
      threadId,
      status,
      actor: this.profile,
    });
    this.threads = await this.repository.listCommentThreads(this.currentPage.id);
    this.comments = await this.repository.listComments(this.currentPage.id);
    this.render();
  }

  exportPage() {
    if (!this.currentPage) return;
    const payload = {
      page: {
        id: this.currentPage.id,
        slug: this.currentPage.slug,
        title: this.draft.title,
        visibility: this.draft.visibility,
      },
      core: this.draft.core,
      entries: compactEntries(this.draft.entries),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.currentPage.slug || "mission-page"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async importPage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const payload = safeJsonParse(text, null);
    if (!payload || typeof payload !== "object") {
      window.alert("Import failed. Choose a valid mission tracker JSON file.");
      event.target.value = "";
      return;
    }

    this.draft = {
      title: payload.page?.title || this.draft.title,
      visibility: payload.page?.visibility || this.draft.visibility,
      core: mergeCore(payload.core),
      entries: normalizeTrackerState({ entries: payload.entries || {} }).entries,
    };
    this.isDirty = true;
    this.persistLocalCache();
    this.setNotice("Imported JSON into the current page draft. Save to sync it.");
    event.target.value = "";
    this.render();
  }

  async clearSelectedDay() {
    if (!this.currentPage) return;
    const score = dayScore(this.draft.core, this.draft.entries, this.selectedDate);
    const ok = window.confirm(
      `Clear tracker data for ${this.selectedDate}? Current alignment is ${toPercent(score)}.`
    );
    if (!ok) return;
    delete this.draft.entries[this.selectedDate];
    this.markDirty();
    this.render();
  }

  setNotice(message, cta = null) {
    this.notice = message
      ? {
          message,
          cta,
        }
      : null;
  }

  setAuthMessage(message, type = "") {
    this.dom.authMessage.textContent = message || "";
    this.dom.authMessage.dataset.state = type;
  }

  refreshStaticCommentButtons(commentStats) {
    const mapping = [
      ["missionCommentButton", makeMissionAnchor(), "Mission Core discussion"],
      ["oneThingCommentButton", makeReflectionAnchor(this.selectedDate, "oneThing"), "One thing discussion"],
      ["avoidCommentButton", makeReflectionAnchor(this.selectedDate, "avoid"), "Avoid today discussion"],
      ["winCommentButton", makeReflectionAnchor(this.selectedDate, "win"), "Win discussion"],
      ["lessonCommentButton", makeReflectionAnchor(this.selectedDate, "lesson"), "Lesson discussion"],
      ["patternCommentButton", makePrincipleAnchor(this.selectedDate, "pattern"), "Pattern discussion"],
      ["principleCommentButton", makePrincipleAnchor(this.selectedDate, "principle"), "Principle discussion"],
      ["mechanismCommentButton", makePrincipleAnchor(this.selectedDate, "mechanism"), "Mechanism discussion"],
    ];

    for (const [domKey, anchor, label] of mapping) {
      const button = this.dom[domKey];
      if (!button) continue;
      const stats = commentStats[anchor] || { openCount: 0, totalCount: 0 };
      button.dataset.commentAnchor = anchor;
      button.classList.toggle("active", anchor === this.selectedAnchor);
      button.innerHTML = `<span>Comment</span>${stats.openCount || stats.totalCount ? `<strong>${stats.openCount || stats.totalCount}</strong>` : ""}`;
      button.setAttribute("aria-label", label);
    }
  }

  setEditability(canUserEdit) {
    const disabled = !canUserEdit;
    [
      this.dom.missionInput,
      this.dom.pageTitleInput,
      this.dom.pageVisibilitySelect,
      this.dom.oneThingInput,
      this.dom.avoidInput,
      this.dom.winInput,
      this.dom.lessonInput,
      this.dom.patternInput,
      this.dom.principleInput,
      this.dom.mechanismInput,
      this.dom.clearDayButton,
      this.dom.saveButton,
    ].forEach((element) => {
      if (element) {
        element.disabled = disabled;
      }
    });
    this.dom.actionBoard
      .querySelectorAll("button, input, textarea")
      .forEach((element) => {
        if (!element.matches("[data-comment-anchor]")) {
          element.disabled = disabled;
        }
      });
  }

  render() {
    const commentStats = buildCommentStats(this.threads);
    const threadComments = commentsByThreadId(this.comments);

    this.dom.pageSelect.innerHTML = renderPageOptions(
      this.pages.map((page) => ({
        ...page,
        role: !this.cloudEnabled ? "owner" : page.ownerId === this.user?.id ? "owner" : "shared",
      })),
      this.currentPage?.id
    );

    this.dom.authPanel.hidden = false;
    this.dom.authTitle.textContent = this.user
      ? `Signed in as ${this.user.email}`
      : this.cloudEnabled
        ? "Sign in to collaborate"
        : "Local draft mode";
    this.dom.authCopy.textContent = this.user
      ? "Your pages sync through Supabase with role-based access, share links, and comment threads."
      : this.cloudEnabled
        ? "Use Supabase Auth to open your own pages, join shared pages, and sync comments."
        : "Configure Supabase in config.public.js to enable cloud pages, collaboration, comments, and realtime sync.";
    this.dom.signOutButton.hidden = !this.user;
    this.dom.authEmail.closest("label").hidden = Boolean(this.user);
    this.dom.authPassword.closest("label").hidden = Boolean(this.user);
    this.dom.authEmail.disabled = !this.cloudEnabled || Boolean(this.user);
    this.dom.authPassword.disabled = !this.cloudEnabled || Boolean(this.user);
    this.dom.authForm.querySelector('[type="submit"]').hidden = Boolean(this.user) || !this.cloudEnabled;
    this.dom.signUpButton.hidden = Boolean(this.user) || !this.cloudEnabled;

    this.dom.noticePanel.hidden = !this.notice;
    this.dom.noticeText.textContent = this.notice?.message || "";
    this.dom.noticeAcceptButton.hidden = !this.notice?.cta;
    this.dom.noticeAcceptButton.textContent = this.notice?.cta?.label || "Continue";

    if (!this.currentPage) {
      this.dom.saveStatus.textContent = this.cloudEnabled
        ? "Sign in to load pages"
        : "Local draft only";
      return;
    }

    const dashboard = computeDashboardStats(this.draft.core, this.draft.entries, this.selectedDate);
    const canUserEdit = canEdit(this.currentRole);
    const canUserManage = this.cloudEnabled && Boolean(this.user) && canManage(this.currentRole);
    const canUserComment = this.cloudEnabled && Boolean(this.user) && canComment(this.currentRole);

    this.dom.datePicker.value = this.selectedDate;
    this.dom.pageTitleInput.value = this.draft.title || "";
    this.dom.pageVisibilitySelect.value = this.draft.visibility || "private";
    this.dom.pageSlugValue.textContent = `/p/${this.currentPage.slug}`;
    this.dom.pageRoleBadge.textContent = this.currentRole;
    this.dom.pageRoleBadge.className = `role-badge ${this.currentRole}`;
    this.dom.pageMetaCopy.textContent = !this.cloudEnabled
      ? "Local draft mode only. Configure Supabase to enable shared pages, invites, and synced comments."
      : canUserEdit
        ? "Editors can change tracker content. Commenters can discuss but not edit values."
        : "You can view and comment based on your role.";

    this.dom.missionInput.value = this.draft.core.mission || "";
    ensureEntry(this.draft.entries, this.selectedDate);
    const currentEntry = this.draft.entries[this.selectedDate] || createEmptyEntry();
    this.dom.selectedDateLabel.textContent = this.selectedDate;
    this.dom.identityGrid.innerHTML = renderIdentities(this.draft.core, this.draft.entries, this.selectedDate);
    this.dom.todayScore.textContent = toPercent(dashboard.today);
    this.dom.todayRing.style.setProperty("--score", `${Math.round(dashboard.today * 360)}deg`);
    this.dom.weekScore.textContent = toPercent(dashboard.week);
    this.dom.streakCount.textContent = String(dashboard.streak);
    this.dom.balanceBars.innerHTML = renderBalanceBars(this.draft.core, this.draft.entries, this.selectedDate);
    this.dom.actionBoard.innerHTML = renderActionBoard({
      core: this.draft.core,
      entries: this.draft.entries,
      selectedDate: this.selectedDate,
      commentStats,
      selectedAnchor: this.selectedAnchor,
    });

    this.dom.oneThingInput.value = currentEntry.reflection.oneThing || "";
    this.dom.avoidInput.value = currentEntry.reflection.avoid || "";
    this.dom.winInput.value = currentEntry.reflection.win || "";
    this.dom.lessonInput.value = currentEntry.reflection.lesson || "";
    this.dom.patternInput.value = currentEntry.principle.pattern || "";
    this.dom.principleInput.value = currentEntry.principle.principle || "";
    this.dom.mechanismInput.value = currentEntry.principle.mechanism || "";
    this.dom.principleList.innerHTML = renderPrincipleCards(this.draft.entries);
    this.dom.heatmap.innerHTML = renderHeatmap(this.draft.core, this.draft.entries, this.selectedDate);

    this.dom.memberList.innerHTML = renderMemberList(this.members, this.user?.id, this.currentRole);
    this.dom.inviteList.innerHTML = renderInviteList(this.invites);
    this.dom.pendingInviteList.innerHTML = renderPendingInvites(this.pendingInvites);
    this.dom.shareLinkList.innerHTML = renderShareLinks(this.shareLinks);
    const showRecentShareLink =
      this.recentShareLink?.rawUrl && this.recentShareLink?.pageId === this.currentPage.id;
    this.dom.recentShareLinkBox.hidden = !showRecentShareLink;
    this.dom.recentShareLinkValue.textContent = showRecentShareLink ? this.recentShareLink.rawUrl : "";

    this.dom.selectedAnchorLabel.textContent = describeAnchor(this.selectedAnchor, {
      core: this.draft.core,
    });
    this.dom.commentThreadList.innerHTML = renderCommentThreads({
      threads: this.threads,
      commentsByThreadId: threadComments,
      selectedAnchor: this.selectedAnchor,
      commentStats,
      currentRole: this.currentRole,
    });
    this.dom.newCommentBody.disabled = !canUserComment;
    this.dom.createThreadButton.disabled = !canUserComment;

    this.dom.sidebarTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.sidebarTab === this.currentTab);
    });
    this.dom.sidebarSections.forEach((section) => {
      section.hidden = section.dataset.sidebarSection !== this.currentTab;
    });

    this.dom.inviteEmailInput.disabled = !canUserManage;
    this.dom.inviteRoleSelect.disabled = !canUserManage;
    this.dom.inviteButton.disabled = !canUserManage;
    this.dom.shareRoleSelect.disabled = !canUserManage;
    this.dom.createShareLinkButton.disabled = !canUserManage;
    this.dom.newPageButton.disabled = !this.cloudEnabled || !this.user;
    this.dom.copyPageUrlButton.disabled = !this.cloudEnabled || !this.currentPage;

    this.dom.conflictBox.hidden = !this.conflicts.length;
    this.dom.conflictSummary.innerHTML = renderConflictSummary(this.conflicts);

    this.setEditability(canUserEdit);
    this.refreshStaticCommentButtons(commentStats);

    this.dom.saveStatus.textContent = this.isSaving
      ? "Saving..."
      : this.isDirty
        ? "Unsaved changes"
        : this.cloudEnabled
          ? "Synced"
          : "Local draft";
    this.dom.saveStatus.className = `save-status ${this.isDirty ? "warning" : this.isSaving ? "manual" : ""}`;
  }
}
