import {
  makeActionAnchor,
  makeKeyActionAnchor,
} from "../lib/anchors.js";
import { formatDateTime, formatShortDate, formatTinyDate } from "../lib/date.js";
import {
  actionScore,
  actionsForIdentity,
  currentStreak,
  dayScore,
  getActionRecord,
  groupEntriesByISOWeek,
  identityScore,
  lastWeekDates,
  recentPrinciples,
} from "../state/schema.js";
import {
  canComment,
  canManage,
  escapeAttr,
  escapeHTML,
  roleRank,
  toPercent,
} from "../lib/utils.js";

function commentMeta(commentStats, anchor) {
  return commentStats?.[anchor] || { openCount: 0, totalCount: 0 };
}

function renderCommentButton(anchor, label, commentStats, selectedAnchor) {
  const stats = commentMeta(commentStats, anchor);
  const count = stats.openCount || stats.totalCount;
  return `
    <button
      type="button"
      class="comment-chip ${selectedAnchor === anchor ? "active" : ""}"
      data-comment-anchor="${escapeAttr(anchor)}"
      aria-label="${escapeAttr(label)}"
    >
      <span>Comment</span>
      ${count ? `<strong>${count}</strong>` : ""}
    </button>
  `;
}

export function renderPageOptions(pages, currentPageId) {
  if (!pages.length) {
    return `<option value="">Create your first page</option>`;
  }
  return pages
    .map((page) => {
      const relationship = page.role === "owner" ? "Mine" : "Shared";
      return `<option value="${page.id}" ${page.id === currentPageId ? "selected" : ""}>${escapeHTML(page.title)} · ${relationship}</option>`;
    })
    .join("");
}

