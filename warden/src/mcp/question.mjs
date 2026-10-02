// The daily question: which one is asked, and whether an answer is in its set.
//
// The answer set is CLOSED -- two options, a short list, or an integer range --
// because the answer is drawn into the artwork, and nothing free-text can be.
// This module is pure: it reads the bank and decides, and writes nothing.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

/// Provisional until measured; a constant so changing it needs no redeploy.
export const ANSWER_WINDOW_MS = 60_000;

const MAX_OPTIONS = 16;
const MAX_RANGE = 101;
const ASCII = /^[\x20-\x7e]+$/;
const norm = (s) => String(s).trim().toLowerCase();

export function assertBankSane(bank) {
  if (!Array.isArray(bank) || bank.length === 0) throw new Error("question bank is empty");
  const ids = new Set();
  for (const q of bank) {
    if (typeof q.id !== "string" || !q.id || ids.has(q.id)) throw new Error(`question id missing or repeated: ${q.id}`);
    ids.add(q.id);
    if (typeof q.text !== "string" || !ASCII.test(q.text)) throw new Error(`question ${q.id}: text must be printable ASCII`);
    if (Array.isArray(q.answers) === (q.range !== undefined)) throw new Error(`question ${q.id}: exactly one of answers or range`);
    if (q.answers) {
      if (q.answers.length < 2 || q.answers.length > MAX_OPTIONS) throw new Error(`question ${q.id}: 2 to ${MAX_OPTIONS} answers`);
      if (!q.answers.every((a) => typeof a === "string" && ASCII.test(a))) throw new Error(`question ${q.id}: answers must be printable ASCII`);
      if (new Set(q.answers.map(norm)).size !== q.answers.length) throw new Error(`question ${q.id}: answers repeat`);
    } else {
      const { min, max } = q.range;
      if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min + 1 > MAX_RANGE) {
        throw new Error(`question ${q.id}: range must be 2 to ${MAX_RANGE} integers`);
      }
    }
  }
  return bank;
}

export function loadBank(path) {
  return assertBankSane(JSON.parse(readFileSync(path, "utf8")));
}

/// Keyed by the Warden's secret so the day's question cannot be read in advance.
export function questionFor(day, secret, bank) {
  const h = createHmac("sha256", secret).update(`question:${day}`).digest();
  return bank[h.readUInt32BE(0) % bank.length];
}

/// The index, not the text, because that is what the artwork stores.
export function answerIndex(q, answer) {
  if (q.answers) {
    if (typeof answer !== "string") return null;
    const i = q.answers.findIndex((a) => norm(a) === norm(answer));
    return i === -1 ? null : i;
  }
  const n = typeof answer === "number" ? answer : /^\s*-?\d+\s*$/.test(String(answer)) ? Number(answer) : NaN;
  if (!Number.isInteger(n) || n < q.range.min || n > q.range.max) return null;
  return n - q.range.min;
}

/// Without the id: it is the bank's own key, not part of what is asked.
export function publicShape(q) {
  return q.answers ? { question: q.text, answers: [...q.answers] } : { question: q.text, range: { ...q.range } };
}
