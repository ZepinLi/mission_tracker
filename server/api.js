const auth = require("./auth");
const { requirePageRole } = require("./permissions");
const { addClient, broadcastPage } = require("./realtime");
const comments = require("./services/comments");
const pages = require("./services/pages");
const { badRequest, notFound, readJson, routeParts, sendJson } = require("./utils");

async function handleApi(req, res, url) {
  try {
    const parts = routeParts(url.pathname);
    if (parts[0] !== "api") return false;

    if (parts[1] === "auth") {
      await handleAuth(req, res, parts);
      return true;
    }

    if (parts[1] === "profile") {
      const user = auth.requireUser(req);
      if (req.method === "PATCH") {
        const payload = await readJson(req);
        sendJson(res, 200, auth.updateProfile(user.id, payload));
        return true;
      }
    }

    if (parts[1] === "legacy-state" && req.method === "GET") {
      auth.requireUser(req);
      sendJson(res, 200, pages.loadLegacyPersonalTracker() || null);
      return true;
    }

    if (parts[1] === "pages") {
      await handlePages(req, res, parts);
      return true;
    }

    if (parts[1] === "invites") {
      await handleInvites(req, res, parts);
      return true;
    }

    if (parts[1] === "share-links") {
      await handleShareLinks(req, res, parts);
      return true;
    }

    if (parts[1] === "comment-threads") {
      await handleCommentThreads(req, res, parts);
      return true;
    }

    notFound(res);
    return true;
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
    return true;
  }
}

async function handleAuth(req, res, parts) {
  if (req.method === "GET" && parts[2] === "session") {
    sendJson(res, 200, { user: auth.currentUserFromRequest(req) });
    return;
  }

  if (req.method === "POST" && parts[2] === "sign-up") {
    const result = auth.signUp(await readJson(req));
    sendJson(res, 200, { user: result.user }, { "Set-Cookie": result.sessionCookie });
    return;
  }

  if (req.method === "POST" && parts[2] === "sign-in") {
    const result = auth.signIn(await readJson(req));
    sendJson(res, 200, { user: result.user }, { "Set-Cookie": result.sessionCookie });
    return;
  }

  if (req.method === "POST" && parts[2] === "sign-out") {
    const sessionCookie = auth.signOut(req);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie });
    return;
  }

  notFound(res);
}

async function handlePages(req, res, parts) {
  const user = auth.requireUser(req);

  if (parts.length === 2 && req.method === "GET") {
    sendJson(res, 200, pages.listPages(user));
    return;
  }

  if (parts.length === 2 && req.method === "POST") {
    const payload = await readJson(req);
    const page = pages.createPage({
      title: payload.title,
      core: payload.core,
      visibility: payload.visibility,
      owner: user,
    });
    broadcastPage(page.id, "page-change", { actorId: user.id });
    sendJson(res, 200, page);
    return;
  }

  if (parts[2] === "slug" && parts[3] && req.method === "GET") {
    const page = pages.getPageBySlug(parts[3], user);
    if (!page) notFound(res);
    else sendJson(res, 200, page);
    return;
  }

  const pageId = parts[2];
  if (!pageId) {
    notFound(res);
    return;
  }

  if (parts.length === 3 && req.method === "GET") {
    sendJson(res, 200, pages.getPageById(pageId, user));
    return;
  }

  if (parts.length === 3 && req.method === "PATCH") {
    const payload = await readJson(req);
    const result = pages.updatePageCore({
      pageId,
      title: payload.title,
      visibility: payload.visibility,
      core: payload.core,
      expectedRevision: payload.expectedRevision,
      user,
    });
    if (result.conflict) {
      sendJson(res, 409, { conflict: true, bundle: pages.loadPageBundle(pageId, user) });
      return;
    }
    broadcastPage(pageId, "page-change", { actorId: user.id });
    sendJson(res, 200, result.page);
    return;
  }

  if (parts[3] === "bundle" && req.method === "GET") {
    sendJson(res, 200, pages.loadPageBundle(pageId, user));
    return;
  }

  if (parts[3] === "events" && req.method === "GET") {
    requirePageRole(pageId, user, "viewer");
    const cleanup = addClient(pageId, res);
    req.on("close", cleanup);
    return;
  }

  if (parts[3] === "weeks") {
    await handleWeeks(req, res, pageId, parts, user);
    return;
  }

  if (parts[3] === "members") {
    await handleMembers(req, res, pageId, parts, user);
    return;
  }

  if (parts[3] === "invites") {
    await handlePageInvites(req, res, pageId, user);
    return;
  }

  if (parts[3] === "share-links") {
    await handlePageShareLinks(req, res, pageId, user);
    return;
  }

  if (parts[3] === "comment-threads" && req.method === "POST") {
    const payload = await readJson(req);
    const result = comments.createThread({
      pageId,
      anchor: payload.anchor,
      body: payload.body,
      author: user,
    });
    broadcastPage(pageId, "comments-change", { actorId: user.id });
    sendJson(res, 200, result);
    return;
  }

  notFound(res);
}

