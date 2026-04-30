import { isoWeekInfo } from "../lib/date.js";
import {
  avatarSeedFromEmail,
  createSlugCandidate,
  displayNameFromEmail,
  hashContent,
  makeClientId,
  randomToken,
  sha256Hex,
} from "../lib/utils.js";
import { compactEntries, groupEntriesByISOWeek, mergeCore, normalizeEntries } from "../state/schema.js";

const PAGE_COLUMNS = [
  "id",
  "owner_id",
  "title",
  "slug",
  "visibility",
  "core",
  "revision",
  "content_hash",
  "last_writer_id",
  "created_at",
  "updated_at",
].join(",");

const PAGE_WEEK_COLUMNS = [
  "id",
  "page_id",
  "week_key",
  "week_start",
  "week_end",
  "entries",
  "revision",
  "content_hash",
  "last_writer_id",
  "created_at",
  "updated_at",
].join(",");

function createClient(publicConfig) {
  const hasConfig = Boolean(publicConfig?.supabaseUrl && publicConfig?.supabaseAnonKey);
  const hasSdk = Boolean(window.supabase && window.supabase.createClient);
  if (!hasConfig || !hasSdk) return null;
  return window.supabase.createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey);
}

function normalizeProfile(row, user) {
  return {
    userId: user?.id || row?.user_id || "",
    email: row?.email || user?.email || "",
    displayName: row?.display_name || displayNameFromEmail(user?.email),
    avatarSeed: row?.avatar_seed || avatarSeedFromEmail(user?.email),
    defaultPageId: row?.default_page_id || "",
  };
}

