// The daily question: which one is asked, and whether an answer is in its set.
//
// The answer set is CLOSED -- two options, a short list, or an integer range --
// because the answer is drawn into the artwork, and nothing free-text can be.
// This module is pure: it reads the bank and decides, and writes nothing.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DAY_MS } from "../day.mjs";

/// How long an issued question stays answerable. Far wider than a real agent
/// needs; a constant, so changing it needs no redeploy.
export const ANSWER_WINDOW_MS = 30_000;

/// The answer deadline: the window, but never past the end of the UTC day the
/// question was asked, because an answer after midnight is a check-in for a
/// day with no question.
export const answerDeadline = (issuedAt, day) => Math.min(issuedAt + ANSWER_WINDOW_MS, (day + 1) * DAY_MS - 1);

/// The longest answer `checkin` accepts. The bank is checked against it too:
/// an option longer than this could never be answered.
export const MAX_ANSWER_LENGTH = 64;

const MAX_OPTIONS = 16;
const MAX_RANGE = 101;
const ASCII = /^[\x20-\x7e]+$/;
/// An id is derived from the question text, so it must not be able to carry
/// punctuation or spaces: `check-question-bank.mjs` tells a refusal naming one
/// entry from one naming the whole bank by this shape, and exporting it keeps
/// one definition rather than two that can drift.
export const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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
    // The one refusal that names no id: an id free to hold any character is an
    // id free to hold the question, and this message is read in public.
    if (!KEBAB_ID.test(q.id)) throw new Error("question id must be kebab-case");
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

/// Outside every worktree: the repository is public and the bank must not be.
export function bankPath(env = process.env) {
  return env.MRO_QUESTION_BANK || join(homedir(), ".mro-questions", "bank.json");
}

export function loadBank(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // A FIXED SENTENCE, because the default path carries the home directory and
    // a boot failure is read in public. readFileSync's own message names it.
    throw new Error(
      err.code === "ENOENT"
        ? "question bank not found: set MRO_QUESTION_BANK or create .mro-questions/bank.json in the home directory"
        : `question bank could not be read (${err.code ?? "unknown error"})`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Also a FIXED SENTENCE: a parser quotes the bytes around the bad token,
    // and in this file those bytes are a question.
    throw new Error("question bank is not valid JSON");
  }
  return assertBankSane(parsed);
}

/// Refuse a bank that has lost a question already issued to a token.
///
/// The artwork records the answer as an index against the question that was
/// issued, so an id the bank no longer holds can never be graded or drawn.
/// Called at boot: one refusal there beats a token whose day is silent for
/// ever because of an edit of ours.
export function assertIssuedQuestionsPresent(q, bank) {
  const held = new Set(bank.map((b) => b.id));
  const missing = q.issuedQuestionIds().filter((id) => !held.has(id));
  // The COUNT only. An id names a question, and this reaches a public log.
  if (missing.length > 0) {
    throw new Error(
      `question bank is missing ${missing.length} question${missing.length === 1 ? "" : "s"} already ` +
        "issued to a token: restore them, or no answer to them can ever be recorded"
    );
  }
  return bank;
}

/// How many answers a question offers: its options, or every integer in its range.
export const answerSetSize = (q) => (q.answers ? q.answers.length : q.range.max - q.range.min + 1);

/**
 * Why `next` is not an append to `previous`, or null. The bank is append-only:
 * every question already in it stays exactly as it was, in place, because an
 * edited question -- an option added, a range widened -- changes which recorded
 * answers fill a square on a day already answered. New questions go at the end.
 */
export function appendOnlyProblem(previous, next) {
  if (next.length < previous.length) return `${previous.length - next.length} question(s) were removed`;
  for (let i = 0; i < previous.length; i += 1) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(next[i])) return `entry ${i} changed; existing questions may not change`;
  }
  return null;
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
    // A client cannot know an option is spelled in digits without the question
    // in front of it, and the reference client sends a digits-only answer as an
    // integer -- so a number is matched by its decimal spelling. Only a number:
    // an array, a bigint or an object with a toString is still refused.
    const given = typeof answer === "number" ? String(answer) : answer;
    if (typeof given !== "string" || norm(given) === "") return null;
    const i = q.answers.findIndex((a) => norm(a) === norm(given));
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
