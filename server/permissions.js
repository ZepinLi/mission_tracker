const { openDatabase } = require("./db");

const ROLE_RANKS = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

function roleRank(role) {
  return ROLE_RANKS[role] || 0;
}

function getPageRole(pageId, userId) {
  const db = openDatabase();
  const page = db.prepare("select owner_id from pages where id = ?").get(pageId);
  if (!page) return "";
  if (page.owner_id === userId) return "owner";
  const member = db
    .prepare("select role from page_members where page_id = ? and user_id = ?")
    .get(pageId, userId);
  return member?.role || "";
}

function hasPageRole(pageId, userId, minRole) {
  return roleRank(getPageRole(pageId, userId)) >= roleRank(minRole);
}

function requirePageRole(pageId, user, minRole) {
  if (!user || !hasPageRole(pageId, user.id || user.userId, minRole)) {
    const error = new Error("Forbidden");
    error.status = 403;
    throw error;
  }
  return getPageRole(pageId, user.id || user.userId);
}

module.exports = {
  getPageRole,
  hasPageRole,
  requirePageRole,
  roleRank,
};