async function handleWeeks(req, res, pageId, parts, user) {
  const weekKey = parts[4];
  if (!weekKey) {
    notFound(res);
    return;
  }
  if (req.method === "PUT") {
    const payload = await readJson(req);
    const result = pages.saveWeek({
      pageId,
      weekKey,
      weekStart: payload.weekStart,
      weekEnd: payload.weekEnd,
      entries: payload.entries || {},
      expectedRevision: payload.expectedRevision,
      user,
    });
    if (result.conflict) {
      sendJson(res, 409, { conflict: true, bundle: pages.loadPageBundle(pageId, user) });
      return;
    }
    broadcastPage(pageId, "weeks-change", { actorId: user.id });
    sendJson(res, 200, result.row);
    return;
  }
  if (req.method === "DELETE") {
    pages.deleteWeek(pageId, weekKey, user);
    broadcastPage(pageId, "weeks-change", { actorId: user.id });
    sendJson(res, 200, { ok: true });
    return;
  }
  notFound(res);
}

async function handleMembers(req, res, pageId, parts, user) {
  const memberUserId = parts[4];
  if (!memberUserId) {
    if (req.method === "GET") {
      sendJson(res, 200, pages.listMembers(pageId, user));
      return;
    }
    notFound(res);
    return;
  }
  if (req.method === "PATCH") {
    const payload = await readJson(req);
    pages.updateMemberRole(pageId, memberUserId, payload.role, user);
    broadcastPage(pageId, "members-change", { actorId: user.id });
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "DELETE") {
    pages.removeMember(pageId, memberUserId, user);
    broadcastPage(pageId, "members-change", { actorId: user.id });
    sendJson(res, 200, { ok: true });
    return;
  }
  notFound(res);
}

async function handlePageInvites(req, res, pageId, user) {
  if (req.method === "GET") {
    sendJson(res, 200, pages.listInvites(pageId, user));
    return;
  }
  if (req.method === "POST") {
    const payload = await readJson(req);
    const invite = pages.createInvite({
      pageId,
      pageTitle: payload.pageTitle,
      inviteEmail: payload.inviteEmail,
      role: payload.role,
      inviter: user,
    });
    broadcastPage(pageId, "members-change", { actorId: user.id });
    sendJson(res, 200, invite);
    return;
  }
  notFound(res);
}

async function handleInvites(req, res, parts) {
  const user = auth.requireUser(req);
  if (parts[2] === "pending" && req.method === "GET") {
    sendJson(res, 200, pages.listPendingInvites(user));
    return;
  }
  const inviteId = parts[2];
  if (!inviteId) {
    notFound(res);
    return;
  }
  if (parts[3] === "accept" && req.method === "POST") {
    const pageId = pages.acceptInvite(inviteId, user);
    broadcastPage(pageId, "members-change", { actorId: user.id });
    sendJson(res, 200, { pageId });
    return;
  }
  if (parts[3] === "revoke" && req.method === "POST") {
    pages.revokeInvite(inviteId, user);
    sendJson(res, 200, { ok: true });
    return;
  }
  notFound(res);
}

async function handlePageShareLinks(req, res, pageId, user) {
  if (req.method === "GET") {
    sendJson(res, 200, pages.listShareLinks(pageId, user));
    return;
  }
  if (req.method === "POST") {
    const payload = await readJson(req);
    const result = pages.createShareLink({
      pageId,
      pageTitle: payload.pageTitle,
      role: payload.role,
      creator: user,
    });
    sendJson(res, 200, result);
    return;
  }
  notFound(res);
}

async function handleShareLinks(req, res, parts) {
  const user = auth.requireUser(req);
  if (parts[2] === "join" && req.method === "POST") {
    const payload = await readJson(req);
    const pageId = pages.joinShareLink(payload.rawToken, user);
    broadcastPage(pageId, "members-change", { actorId: user.id });
    sendJson(res, 200, { pageId });
    return;
  }
  const linkId = parts[2];
  if (linkId && parts[3] === "revoke" && req.method === "POST") {
    pages.revokeShareLink(linkId, user);
    sendJson(res, 200, { ok: true });
    return;
  }
  notFound(res);
}

async function handleCommentThreads(req, res, parts) {
  const user = auth.requireUser(req);
  const threadId = parts[2];
  if (!threadId) {
    notFound(res);
    return;
  }
  if (parts[3] === "comments" && req.method === "POST") {
    const payload = await readJson(req);
    const pageId = payload.pageId;
    if (!pageId) {
      badRequest(res, "pageId is required");
      return;
    }
    const comment = comments.createComment({
      threadId,
      pageId,
      body: payload.body,
      author: user,
    });
    broadcastPage(pageId, "comments-change", { actorId: user.id });
    sendJson(res, 200, comment);
    return;
  }
  if (req.method === "PATCH") {
    const payload = await readJson(req);
    const thread = comments.setThreadStatus({
      threadId,
      status: payload.status,
      actor: user,
    });
    broadcastPage(thread.pageId, "comments-change", { actorId: user.id });
    sendJson(res, 200, thread);
    return;
  }
  notFound(res);
}

module.exports = {
  handleApi,
};
