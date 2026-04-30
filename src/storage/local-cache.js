import { safeJsonParse } from "../lib/utils.js";

const CACHE_KEY = "missionTracker.collab.v2";
const LEGACY_KEY = "missionTracker.v1";

function defaultCache() {
  return {
    selectedPageSlug: "",
    pendingShareToken: "",
    recentShareLink: null,
    pages: {},
  };
}

function readCache() {
  return safeJsonParse(localStorage.getItem(CACHE_KEY), defaultCache()) || defaultCache();
}

function writeCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function readPageCache(pageId) {
  const cache = readCache();
  return cache.pages[pageId] || null;
}

export function writePageCache(pageId, payload) {
  const cache = readCache();
  cache.pages[pageId] = payload;
  writeCache(cache);
}

export function clearPageCache(pageId) {
  const cache = readCache();
  delete cache.pages[pageId];
  writeCache(cache);
}

export function setSelectedPageSlug(slug) {
  const cache = readCache();
  cache.selectedPageSlug = slug || "";
  writeCache(cache);
}

export function getSelectedPageSlug() {
  return readCache().selectedPageSlug || "";
}

export function setPendingShareToken(token) {
  const cache = readCache();
  cache.pendingShareToken = token || "";
  writeCache(cache);
}

export function getPendingShareToken() {
  return readCache().pendingShareToken || "";
}

export function clearPendingShareToken() {
  const cache = readCache();
  cache.pendingShareToken = "";
  writeCache(cache);
}

export function setRecentShareLink(link) {
  const cache = readCache();
  cache.recentShareLink = link || null;
  writeCache(cache);
}

export function getRecentShareLink() {
  return readCache().recentShareLink || null;
}

export function readLegacyLocalState() {
  return safeJsonParse(localStorage.getItem(LEGACY_KEY), null);
}
