import { isoWeekInfo } from "../lib/date.js";
import { groupEntriesByISOWeek } from "../state/schema.js";

function createHttpError(response, payload) {
  const error = new Error(payload?.error || `Request failed with ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

export function createHttpRepository(publicConfig = {}) {
  const apiBaseUrl = (publicConfig.apiBaseUrl || "").replace(/\/$/, "");
  const listeners = new Set();

  async function request(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw createHttpError(response, payload);
    }
    return payload;
  }

  function emitAuth(user) {
    for (const listener of listeners) {
      listener(user || null);
    }
  }

  return {
    isCloudEnabled() {
      return true;
    },
    async getSessionUser() {
      const payload = await request("/api/auth/session");
      return payload.user || null;
    },
    onAuthStateChange(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async signIn(email, password) {
      const payload = await request("/api/auth/sign-in", {
        method: "POST",
        body: { email, password },
      });
      emitAuth(payload.user);
    },
    async signUp(email, password) {
      const payload = await request("/api/auth/sign-up", {
        method: "POST",
        body: { email, password },
      });
      emitAuth(payload.user);
    },
    async signOut() {
      await request("/api/auth/sign-out", { method: "POST" });
      emitAuth(null);
    },
    async ensureProfile(user) {
      return user;
    },
    async updateProfile(userId, payload) {
      return request("/api/profile", {
        method: "PATCH",
        body: payload,
      });
    },
    async listPages() {
      return request("/api/pages");
    },
    async createPage({ title, core, visibility = "private" }) {
      return request("/api/pages", {
        method: "POST",
        body: { title, core, visibility },
      });
    },
    async getPageBySlug(slug) {
      return request(`/api/pages/slug/${encodeURIComponent(slug)}`);
    },
    async getPageById(pageId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}`);
    },
    async loadLegacyPersonalTracker() {
      return request("/api/legacy-state");
    },
    async listPageMembers(pageId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/members`);
    },
    async listPageInvites(pageId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/invites`);
    },
    async listPendingInvitesForUser() {
      return request("/api/invites/pending");
    },
    async createInvite({ pageId, pageTitle, inviteEmail, role }) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/invites`, {
        method: "POST",
        body: { pageTitle, inviteEmail, role },
      });
    },
    async revokeInvite(inviteId) {
      return request(`/api/invites/${encodeURIComponent(inviteId)}/revoke`, {
        method: "POST",
      });
    },
    async acceptInvite(inviteId) {
      const payload = await request(`/api/invites/${encodeURIComponent(inviteId)}/accept`, {
        method: "POST",
      });
      return payload.pageId;
    },
    async listShareLinks(pageId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/share-links`);
    },
    async createShareLink({ pageId, pageTitle, role }) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/share-links`, {
        method: "POST",
        body: { pageTitle, role },
      });
    },
    async revokeShareLink(linkId) {
      return request(`/api/share-links/${encodeURIComponent(linkId)}/revoke`, {
        method: "POST",
      });
    },
    async joinShareLink(token) {
      const payload = await request("/api/share-links/join", {
        method: "POST",
        body: { rawToken: token },
      });
      return payload.pageId;
    },
    async updateMemberRole(pageId, userId, role) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { role },
      });
    },
    async removeMember(pageId, userId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
    },
    async listCommentThreads(pageId) {
      const bundle = await this.loadPageBundle(pageId);
      return bundle.threads || [];
    },
    async listComments(pageId) {
      const bundle = await this.loadPageBundle(pageId);
      return bundle.comments || [];
    },
    async loadPageBundle(pageId) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/bundle`);
    },
    async savePageCore({ pageId, title, core, visibility, expectedRevision }) {
      try {
        const page = await request(`/api/pages/${encodeURIComponent(pageId)}`, {
          method: "PATCH",
          body: { title, core, visibility, expectedRevision },
        });
        return { conflict: false, page };
      } catch (error) {
        if (error.status === 409) return { conflict: true, bundle: error.payload?.bundle };
        throw error;
      }
    },
    async saveWeek({ pageId, weekKey, entries, expectedRevision }) {
      const firstDate = Object.keys(entries || {})[0] || new Date().toISOString().slice(0, 10);
      const info = isoWeekInfo(firstDate);
      try {
        const row = await request(
          `/api/pages/${encodeURIComponent(pageId)}/weeks/${encodeURIComponent(weekKey)}`,
          {
            method: "PUT",
            body: {
              weekStart: info.start,
              weekEnd: info.end,
              entries,
              expectedRevision,
            },
          }
        );
        return { conflict: false, row };
      } catch (error) {
        if (error.status === 409) return { conflict: true, bundle: error.payload?.bundle };
        throw error;
      }
    },
    async deleteWeek(pageId, weekKey) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/weeks/${encodeURIComponent(weekKey)}`, {
        method: "DELETE",
      });
    },
    async saveEntriesForPage({ pageId, entries, existingWeeksByKey }) {
      const nextWeeks = groupEntriesByISOWeek(entries);
      const savedRows = [];
      const conflicts = [];

      for (const [weekKey, weekPayload] of nextWeeks) {
        const existing = existingWeeksByKey[weekKey];
        const result = await this.saveWeek({
          pageId,
          weekKey,
          entries: weekPayload.entries,
          expectedRevision: existing?.revision || 0,
        });
        if (result.conflict) {
          conflicts.push(weekKey);
        } else {
          savedRows.push(result.row);
        }
      }

      const nextKeys = new Set(nextWeeks.keys());
      for (const weekKey of Object.keys(existingWeeksByKey || {})) {
        if (!nextKeys.has(weekKey)) {
          await this.deleteWeek(pageId, weekKey);
        }
      }

      return { savedRows, conflicts };
    },
    async createThread({ pageId, anchor, body }) {
      return request(`/api/pages/${encodeURIComponent(pageId)}/comment-threads`, {
        method: "POST",
        body: { anchor, body },
      });
    },
    async createComment({ threadId, pageId, body }) {
      return request(`/api/comment-threads/${encodeURIComponent(threadId)}/comments`, {
        method: "POST",
        body: { pageId, body },
      });
    },
    async setThreadStatus({ threadId, status }) {
      return request(`/api/comment-threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        body: { status },
      });
    },
    subscribeToPage(pageId, handlers = {}) {
      const events = new EventSource(`${apiBaseUrl}/api/pages/${encodeURIComponent(pageId)}/events`);
      events.addEventListener("page-change", (event) => handlers.onPageChange?.(JSON.parse(event.data)));
      events.addEventListener("weeks-change", (event) => handlers.onWeeksChange?.(JSON.parse(event.data)));
      events.addEventListener("comments-change", (event) => {
        const payload = JSON.parse(event.data);
        handlers.onThreadsChange?.(payload);
        handlers.onCommentsChange?.(payload);
      });
      events.addEventListener("members-change", (event) => handlers.onMembersChange?.(JSON.parse(event.data)));
      events.onerror = () => {
        events.close();
      };
      return () => events.close();
    },
  };
}