export function renderIdentities(core, entries, selectedDate) {
  return (core.identities || [])
    .map((identity) => {
      const score = identityScore(core, entries, selectedDate, identity.id);
      const week = lastWeekDates(selectedDate).reduce((sum, date) => {
        return sum + identityScore(core, entries, date, identity.id);
      }, 0) / 7;

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

export function renderBalanceBars(core, entries, selectedDate) {
  return (core.identities || [])
    .map((identity) => {
      const score =
        lastWeekDates(selectedDate).reduce((sum, date) => {
          return sum + identityScore(core, entries, date, identity.id);
        }, 0) / 7;

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

export function renderActionBoard({ core, entries, selectedDate, commentStats, selectedAnchor }) {
  return (core.identities || [])
    .map((identity) => {
      const actions = actionsForIdentity(core, identity.id);
      const laneScore = identityScore(core, entries, selectedDate, identity.id);
      const keyActionAnchor = makeKeyActionAnchor(selectedDate, identity.id);
      const entry = entries[selectedDate];
      const keyActionValue = entry?.keyActions?.[identity.id] || "";

      return `
        <div class="action-lane" style="--lane-bg: ${identity.soft}">
          <div class="lane-head">
            <div>
              <h3>${escapeHTML(identity.title)}</h3>
              <p>${toPercent(laneScore)} alignment</p>
            </div>
            ${renderCommentButton(
              keyActionAnchor,
              `${identity.title} key action comments`,
              commentStats,
              selectedAnchor
            )}
          </div>
          <div class="key-action-card" style="--accent: ${identity.accent}">
            <div class="key-action-copy">
              <span>Daily key actions</span>
              <p>${escapeHTML(keyActionPrompt(identity.id))}</p>
            </div>
            <textarea
              class="key-action-input"
              data-key-action
              data-identity-id="${identity.id}"
              rows="3"
              placeholder="${escapeAttr(keyActionPlaceholder(identity.id))}"
            >${escapeHTML(keyActionValue)}</textarea>
          </div>
          <div class="action-list">
            ${actions
              .map((action) =>
                renderAction({
                  action,
                  entries,
                  selectedDate,
                  commentStats,
                  selectedAnchor,
                })
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAction({ action, entries, selectedDate, commentStats, selectedAnchor }) {
  const anchor = makeActionAnchor(selectedDate, action.id);
  const record = getActionRecord(entries, selectedDate, action.id);
  const value = record.value || 0;
  const score = actionScore(action, entries, selectedDate);
  const level = score >= 1 ? "target" : score >= 0.5 ? "minimum" : "none";

  return `
    <article class="action-item ${selectedAnchor === anchor ? "comment-focus" : ""}">
      <div class="action-main">
        <div class="item-head">
          <div>
            <h4>${escapeHTML(action.title)}</h4>
            <p>Min ${action.minimum} ${escapeHTML(action.unit)} / Target ${action.target} ${escapeHTML(action.unit)}</p>
          </div>
          ${renderCommentButton(anchor, `${action.title} comments`, commentStats, selectedAnchor)}
        </div>
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
        <div class="segmented" aria-label="${escapeAttr(action.title)} status">
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

function keyActionPrompt(identityId) {
  const prompts = {
    venture: "Write the 1-3 moves that make your venture more real today.",
    research: "Write the research question, experiment, or artifact that matters today.",
    family: "Write how you will make family feel seen, accompanied, and protected today.",
  };
  return prompts[identityId] || "Write the few actions that matter most today.";
}

function keyActionPlaceholder(identityId) {
  const placeholders = {
    venture: "Example: Interview 1 user; draft one offer; ship a small demo note.",
    research: "Example: Reproduce one result; write one hypothesis; inspect one failure mode.",
    family: "Example: 30-min walk with wife; handle one household task; call parents.",
  };
  return placeholders[identityId] || "Write 1-3 concrete actions for today.";
}

export function renderPrincipleCards(entries) {
  const items = recentPrinciples(entries);
  if (!items.length) {
    return "";
  }
  return items
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

export function renderHeatmap(core, entries, selectedDate) {
  const dates = lastWeekDates(selectedDate);
  const header = `
    <div class="heatmap-row">
      <div class="heatmap-label">Action</div>
      ${dates.map((date) => `<div class="heatmap-day">${formatTinyDate(date)}</div>`).join("")}
    </div>
  `;

  const rows = (core.actions || [])
    .map((action) => {
      return `
        <div class="heatmap-row">
          <div class="heatmap-label">${escapeHTML(action.title)}</div>
          ${dates
            .map((date) => {
              const score = actionScore(action, entries, date);
              const background = score >= 1 ? "#dcefe9" : score >= 0.5 ? "#f5ead8" : "#f0f3f5";
              const label = score >= 1 ? "Done" : score >= 0.5 ? "Min" : "";
              return `<div class="heatmap-cell" style="--cell-bg: ${background}">${label}</div>`;
            })
            .join("")}
        </div>
      `;
    })
    .join("");

  return `<div class="heatmap-grid">${header}${rows}</div>`;
}

export function renderMemberList(members, currentUserId, currentRole) {
  if (!members.length) {
    return `<p class="empty-state">No collaborators yet.</p>`;
  }
  return members
    .sort((left, right) => roleRank(right.role) - roleRank(left.role))
    .map((member) => {
      const canManageRole = canManage(currentRole) && member.role !== "owner";
      return `
        <article class="member-card">
          <div class="member-main">
            <div class="avatar">${escapeHTML((member.displayName || "?").slice(0, 1).toUpperCase())}</div>
            <div>
              <strong>${escapeHTML(member.displayName)}</strong>
              <p>${escapeHTML(member.email || "")}</p>
            </div>
          </div>
          <div class="member-actions">
            ${
              canManageRole
                ? `
                  <select data-member-role="${member.userId}" class="inline-select">
                    ${["viewer", "commenter", "editor"]
                      .map((role) => `<option value="${role}" ${role === member.role ? "selected" : ""}>${role}</option>`)
                      .join("")}
                  </select>
                  <button type="button" class="text-button subtle" data-remove-member="${member.userId}">Remove</button>
                `
                : `<span class="role-badge ${member.role}">${escapeHTML(member.role)}</span>`
            }
            ${member.userId === currentUserId ? `<span class="self-badge">You</span>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderInviteList(invites) {
  if (!invites.length) {
    return `<p class="empty-state">No pending invites.</p>`;
  }
  return invites
    .map((invite) => {
      return `
        <article class="invite-card">
          <div>
            <strong>${escapeHTML(invite.inviteEmail)}</strong>
            <p>${escapeHTML(invite.role)} access · invited ${formatDateTime(invite.createdAt)}</p>
          </div>
          <button type="button" class="text-button subtle" data-revoke-invite="${invite.id}">Revoke</button>
        </article>
      `;
    })
    .join("");
}

export function renderPendingInvites(invites) {
  if (!invites.length) {
    return `<p class="empty-state">No invitations waiting for this account.</p>`;
  }
  return invites
    .map((invite) => {
      return `
        <article class="invite-card">
          <div>
            <strong>${escapeHTML(invite.pageTitle)}</strong>
            <p>${escapeHTML(invite.role)} access · invited by ${escapeHTML(invite.invitedByName)}</p>
          </div>
          <button type="button" class="text-button save-button" data-accept-invite="${invite.id}">Accept</button>
        </article>
      `;
    })
    .join("");
}

export function renderShareLinks(links) {
  if (!links.length) {
    return `<p class="empty-state">No active share links.</p>`;
  }
  return links
    .map((link) => {
      return `
        <article class="share-link-card">
          <div>
            <strong>${escapeHTML(link.role)} link</strong>
            <p>Created ${formatDateTime(link.createdAt)} · token ending ${escapeHTML(link.tokenHint)}</p>
          </div>
          <button type="button" class="text-button subtle" data-revoke-share-link="${link.id}">Revoke</button>
        </article>
      `;
    })
    .join("");
}

export function renderCommentThreads({
  threads,
  commentsByThreadId,
  selectedAnchor,
  commentStats,
  currentRole,
}) {
  if (!selectedAnchor) {
    return `<p class="empty-state">Choose any field's comment button to open its thread.</p>`;
  }

  const items = threads.filter((thread) => thread.anchor === selectedAnchor);
  if (!items.length) {
    return `<p class="empty-state">No discussion yet for this field. Start the first thread.</p>`;
  }

  return items
    .map((thread) => {
      const comments = commentsByThreadId[thread.id] || [];
      const statusLabel = thread.status === "resolved" ? "Resolved" : "Open";
      return `
        <article class="thread-card ${thread.status === "resolved" ? "resolved" : ""}">
          <header class="thread-head">
            <div>
              <strong>${escapeHTML(thread.authorName)}</strong>
              <p>${formatDateTime(thread.createdAt)}</p>
            </div>
            <div class="thread-meta">
              <span class="status-pill ${thread.status}">${statusLabel}</span>
              ${
                canComment(currentRole)
                  ? thread.status === "open"
                    ? `<button type="button" class="icon-link" data-resolve-thread="${thread.id}">Resolve</button>`
                    : `<button type="button" class="icon-link" data-reopen-thread="${thread.id}">Reopen</button>`
                  : ""
              }
            </div>
          </header>
          <div class="thread-comments">
            ${comments
              .map((comment) => {
                return `
                  <div class="thread-comment">
                    <div class="comment-avatar">${escapeHTML(comment.authorName.slice(0, 1).toUpperCase())}</div>
                    <div class="comment-body">
                      <div class="comment-meta">
                        <strong>${escapeHTML(comment.authorName)}</strong>
                        <span>${formatDateTime(comment.createdAt)}</span>
                      </div>
                      <p>${escapeHTML(comment.body)}</p>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
          ${
            canComment(currentRole)
              ? `
                <div class="thread-reply">
                  <textarea rows="2" data-reply-input="${thread.id}" placeholder="Reply to this thread"></textarea>
                  <button type="button" class="text-button" data-reply-thread="${thread.id}">Reply</button>
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

export function buildCommentStats(threads) {
  return (threads || []).reduce((result, thread) => {
    if (!result[thread.anchor]) {
      result[thread.anchor] = {
        totalCount: 0,
        openCount: 0,
      };
    }
    result[thread.anchor].totalCount += 1;
    if (thread.status !== "resolved") {
      result[thread.anchor].openCount += 1;
    }
    return result;
  }, {});
}

export function renderConflictSummary(conflicts) {
  if (!conflicts?.length) {
    return "";
  }
  return `
    <ul class="conflict-list">
      ${conflicts.map((conflict) => `<li>${escapeHTML(conflict.path)}</li>`).join("")}
    </ul>
  `;
}

export function computeDashboardStats(core, entries, selectedDate) {
  const today = dayScore(core, entries, selectedDate);
  const week =
    lastWeekDates(selectedDate).reduce((sum, date) => {
      return sum + dayScore(core, entries, date);
    }, 0) / 7;

  return {
    today,
    week,
    streak: currentStreak(core, entries),
    totalWeeks: groupEntriesByISOWeek(entries).size,
  };
}
