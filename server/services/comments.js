const { openDatabase } = require("../db");
const { requirePageRole } = require("../permissions");
const { nowIso, randomId } = require("../utils");

function normalizeThread(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    anchor: row.anchor,
    status: row.status,
    authorId: row.author_id || "",
    authorName: row.author_name,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name || "",
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

function normalizeComment(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    pageId: row.page_id,
    body: row.body,
    authorId: row.author_id || "",
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function listThreads(pageId, user) {
  requirePageRole(pageId, user, "viewer");
  return openDatabase()
    .prepare("select * from comment_threads where page_id = ? order by last_activity_at desc")
    .all(pageId)
    .map(normalizeThread);
}

function listComments(pageId, user) {
  requirePageRole(pageId, user, "viewer");
  return openDatabase()
    .prepare("select * from comments where page_id = ? and deleted_at is null order by created_at asc")
    .all(pageId)
    .map(normalizeComment);
}

function createThread({ pageId, anchor, body, author }) {
  requirePageRole(pageId, author, "commenter");
  const db = openDatabase();
  const now = nowIso();
  const thread = {
    id: randomId(),
    page_id: pageId,
    anchor,
    status: "open",
    author_id: author.id,
    author_name: author.displayName,
    created_at: now,
    last_activity_at: now,
  };
  const comment = {
    id: randomId(),
    thread_id: thread.id,
    page_id: pageId,
    body,
    author_id: author.id,
    author_name: author.displayName,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    insert into comment_threads (
      id, page_id, anchor, status, author_id, author_name, created_at, last_activity_at
    )
    values (:id, :page_id, :anchor, :status, :author_id, :author_name, :created_at, :last_activity_at)
  `).run(thread);
  db.prepare(`
    insert into comments (
      id, thread_id, page_id, body, author_id, author_name, created_at, updated_at
    )
    values (:id, :thread_id, :page_id, :body, :author_id, :author_name, :created_at, :updated_at)
  `).run(comment);
  touchPage(pageId, author.id);
  return {
    thread: normalizeThread(db.prepare("select * from comment_threads where id = ?").get(thread.id)),
    comment: normalizeComment(db.prepare("select * from comments where id = ?").get(comment.id)),
  };
}

function createComment({ threadId, pageId, body, author }) {
  requirePageRole(pageId, author, "commenter");
  const db = openDatabase();
  const thread = db.prepare("select * from comment_threads where id = ? and page_id = ?").get(threadId, pageId);
  if (!thread) {
    const error = new Error("Thread not found");
    error.status = 404;
    throw error;
  }
  const now = nowIso();
  const comment = {
    id: randomId(),
    thread_id: threadId,
    page_id: pageId,
    body,
    author_id: author.id,
    author_name: author.displayName,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    insert into comments (
      id, thread_id, page_id, body, author_id, author_name, created_at, updated_at
    )
    values (:id, :thread_id, :page_id, :body, :author_id, :author_name, :created_at, :updated_at)
  `).run(comment);
  db.prepare("update comment_threads set last_activity_at = ? where id = ?").run(now, threadId);
  touchPage(pageId, author.id);
  return normalizeComment(db.prepare("select * from comments where id = ?").get(comment.id));
}

function setThreadStatus({ threadId, status, actor }) {
  const db = openDatabase();
  const thread = db.prepare("select * from comment_threads where id = ?").get(threadId);
  if (!thread) {
    const error = new Error("Thread not found");
    error.status = 404;
    throw error;
  }
  requirePageRole(thread.page_id, actor, "commenter");
  const now = nowIso();
  if (status === "resolved") {
    db.prepare(`
      update comment_threads
      set status = 'resolved',
          resolved_at = ?,
          resolved_by = ?,
          resolved_by_name = ?,
          last_activity_at = ?
      where id = ?
    `).run(now, actor.id, actor.displayName, now, threadId);
  } else {
    db.prepare(`
      update comment_threads
      set status = 'open',
          resolved_at = null,
          resolved_by = null,
          resolved_by_name = null,
          last_activity_at = ?
      where id = ?
    `).run(now, threadId);
  }
  touchPage(thread.page_id, actor.id);
  return normalizeThread(db.prepare("select * from comment_threads where id = ?").get(threadId));
}

function touchPage(pageId, writerId) {
  openDatabase()
    .prepare("update pages set updated_at = ?, last_writer_id = ? where id = ?")
    .run(nowIso(), writerId, pageId);
}

module.exports = {
  createComment,
  createThread,
  listComments,
  listThreads,
  setThreadStatus,
};
