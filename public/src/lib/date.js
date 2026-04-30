export function parseLocalDate(isoDate) {
  const [year, month, day] = String(isoDate || "")
    .split("-")
    .map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function localDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseUTCDate(isoDate) {
  const [year, month, day] = String(isoDate || "")
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function utcDateISO(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoWeekInfo(isoDate) {
  const date = parseUTCDate(isoDate);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);

  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);

  const start = parseUTCDate(isoDate);
  const startDay = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - startDay + 1);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    key: `${weekYear}-W${String(week).padStart(2, "0")}`,
    start: utcDateISO(start),
    end: utcDateISO(end),
  };
}

export function lastNDates(anchorDate, count) {
  const dates = [];
  const date = parseLocalDate(anchorDate);
  date.setDate(date.getDate() - count + 1);
  for (let index = 0; index < count; index += 1) {
    dates.push(localDateISO(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

export function formatShortDate(isoDate) {
  if (!isoDate) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDate(isoDate));
}

export function formatTinyDate(isoDate) {
  if (!isoDate) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseLocalDate(isoDate));
}

export function formatDateTime(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}
