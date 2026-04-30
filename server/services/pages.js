const fs = require("fs");
const path = require("path");
const { openDatabase, transaction } = require("../db");
const { getPageRole, requirePageRole } = require("../permissions");
const commentsService = require("./comments");
const {
  contentHash,
  displayNameFromEmail,
  normalizeEmail,
  nowIso,
  randomId,
  randomToken,
  safeJsonParse,
  sha256,
  slugify,
} = require("../utils");

const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const LEGACY_CORE_FILE = path.join(DATA_DIR, "core.json");
const LEGACY_WEEKS_DIR = path.join(DATA_DIR, "weeks");

function parseJsonColumn(raw, fallback) {
  return safeJsonParse(raw, fallback);
}

function serializeJsonColumn(value) {
  return JSON.stringify(value || {});
}

function normalizePage(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    slug: row.slug,
    visibility: row.visibility,
    core: parseJsonColumn(row.core_json, {}),
    revision: Number(row.revision || 1),
    contentHash: row.content_hash || "",
    lastWriterId: row.last_writer_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeWeek(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    weekKey: row.week_key,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    entries: parseJsonColumn(row.entries_json, {}),
    revision: Number(row.revision || 1),
    contentHash: row.content_hash || "",
    lastWriterId: row.last_writer_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMember(row) {
  return {
    pageId: row.page_id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    avatarSeed: row.avatar_seed,
    joinedVia: row.joined_via,
    createdAt: row.created_at,
  };
}

function normalizeInvite(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    inviteEmail: row.invite_email,
    role: row.role,
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function normalizeShareLink(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    role: row.role,
    tokenHint: row.token_hint,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdByName: row.created_by_name,
  };
}

function uniqueSlug(db, title) {
  const base = slugify(title || "mission-page", "mission-page");
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? randomId().slice(0, 8) : `${randomId().slice(0, 6)}-${index}`;
    const slug = `${base}-${suffix}`;
    const existing = db.prepare("select id from pages where slug = ?").get(slug);
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

function userProfile(user) {
  return {
    userId: user.id || user.userId,
    email: user.email,
    displayName: user.displayName || displayNameFromEmail(user.email),
    avatarSeed: user.avatarSeed || user.email,
  };
}

function listPages(user) {
  const db = openDatabase();
  const rows = db
    .prepare(`
      select distinct pages.*
      from pages
      left join page_members on page_members.page_id = pages.id
      where pages.owner_id = ?
         or page_members.user_id = ?
      order by pages.updated_at desc
    `)
    .all(user.id, user.id);
  return rows.map(normalizePage);
}

function createPage({ title, core = {}, visibility = "private", owner }) {
  const profile = userProfile(owner);
  return transaction((db) => {
    const now = nowIso();
    const page = {
      id: randomId(),
      owner_id: profile.userId,
      title: title || "Untitled Page",
      slug: uniqueSlug(db, title || "mission-page"),
      visibility,
      core_json: serializeJsonColumn(core),
      revision: 1,
      content_hash: contentHash(core),
      last_writer_id: profile.userId,
      created_at: now,
      updated_at: now,
    };
    db.prepare(`
      insert into pages (
        id, owner_id, title, slug, visibility, core_json, revision, content_hash,
        last_writer_id, created_at, updated_at
      )
      values (
        :id, :owner_id, :title, :slug, :visibility, :core_json, :revision,
        :content_hash, :last_writer_id, :created_at, :updated_at
      )
    `).run(page);
    db.prepare(`
      insert into page_members (
        page_id, user_id, role, display_name, email, avatar_seed, joined_via, created_at
      )
      values (?, ?, 'owner', ?, ?, ?, 'created', ?)
    `).run(page.id, profile.userId, profile.displayName, profile.email, profile.avatarSeed, now);
    db.prepare("update users set default_page_id = ?, updated_at = ? where id = ?").run(
      page.id,
      now,
      profile.userId
    );
    return normalizePage(page);
  });
}

function getPageById(pageId, user) {
  requirePageRole(pageId, user, "viewer");
  const row = openDatabase().prepare("select * from pages where id = ?").get(pageId);
  return normalizePage(row);
}

function getPageBySlug(slug, user) {
  const row = openDatabase().prepare("select * from pages where slug = ?").get(slug);
  if (!row) return null;
  requirePageRole(row.id, user, "viewer");
  return normalizePage(row);
}

function listWeeks(pageId, user) {
  requirePageRole(pageId, user, "viewer");
  return openDatabase()
    .prepare("select * from page_weeks where page_id = ? order by week_key asc")
    .all(pageId)
    .map(normalizeWeek);
}

function listMembers(pageId, user) {
  requirePageRole(pageId, user, "viewer");
  return openDatabase()
    .prepare("select * from page_members where page_id = ? order by created_at asc")
    .all(pageId)
    .map(normalizeMember);
}

function listInvites(pageId, user) {
  requirePageRole(pageId, user, "owner");
  return openDatabase()
    .prepare(`
      select * from page_invites
      where page_id = ? and revoked_at is null and accepted_at is null
      order by created_at desc
    `)
    .all(pageId)
    .map(normalizeInvite);
}

function listPendingInvites(user) {
  return openDatabase()
    .prepare(`
      select * from page_invites
      where lower(invite_email) = lower(?)
        and accepted_at is null
        and revoked_at is null
        and (expires_at is null or expires_at > ?)
      order by created_at desc
    `)
    .all(user.email, nowIso())
    .map(normalizeInvite);
}

function listShareLinks(pageId, user) {
  requirePageRole(pageId, user, "owner");
  return openDatabase()
    .prepare(`
      select * from share_links
      where page_id = ? and revoked_at is null
      order by created_at desc
    `)
    .all(pageId)
    .map(normalizeShareLink);
}

function updatePageCore({ pageId, title, visibility, core, expectedRevision, user }) {
  requirePageRole(pageId, user, "editor");
  const db = openDatabase();
  const now = nowIso();
  const result = db
    .prepare(`
      update pages
      set title = ?,
          visibility = ?,
          core_json = ?,
          revision = revision + 1,
          content_hash = ?,
          last_writer_id = ?,
          updated_at = ?
      where id = ? and revision = ?
    `)
    .run(
      title || "Untitled Page",
      visibility || "private",
      serializeJsonColumn(core),
      contentHash(core),
      user.id,
      now,
      pageId,
      Number(expectedRevision || 0)
    );
  if (!result.changes) return { conflict: true };
  return {
    conflict: false,
    page: normalizePage(db.prepare("select * from pages where id = ?").get(pageId)),
  };
}

function saveWeek({ pageId, weekKey, weekStart, weekEnd, entries, expectedRevision, user }) {
  requirePageRole(pageId, user, "editor");
  return transaction((db) => {
    const now = nowIso();
    const existing = db
      .prepare("select * from page_weeks where page_id = ? and week_key = ?")
      .get(pageId, weekKey);
    if (existing) {
      const result = db
        .prepare(`
          update page_weeks
          set week_start = ?,
              week_end = ?,
              entries_json = ?,
              revision = revision + 1,
              content_hash = ?,
              last_writer_id = ?,
              updated_at = ?
          where id = ? and revision = ?
        `)
        .run(
          weekStart,
          weekEnd,
          serializeJsonColumn(entries),
          contentHash(entries),
          user.id,
          now,
          existing.id,
          Number(expectedRevision || 0)
        );
      if (!result.changes) return { conflict: true };
    } else {
      if (Number(expectedRevision || 0) !== 0) return { conflict: true };
      db.prepare(`
        insert into page_weeks (
          id, page_id, week_key, week_start, week_end, entries_json, revision,
          content_hash, last_writer_id, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        randomId(),
        pageId,
        weekKey,
        weekStart,
        weekEnd,
        serializeJsonColumn(entries),
        contentHash(entries),
        user.id,
        now,
        now
      );
    }
    db.prepare("update pages set updated_at = ?, last_writer_id = ? where id = ?").run(now, user.id, pageId);
    return {
      conflict: false,
      row: normalizeWeek(
        db.prepare("select * from page_weeks where page_id = ? and week_key = ?").get(pageId, weekKey)
      ),
    };
  });
}

function deleteWeek(pageId, weekKey, user) {
  requirePageRole(pageId, user, "editor");
  const db = openDatabase();
  db.prepare("delete from page_weeks where page_id = ? and week_key = ?").run(pageId, weekKey);
  db.prepare("update pages set updated_at = ?, last_writer_id = ? where id = ?").run(
    nowIso(),
    user.id,
    pageId
  );
}

function createInvite({ pageId, pageTitle, inviteEmail, role, inviter }) {
  requirePageRole(pageId, inviter, "owner");
  const db = openDatabase();
  const now = nowIso();
  const row = {
    id: randomId(),
    page_id: pageId,
    page_title: pageTitle,
    invite_email: normalizeEmail(inviteEmail),
    role,
    invited_by: inviter.id,
    invited_by_name: inviter.displayName,
    created_at: now,
  };
  db.prepare(`
    insert into page_invites (
      id, page_id, page_title, invite_email, role, invited_by, invited_by_name, created_at
    )
    values (:id, :page_id, :page_title, :invite_email, :role, :invited_by, :invited_by_name, :created_at)
  `).run(row);
  return normalizeInvite(db.prepare("select * from page_invites where id = ?").get(row.id));
}

function revokeInvite(inviteId, user) {
  const db = openDatabase();
  const invite = db.prepare("select * from page_invites where id = ?").get(inviteId);
  if (!invite) return;
  requirePageRole(invite.page_id, user, "owner");
  db.prepare("update page_invites set revoked_at = ? where id = ?").run(nowIso(), inviteId);
}

function acceptInvite(inviteId, user) {
  return transaction((db) => {
    const invite = db.prepare("select * from page_invites where id = ?").get(inviteId);
    if (
      !invite ||
      invite.revoked_at ||
      invite.accepted_at ||
      normalizeEmail(invite.invite_email) !== normalizeEmail(user.email) ||
      (invite.expires_at && invite.expires_at <= nowIso())
    ) {
      const error = new Error("Invite is invalid or expired");
      error.status = 400;
      throw error;
    }
    const now = nowIso();
    db.prepare(`
      insert into page_members (
        page_id, user_id, role, display_name, email, avatar_seed, joined_via, created_at
      )
      values (?, ?, ?, ?, ?, ?, 'invite', ?)
      on conflict(page_id, user_id) do update set
        role = excluded.role,
        display_name = excluded.display_name,
        email = excluded.email,
        avatar_seed = excluded.avatar_seed,
        joined_via = excluded.joined_via
    `).run(invite.page_id, user.id, invite.role, user.displayName, user.email, user.avatarSeed, now);
    db.prepare("update page_invites set accepted_at = ? where id = ?").run(now, inviteId);
    return invite.page_id;
  });
}

function createShareLink({ pageId, pageTitle, role, creator }) {
  requirePageRole(pageId, creator, "owner");
  const db = openDatabase();
  const rawToken = randomToken(28);
  const row = {
    id: randomId(),
    page_id: pageId,
    page_title: pageTitle,
    token_hash: sha256(rawToken),
    token_hint: rawToken.slice(-6),
    role,
    created_by: creator.id,
    created_by_name: creator.displayName,
    created_at: nowIso(),
  };
  db.prepare(`
    insert into share_links (
      id, page_id, page_title, token_hash, token_hint, role, created_by, created_by_name, created_at
    )
    values (
      :id, :page_id, :page_title, :token_hash, :token_hint, :role, :created_by, :created_by_name, :created_at
    )
  `).run(row);
  return {
    rawToken,
    link: normalizeShareLink(db.prepare("select * from share_links where id = ?").get(row.id)),
  };
}

function revokeShareLink(linkId, user) {
  const db = openDatabase();
  const link = db.prepare("select * from share_links where id = ?").get(linkId);
  if (!link) return;
  requirePageRole(link.page_id, user, "owner");
  db.prepare("update share_links set revoked_at = ? where id = ?").run(nowIso(), linkId);
}

function joinShareLink(rawToken, user) {
  return transaction((db) => {
    const tokenHash = sha256(rawToken);
    const link = db.prepare("select * from share_links where token_hash = ?").get(tokenHash);
    if (!link || link.revoked_at || (link.expires_at && link.expires_at <= nowIso())) {
      const error = new Error("Share link is invalid or expired");
      error.status = 400;
      throw error;
    }
    db.prepare(`
      insert into page_members (
        page_id, user_id, role, display_name, email, avatar_seed, joined_via, created_at
      )
      values (?, ?, ?, ?, ?, ?, 'share_link', ?)
      on conflict(page_id, user_id) do update set
        role = excluded.role,
        display_name = excluded.display_name,
        email = excluded.email,
        avatar_seed = excluded.avatar_seed,
        joined_via = excluded.joined_via
    `).run(link.page_id, user.id, link.role, user.displayName, user.email, user.avatarSeed, nowIso());
    return link.page_id;
  });
}

function updateMemberRole(pageId, memberUserId, role, user) {
  requirePageRole(pageId, user, "owner");
  if (role === "owner") {
    const error = new Error("Owner role cannot be assigned here");
    error.status = 400;
    throw error;
  }
  openDatabase()
    .prepare("update page_members set role = ? where page_id = ? and user_id = ? and role != 'owner'")
    .run(role, pageId, memberUserId);
}

function removeMember(pageId, memberUserId, user) {
  requirePageRole(pageId, user, "owner");
  openDatabase()
    .prepare("delete from page_members where page_id = ? and user_id = ? and role != 'owner'")
    .run(pageId, memberUserId);
}

function loadLegacyPersonalTracker() {
  if (!fs.existsSync(LEGACY_CORE_FILE)) return null;
  const corePayload = safeJsonParse(fs.readFileSync(LEGACY_CORE_FILE, "utf8"), null);
  const entries = {};
  if (fs.existsSync(LEGACY_WEEKS_DIR)) {
    for (const fileName of fs.readdirSync(LEGACY_WEEKS_DIR).sort()) {
      if (!fileName.endsWith(".json")) continue;
      const week = safeJsonParse(fs.readFileSync(path.join(LEGACY_WEEKS_DIR, fileName), "utf8"), null);
      Object.assign(entries, week?.entries || {});
    }
  }
  if (!corePayload?.core && !Object.keys(entries).length) return null;
  return {
    core: corePayload?.core || {},
    entries,
    systemLog: Array.isArray(corePayload?.systemLog) ? corePayload.systemLog : [],
  };
}

function loadPageBundle(pageId, user, { includeManaged = true } = {}) {
  const page = getPageById(pageId, user);
  const role = getPageRole(pageId, user.id);
  const bundle = {
    page,
    role,
    members: listMembers(pageId, user),
    invites: [],
    shareLinks: [],
    weeks: listWeeks(pageId, user),
    threads: commentsService.listThreads(pageId, user),
    comments: commentsService.listComments(pageId, user),
  };
  if (includeManaged && role === "owner") {
    bundle.invites = listInvites(pageId, user);
    bundle.shareLinks = listShareLinks(pageId, user);
  }
  return bundle;
}

module.exports = {
  acceptInvite,
  createInvite,
  createPage,
  createShareLink,
  deleteWeek,
  getPageById,
  getPageBySlug,
  listInvites,
  listMembers,
  listPages,
  listPendingInvites,
  listShareLinks,
  listWeeks,
  loadLegacyPersonalTracker,
  loadPageBundle,
  normalizePage,
  normalizeWeek,
  removeMember,
  revokeInvite,
  revokeShareLink,
  saveWeek,
  updateMemberRole,
  updatePageCore,
  joinShareLink,
};
