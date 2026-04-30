const test = require("node:test");
const assert = require("node:assert/strict");

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
