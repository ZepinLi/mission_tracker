import { clone, deepEqual } from "../lib/utils.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function threeWayMerge(baseValue, localValue, remoteValue, path = []) {
  if (deepEqual(localValue, remoteValue)) {
    return { merged: clone(localValue), conflicts: [] };
  }
  if (deepEqual(baseValue, localValue)) {
    return { merged: clone(remoteValue), conflicts: [] };
  }
  if (deepEqual(baseValue, remoteValue)) {
    return { merged: clone(localValue), conflicts: [] };
  }

  if (Array.isArray(baseValue) || Array.isArray(localValue) || Array.isArray(remoteValue)) {
    return {
      merged: clone(localValue),
      conflicts: [
        {
          path: path.join(".") || "(root)",
          base: clone(baseValue),
          local: clone(localValue),
          remote: clone(remoteValue),
        },
      ],
    };
  }

  if (isPlainObject(baseValue) || isPlainObject(localValue) || isPlainObject(remoteValue)) {
    const merged = {};
    const conflicts = [];
    const keys = new Set([
      ...Object.keys(baseValue || {}),
      ...Object.keys(localValue || {}),
      ...Object.keys(remoteValue || {}),
    ]);

    for (const key of keys) {
      const result = threeWayMerge(baseValue?.[key], localValue?.[key], remoteValue?.[key], [...path, key]);
      if (result.merged !== undefined) {
        merged[key] = result.merged;
      }
      conflicts.push(...result.conflicts);
    }

    return {
      merged,
      conflicts,
    };
  }

  return {
    merged: clone(localValue),
    conflicts: [
      {
        path: path.join(".") || "(root)",
        base: clone(baseValue),
        local: clone(localValue),
        remote: clone(remoteValue),
      },
    ],
  };
}

export function resolveConflicts(conflicts, strategy = "local") {
  return conflicts.reduce((result, conflict) => {
    result[conflict.path] = strategy === "remote" ? clone(conflict.remote) : clone(conflict.local);
    return result;
  }, {});
}

export function applyConflictStrategy(mergedValue, conflicts, strategy = "local") {
  const nextValue = clone(mergedValue);
  for (const conflict of conflicts || []) {
    const segments = String(conflict.path || "")
      .split(".")
      .filter(Boolean)
      .filter((segment) => segment !== "(root)");
    if (!segments.length) {
      return strategy === "remote" ? clone(conflict.remote) : clone(conflict.local);
    }
    let target = nextValue;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (target[segment] == null || typeof target[segment] !== "object") {
        target[segment] = {};
      }
      target = target[segment];
    }
    target[segments[segments.length - 1]] =
      strategy === "remote" ? clone(conflict.remote) : clone(conflict.local);
  }
  return nextValue;
}

export function mergeTrackerState({ baseCore, localCore, remoteCore, baseEntries, localEntries, remoteEntries }) {
  const coreResult = threeWayMerge(baseCore, localCore, remoteCore, ["core"]);
  const entryResult = threeWayMerge(baseEntries, localEntries, remoteEntries, ["entries"]);
  return {
    core: coreResult.merged,
    entries: entryResult.merged,
    conflicts: [...coreResult.conflicts, ...entryResult.conflicts],
  };
}
