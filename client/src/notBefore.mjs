// A UTC day before which `beat` does nothing. Strict on input: an unset guard
// must fail, never read as "no guard".
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseNotBefore(value) {
  const m = DAY.exec(value ?? "");
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return value;
  }
  throw new Error(`--not-before needs a UTC day as YYYY-MM-DD, got "${value ?? ""}"`);
}

export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);

export const notYet = (day, now = new Date()) => utcToday(now) < day;
