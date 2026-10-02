// The daily question: which one is asked, and whether an answer is in its set.
//
// The answer set is CLOSED -- two options, a short list, or an integer range --
// because the answer is drawn into the artwork, and nothing free-text can be.
// This module is pure: it reads the bank and decides, and writes nothing.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

/// Provisional until measured; a constant so changing it needs no redeploy.
export const ANSWER_WINDOW_MS = 60_000;

/// The longest answer `checkin` accepts. The bank is checked against it too:
/// an option longer than this could never be answered.
export const MAX_ANSWER_LENGTH = 64;

const MAX_OPTIONS = 16;
const MAX_RANGE = 101;
const ASCII = /^[\x20-\x7e]+$/;
const norm = (s) => String(s).trim().toLowerCase();
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/// Every refusal names what is wrong, so a hand-edited bank cannot be told
/// apart from a crash by its stack.
export function assertBankSane(bank) {
  if (!Array.isArray(bank)) throw new Error("question bank must be an array");
  if (bank.length === 0) throw new Error("question bank is empty");
  const ids = new Set();
  for (const q of bank) {
    if (!isPlainObject(q)) throw new Error("question bank entry must be an object");
    if (typeof q.id !== "string" || !q.id || ids.has(q.id)) throw new Error(`question id missing or repeated: ${q.id}`);
    ids.add(q.id);
    if (typeof q.text !== "string" || !ASCII.test(q.text)) throw new Error(`question ${q.id}: text must be printable ASCII`);
    if (Array.isArray(q.answers) === (q.range !== undefined)) throw new Error(`question ${q.id}: exactly one of answers or range`);
    if (q.answers) {
      if (q.answers.length < 2 || q.answers.length > MAX_OPTIONS) throw new Error(`question ${q.id}: 2 to ${MAX_OPTIONS} answers`);
      if (!q.answers.every((a) => typeof a === "string" && ASCII.test(a))) throw new Error(`question ${q.id}: answers must be printable ASCII`);
      // A blank option would match an empty answer, which is not an answer.
      if (q.answers.some((a) => norm(a) === "")) throw new Error(`question ${q.id}: an answer is blank`);
      if (q.answers.some((a) => a.length > MAX_ANSWER_LENGTH)) throw new Error(`question ${q.id}: an answer is longer than ${MAX_ANSWER_LENGTH}`);
      if (new Set(q.answers.map(norm)).size !== q.answers.length) throw new Error(`question ${q.id}: answers repeat`);
    } else {
      if (!isPlainObject(q.range)) throw new Error(`question ${q.id}: range must be an object`);
      const { min, max } = q.range;
      if (!Number.isInteger(min) || !Number.isInteger(max)) throw new Error(`question ${q.id}: range bounds must be integers`);
      if (max <= min || max - min + 1 > MAX_RANGE) throw new Error(`question ${q.id}: range must be 2 to ${MAX_RANGE} integers`);
    }
  }
  return bank;
}

export function loadBank(path) {
  return assertBankSane(JSON.parse(readFileSync(path, "utf8")));
}

/// Keyed by the Warden's secret so the day's question cannot be read in advance.
/// An absent key is a valid HMAC key and would make the whole year's order
/// public knowledge, so refuse one rather than defaulting it.
export function questionFor(day, secret, bank) {
  if (typeof secret !== "string" || secret.trim() === "") throw new Error("question secret must be a non-empty string");
  const h = createHmac("sha256", secret).update(`question:${day}`).digest();
  return bank[h.readUInt32BE(0) % bank.length];
}

/// The index, not the text, because that is what the artwork stores.
export function answerIndex(q, answer) {
  if (q.answers) {
    if (typeof answer !== "string" || norm(answer) === "") return null;
    const i = q.answers.findIndex((a) => norm(a) === norm(answer));
    return i === -1 ? null : i;
  }
  // Only a number or a string: stringifying would let [42] and 42n answer.
  const n = typeof answer === "number" ? answer : typeof answer === "string" && /^\s*-?\d+\s*$/.test(answer) ? Number(answer) : NaN;
  if (!Number.isInteger(n) || n < q.range.min || n > q.range.max) return null;
  return n - q.range.min;
}

/// Without the id: it is the bank's own key, not part of what is asked.
export function publicShape(q) {
  return q.answers ? { question: q.text, answers: [...q.answers] } : { question: q.text, range: { ...q.range } };
}
