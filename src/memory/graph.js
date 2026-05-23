export const MEMORY_EDGE_TYPES = [
  "triggered_by",
  "caused_by",
  "prevented_by",
  "replaces_old_mechanism",
  "failed_under_condition",
  "contradicts",
  "needs_experiment",
  "causes",
  "prevents",
  "reinforces",
  "evolves_from",
  "same_context",
  "supports_goal",
];

export function memoryTypeLabel(type) {
  return String(type || "recurring_pattern")
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeMemoryEdge(edge = {}) {
  const type = MEMORY_EDGE_TYPES.includes(edge.type) ? edge.type : "same_context";
  return {
    id: String(edge.id || [edge.from, edge.to, type].filter(Boolean).join("-")),
    from: String(edge.from || ""),
    to: String(edge.to || ""),
    type,
    weight: clampWeight(edge.weight),
    source: String(edge.source || "deterministic"),
  };
}

export function normalizeMemoryEdges(edges = []) {
  const seen = new Set();
  return (Array.isArray(edges) ? edges : [])
    .map(normalizeMemoryEdge)
    .filter((edge) => edge.from && edge.to && edge.from !== edge.to)
    .filter((edge) => {
      const key = [edge.from, edge.to, edge.type].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildDeterministicEdges(items = []) {
  const accepted = items.filter((item) => String(item.status || "accepted") === "accepted");
  const edges = [];

  for (let index = 0; index < accepted.length; index += 1) {
    const current = accepted[index];
    const next = accepted[index + 1];
    if (next && current.type === next.type) {
      edges.push(edge(current.id, next.id, "evolves_from", 0.42));
    }
    for (let otherIndex = index + 1; otherIndex < accepted.length; otherIndex += 1) {
      const other = accepted[otherIndex];
      const sameDate = current.source?.date && current.source.date === other.source?.date;
      const sameCard = current.source?.loopPageId && current.source.loopPageId === other.source?.loopPageId;
      const shared = sharedKeywordScore(current, other);

      if (sameCard) edges.push(edge(current.id, other.id, "same_context", 0.82));
      else if (sameDate) edges.push(edge(current.id, other.id, "same_context", 0.62));
      if (shared >= 2) edges.push(edge(current.id, other.id, relationForTypes(current.type, other.type), Math.min(0.9, 0.36 + shared * 0.12)));
    }
  }

  return normalizeMemoryEdges(edges);
}

export function buildMemoryGraph({ items = [], edges = [], scope = "all", date = "", type = "all" } = {}) {
  const accepted = items
    .filter((item) => String(item.status || "accepted") === "accepted")
    .filter((item) => scope !== "current" || item.source?.date === date)
    .filter((item) => type === "all" || item.type === type);
  const nodeIds = new Set(accepted.map((item) => item.id));
  const combinedEdges = normalizeMemoryEdges([...edges, ...buildDeterministicEdges(items)])
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const nodes = layoutNodes(accepted);
  return { nodes, edges: combinedEdges };
}

function layoutNodes(items) {
  if (!items.length) return [];
  const centerX = 420;
  const centerY = 250;
  const radius = Math.max(120, Math.min(270, 86 + items.length * 18));
  return items.map((item, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, items.length)) * Math.PI * 2;
    const ringOffset = index % 3 === 0 ? -34 : index % 3 === 1 ? 18 : 46;
    return {
      ...item,
      x: Math.round(centerX + Math.cos(angle) * (radius + ringOffset)),
      y: Math.round(centerY + Math.sin(angle) * (radius + ringOffset) * 0.68),
    };
  });
}

function edge(from, to, type, weight) {
  return {
    id: [from, to, type].join("-"),
    from,
    to,
    type,
    weight,
    source: "deterministic",
  };
}

function relationForTypes(left, right) {
  if (left === "root_condition" && right === "recurring_pattern") return "caused_by";
  if (right === "root_condition" && left === "recurring_pattern") return "triggered_by";
  if (left === "root_condition" && right === "mechanism") return "prevented_by";
  if (right === "root_condition" && left === "mechanism") return "prevented_by";
  if (left === "mechanism" && right === "mechanism") return "replaces_old_mechanism";
  if (left === "open_loop" || right === "open_loop") return "needs_experiment";
  if (left === "experiment" || right === "experiment") return "needs_experiment";
  if (left === "principle" || right === "principle") return "reinforces";
  if (left === "recurring_pattern" || right === "recurring_pattern") return "triggered_by";
  return "same_context";
}

function sharedKeywordScore(left, right) {
  const leftWords = keywords(left);
  const rightWords = keywords(right);
  let count = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) count += 1;
  }
  return count;
}

function keywords(item) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "when", "then", "will", "what", "about"]);
  return new Set(
    String([item.title, item.body].filter(Boolean).join(" "))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stop.has(word))
      .slice(0, 36)
  );
}

function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0.1, number));
}
