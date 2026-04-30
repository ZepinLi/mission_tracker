import { formatShortDate } from "./date.js";
import { toTitleCase } from "./utils.js";

export function makeMissionAnchor() {
  return "core:mission";
}

export function makeActionAnchor(date, actionId) {
  return `entry:${date}:action:${actionId}`;
}

export function makeKeyActionAnchor(date, identityId) {
  return `entry:${date}:keyAction:${identityId}`;
}

export function makeReflectionAnchor(date, field) {
  return `entry:${date}:reflection:${field}`;
}

export function makePrincipleAnchor(date, field) {
  return `entry:${date}:principle:${field}`;
}

export function parseAnchor(anchor) {
  const parts = String(anchor || "").split(":");
  if (parts[0] === "core") {
    return {
      type: "core",
      field: parts[1] || "mission",
    };
  }
  if (parts[0] !== "entry") {
    return { type: "unknown", raw: anchor };
  }
  return {
    type: parts[2] || "entry",
    date: parts[1],
    target: parts[3],
    field: parts[4],
    raw: anchor,
  };
}

export function describeAnchor(anchor, state) {
  const parsed = parseAnchor(anchor);
  if (parsed.type === "core") {
    return "Mission Core";
  }
  if (parsed.type === "action") {
    const action = (state?.core?.actions || []).find((item) => item.id === parsed.target);
    return `${formatShortDate(parsed.date)} · ${action ? action.title : toTitleCase(parsed.target)}`;
  }
  if (parsed.type === "keyAction") {
    const identity = (state?.core?.identities || []).find((item) => item.id === parsed.target);
    return `${formatShortDate(parsed.date)} · ${identity ? identity.title : toTitleCase(parsed.target)} key action`;
  }
  if (parsed.type === "reflection") {
    return `${formatShortDate(parsed.date)} · Reflection · ${toTitleCase(parsed.target)}`;
  }
  if (parsed.type === "principle") {
    return `${formatShortDate(parsed.date)} · Principle · ${toTitleCase(parsed.target)}`;
  }
  return "Discussion";
}