function normalizePage(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title || "Untitled Page",
    slug: row.slug,
    visibility: row.visibility || "private",
    core: mergeCore(row.core),
    revision: Number(row.revision || 1),
    contentHash: row.content_hash || hashContent(row.core || {}),
    lastWriterId: row.last_writer_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeWeekRow(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    weekKey: row.week_key,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    entries: normalizeEntries(row.entries),
    revision: Number(row.revision || 1),
    contentHash: row.content_hash || hashContent(row.entries || {}),
    lastWriterId: row.last_writer_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMemberRow(row) {
  return {
    pageId: row.page_id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name || "Anonymous",
    email: row.email || "",
    avatarSeed: row.avatar_seed || avatarSeedFromEmail(row.email),
    joinedVia: row.joined_via || "direct",
    createdAt: row.created_at,
  };
}

function normalizeInviteRow(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title || "Shared page",
    inviteEmail: row.invite_email,
    role: row.role,
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name || "Owner",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function normalizeShareLinkRow(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title || "Shared page",
    role: row.role,
    tokenHint: row.token_hint || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdByName: row.created_by_name || "Owner",
  };
}

function normalizeThreadRow(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    anchor: row.anchor,
    status: row.status || "open",
    authorId: row.author_id,
    authorName: row.author_name || "Anonymous",
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name || "",
    lastActivityAt: row.last_activity_at || row.created_at,
  };
}

function normalizeCommentRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    pageId: row.page_id,
    body: row.body || "",
    authorId: row.author_id,
    authorName: row.author_name || "Anonymous",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function ensureClient(client) {
  if (!client) {
    throw new Error("Supabase is not configured. Add config.public.js and sign in.");
  }
}

export function createRepository(publicConfig = {}) {
  const client = createClient(publicConfig);

  return {
    client,
    isCloudEnabled() {
      return Boolean(client);
    },
    async getSessionUser() {
      ensureClient(client);
      const {
        data: { session },
      } = await client.auth.getSession();
      return session?.user || null;
    },
    onAuthStateChange(handler) {
      if (!client) return () => {};
      const subscription = client.auth.onAuthStateChange((_event, session) => {
        handler(session?.user || null);
      });
      return () => {
        subscription?.data?.subscription?.unsubscribe?.();
      };
    },
    async signIn(email, password) {
      ensureClient(client);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      ensureClient(client);
      const { error } = await client.auth.signUp({ email, password });
      if (error) throw error;
    },
    async signOut() {
      ensureClient(client);
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async ensureProfile(user, overrides = {}) {
      ensureClient(client);
      if (!user) return null;
      const { data: existing, error: existingError } = await client
        .from("mission_tracker_profiles")
        .select("user_id,email,display_name,avatar_seed,default_page_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingError) throw existingError;

      const payload = {
        user_id: user.id,
        email: user.email || existing?.email || "",
        display_name:
          overrides.displayName || existing?.display_name || displayNameFromEmail(user.email),
        avatar_seed: existing?.avatar_seed || avatarSeedFromEmail(user.email),
        default_page_id: overrides.defaultPageId || existing?.default_page_id || null,
      };

      const { error: upsertError } = await client
        .from("mission_tracker_profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (upsertError) throw upsertError;
      return normalizeProfile(payload, user);
    },
    async updateProfile(userId, payload) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_profiles")
        .update(payload)
        .eq("user_id", userId)
        .select("user_id,email,display_name,avatar_seed,default_page_id")
        .single();
      if (error) throw error;
      return data;
    },
    async listPages() {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_pages")
        .select(PAGE_COLUMNS)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizePage);
    },
    async createPage({ title, core, visibility = "private", owner }) {
      ensureClient(client);
      const shortId = makeClientId("page").slice(-6).toLowerCase();
      const pagePayload = {
        owner_id: owner.userId,
        title: title || "Untitled Page",
        slug: createSlugCandidate(title || "mission-page", shortId),
        visibility,
        core: mergeCore(core),
        revision: 1,
        content_hash: hashContent(core),
        last_writer_id: owner.userId,
      };

      const { data: pageRow, error: pageError } = await client
        .from("mission_tracker_pages")
        .insert(pagePayload)
        .select(PAGE_COLUMNS)
        .single();
      if (pageError) throw pageError;

      const memberPayload = {
        page_id: pageRow.id,
        user_id: owner.userId,
        role: "owner",
        display_name: owner.displayName,
        email: owner.email,
        avatar_seed: owner.avatarSeed,
        joined_via: "created",
      };
      const { error: memberError } = await client.from("mission_tracker_page_members").upsert(memberPayload);
      if (memberError) throw memberError;

      await this.updateProfile(owner.userId, { default_page_id: pageRow.id });
      return normalizePage(pageRow);
    },
    async getPageBySlug(slug) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_pages")
        .select(PAGE_COLUMNS)
        .eq("slug", slug)
        .single();
      if (error) throw error;
      return normalizePage(data);
    },
    async getPageById(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_pages")
        .select(PAGE_COLUMNS)
        .eq("id", pageId)
        .single();
      if (error) throw error;
      return normalizePage(data);
    },
    async loadLegacyPersonalTracker(userId) {
      ensureClient(client);
      const { data: profileRow } = await client
        .from("mission_tracker_profiles")
        .select("core,system_log")
        .eq("user_id", userId)
        .maybeSingle();
      const { data: legacyWeeks } = await client
        .from("mission_tracker_weeks")
        .select("entries")
        .eq("user_id", userId)
        .order("week_key", { ascending: true });

      const entries = {};
      for (const row of legacyWeeks || []) {
        Object.assign(entries, normalizeEntries(row.entries));
      }

      if (!profileRow?.core && !Object.keys(entries).length) {
        return null;
      }

      return {
        core: mergeCore(profileRow?.core),
        entries,
        systemLog: Array.isArray(profileRow?.system_log) ? profileRow.system_log : [],
      };
    },
    async listPageMembers(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_page_members")
        .select("page_id,user_id,role,display_name,email,avatar_seed,joined_via,created_at")
        .eq("page_id", pageId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(normalizeMemberRow);
    },
    async listPageInvites(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_page_invites")
        .select(
          "id,page_id,page_title,invite_email,role,invited_by,invited_by_name,created_at,expires_at,accepted_at,revoked_at"
        )
        .eq("page_id", pageId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeInviteRow);
    },
    async listPendingInvitesForUser(user) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_page_invites")
        .select(
          "id,page_id,page_title,invite_email,role,invited_by,invited_by_name,created_at,expires_at,accepted_at,revoked_at"
        )
        .ilike("invite_email", user.email || "")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeInviteRow);
    },
    async createInvite({ pageId, pageTitle, inviteEmail, role, inviter }) {
      ensureClient(client);
      const payload = {
        page_id: pageId,
        page_title: pageTitle,
        invite_email: String(inviteEmail || "").trim().toLowerCase(),
        role,
        invited_by: inviter.userId,
        invited_by_name: inviter.displayName,
      };
      const { data, error } = await client
        .from("mission_tracker_page_invites")
        .insert(payload)
        .select(
          "id,page_id,page_title,invite_email,role,invited_by,invited_by_name,created_at,expires_at,accepted_at,revoked_at"
        )
        .single();
      if (error) throw error;
      return normalizeInviteRow(data);
    },
    async revokeInvite(inviteId) {
      ensureClient(client);
      const { error } = await client
        .from("mission_tracker_page_invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inviteId);
      if (error) throw error;
    },
    async acceptInvite(inviteId) {
      ensureClient(client);
      const { data, error } = await client.rpc("mission_tracker_accept_invite", {
        invite_id: inviteId,
      });
      if (error) throw error;
      return data;
    },
    async listShareLinks(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_share_links")
        .select(
          "id,page_id,page_title,role,token_hint,created_at,expires_at,revoked_at,created_by_name"
        )
        .eq("page_id", pageId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeShareLinkRow);
    },
    async createShareLink({ pageId, pageTitle, role, creator }) {
      ensureClient(client);
      const rawToken = randomToken(28);
      const tokenHash = await sha256Hex(rawToken);
      const tokenHint = rawToken.slice(-6);
      const payload = {
        page_id: pageId,
        page_title: pageTitle,
        token_hash: tokenHash,
        token_hint: tokenHint,
        role,
        created_by: creator.userId,
        created_by_name: creator.displayName,
      };
      const { data, error } = await client
        .from("mission_tracker_share_links")
        .insert(payload)
        .select(
          "id,page_id,page_title,role,token_hint,created_at,expires_at,revoked_at,created_by_name"
        )
        .single();
      if (error) throw error;
      return {
        link: normalizeShareLinkRow(data),
        rawToken,
      };
    },
    async revokeShareLink(linkId) {
      ensureClient(client);
      const { error } = await client
        .from("mission_tracker_share_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", linkId);
      if (error) throw error;
    },
    async joinShareLink(token) {
      ensureClient(client);
      const { data, error } = await client.rpc("mission_tracker_join_share_link", {
        raw_token: token,
      });
      if (error) throw error;
      return data;
    },
    async updateMemberRole(pageId, userId, role) {
      ensureClient(client);
      const { error } = await client
        .from("mission_tracker_page_members")
        .update({ role })
        .eq("page_id", pageId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    async removeMember(pageId, userId) {
      ensureClient(client);
      const { error } = await client
        .from("mission_tracker_page_members")
        .delete()
        .eq("page_id", pageId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    async listWeeks(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_page_weeks")
        .select(PAGE_WEEK_COLUMNS)
        .eq("page_id", pageId)
        .order("week_key", { ascending: true });
      if (error) throw error;
      return (data || []).map(normalizeWeekRow);
    },
    async listCommentThreads(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_comment_threads")
        .select(
          "id,page_id,anchor,status,author_id,author_name,created_at,resolved_at,resolved_by_name,last_activity_at"
        )
        .eq("page_id", pageId)
        .order("last_activity_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeThreadRow);
    },
    async listComments(pageId) {
      ensureClient(client);
      const { data, error } = await client
        .from("mission_tracker_comments")
        .select("id,thread_id,page_id,body,author_id,author_name,created_at,updated_at,deleted_at")
        .eq("page_id", pageId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(normalizeCommentRow);
    },
    async loadPageBundle(pageId) {
      const [pageResult, membersResult, invitesResult, shareLinksResult, weeksResult, threadsResult, commentsResult] =
        await Promise.allSettled([
          this.getPageById(pageId),
          this.listPageMembers(pageId),
          this.listPageInvites(pageId),
          this.listShareLinks(pageId),
          this.listWeeks(pageId),
          this.listCommentThreads(pageId),
          this.listComments(pageId),
        ]);

      if (pageResult.status !== "fulfilled") throw pageResult.reason;
      if (membersResult.status !== "fulfilled") throw membersResult.reason;
      if (weeksResult.status !== "fulfilled") throw weeksResult.reason;
      if (threadsResult.status !== "fulfilled") throw threadsResult.reason;
      if (commentsResult.status !== "fulfilled") throw commentsResult.reason;

      return {
        page: pageResult.value,
        members: membersResult.value,
        invites: invitesResult.status === "fulfilled" ? invitesResult.value : [],
        shareLinks: shareLinksResult.status === "fulfilled" ? shareLinksResult.value : [],
        weeks: weeksResult.value,
        threads: threadsResult.value,
        comments: commentsResult.value,
      };
    },
    async savePageCore({ pageId, title, core, visibility, expectedRevision, userId }) {
      ensureClient(client);
      const payload = {
        title,
        core: mergeCore(core),
        visibility,
        revision: expectedRevision + 1,
        content_hash: hashContent(core),
        last_writer_id: userId,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client
        .from("mission_tracker_pages")
        .update(payload)
        .eq("id", pageId)
        .eq("revision", expectedRevision)
        .select(PAGE_COLUMNS);
      if (error) throw error;
      if (!data || !data.length) {
        return { conflict: true };
      }
      return { conflict: false, page: normalizePage(data[0]) };
    },
    async saveWeek({ pageId, weekKey, entries, expectedRevision, existingId, userId }) {
      ensureClient(client);
      const info = isoWeekInfo(Object.keys(entries)[0] || new Date().toISOString().slice(0, 10));
      const payload = {
        page_id: pageId,
        week_key: weekKey,
        week_start: info.start,
        week_end: info.end,
        entries: normalizeEntries(entries),
        revision: (expectedRevision || 0) + 1,
        content_hash: hashContent(entries),
        last_writer_id: userId,
        updated_at: new Date().toISOString(),
      };

      if (existingId) {
        const { data, error } = await client
          .from("mission_tracker_page_weeks")
          .update(payload)
          .eq("id", existingId)
          .eq("revision", expectedRevision)
          .select(PAGE_WEEK_COLUMNS);
        if (error) throw error;
        if (!data || !data.length) {
          return { conflict: true };
        }
        return { conflict: false, row: normalizeWeekRow(data[0]) };
      }

      const { data, error } = await client
        .from("mission_tracker_page_weeks")
        .insert(payload)
        .select(PAGE_WEEK_COLUMNS)
        .single();
      if (error) {
        if (error.code === "23505") {
          return { conflict: true };
        }
        throw error;
      }
      return { conflict: false, row: normalizeWeekRow(data) };
    },
    async deleteWeek(existingId) {
      ensureClient(client);
      const { error } = await client.from("mission_tracker_page_weeks").delete().eq("id", existingId);
      if (error) throw error;
    },
    async createThread({ pageId, anchor, body, author }) {
      ensureClient(client);
      const threadPayload = {
        page_id: pageId,
        anchor,
        status: "open",
        author_id: author.userId,
        author_name: author.displayName,
      };
      const { data: threadRow, error: threadError } = await client
        .from("mission_tracker_comment_threads")
        .insert(threadPayload)
        .select(
          "id,page_id,anchor,status,author_id,author_name,created_at,resolved_at,resolved_by_name,last_activity_at"
        )
        .single();
      if (threadError) throw threadError;

      const commentPayload = {
        thread_id: threadRow.id,
        page_id: pageId,
        body,
        author_id: author.userId,
        author_name: author.displayName,
      };
      const { data: commentRow, error: commentError } = await client
        .from("mission_tracker_comments")
        .insert(commentPayload)
        .select("id,thread_id,page_id,body,author_id,author_name,created_at,updated_at,deleted_at")
        .single();
      if (commentError) throw commentError;

      return {
        thread: normalizeThreadRow(threadRow),
        comment: normalizeCommentRow(commentRow),
      };
    },
    async createComment({ threadId, pageId, body, author }) {
      ensureClient(client);
      const commentPayload = {
        thread_id: threadId,
        page_id: pageId,
        body,
        author_id: author.userId,
        author_name: author.displayName,
      };
      const { data: commentRow, error: commentError } = await client
        .from("mission_tracker_comments")
        .insert(commentPayload)
        .select("id,thread_id,page_id,body,author_id,author_name,created_at,updated_at,deleted_at")
        .single();
      if (commentError) throw commentError;

      const { error: touchError } = await client
        .from("mission_tracker_comment_threads")
        .update({
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", threadId);
      if (touchError) throw touchError;

      return normalizeCommentRow(commentRow);
    },
    async setThreadStatus({ threadId, status, actor }) {
      ensureClient(client);
      const payload =
        status === "resolved"
          ? {
              status,
              resolved_at: new Date().toISOString(),
              resolved_by: actor.userId,
              resolved_by_name: actor.displayName,
              last_activity_at: new Date().toISOString(),
            }
          : {
              status,
              resolved_at: null,
              resolved_by: null,
              resolved_by_name: null,
              last_activity_at: new Date().toISOString(),
            };

      const { data, error } = await client
        .from("mission_tracker_comment_threads")
        .update(payload)
        .eq("id", threadId)
        .select(
          "id,page_id,anchor,status,author_id,author_name,created_at,resolved_at,resolved_by_name,last_activity_at"
        )
        .single();
      if (error) throw error;
      return normalizeThreadRow(data);
    },
    async saveEntriesForPage({ pageId, entries, existingWeeksByKey, userId }) {
      const nextWeeks = groupEntriesByISOWeek(compactEntries(entries));
      const savedRows = [];
      const conflicts = [];

      for (const [weekKey, weekPayload] of nextWeeks) {
        const existing = existingWeeksByKey[weekKey];
        const result = await this.saveWeek({
          pageId,
          weekKey,
          entries: weekPayload.entries,
          expectedRevision: existing?.revision || 0,
          existingId: existing?.id,
          userId,
        });
        if (result.conflict) {
          conflicts.push(weekKey);
        } else {
          savedRows.push(result.row);
        }
      }

      const nextKeys = new Set(nextWeeks.keys());
      for (const [weekKey, existing] of Object.entries(existingWeeksByKey)) {
        if (!nextKeys.has(weekKey) && existing?.id) {
          await this.deleteWeek(existing.id);
        }
      }

      return {
        savedRows,
        conflicts,
      };
    },
    subscribeToPage(pageId, handlers = {}) {
      if (!client) return () => {};
      const channel = client
        .channel(`mission-tracker-page-${pageId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "mission_tracker_pages", filter: `id=eq.${pageId}` },
          (payload) => handlers.onPageChange?.(payload)
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_tracker_page_weeks",
            filter: `page_id=eq.${pageId}`,
          },
          (payload) => handlers.onWeeksChange?.(payload)
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_tracker_comment_threads",
            filter: `page_id=eq.${pageId}`,
          },
          (payload) => handlers.onThreadsChange?.(payload)
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_tracker_comments",
            filter: `page_id=eq.${pageId}`,
          },
          (payload) => handlers.onCommentsChange?.(payload)
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_tracker_page_members",
            filter: `page_id=eq.${pageId}`,
          },
          (payload) => handlers.onMembersChange?.(payload)
        )
        .subscribe();

      return () => {
        client.removeChannel(channel);
      };
    },
  };
}
