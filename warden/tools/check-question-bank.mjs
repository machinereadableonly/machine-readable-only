// Validate the private question bank and print its SHAPE, never its content.
//
//   cd warden && node tools/check-question-bank.mjs
//
// Exits 0 only when the bank passes every rule the Warden enforces at boot, so
// it can gate an edit rather than be eyeballed. The bank is private: the
// repository is public and a published bank would let an agent prepare its
// answers in advance. Nothing printed here names a question, on a pass or on a
// refusal: the Warden's own messages name an entry by its id, and an id is a
// slug of the question text, so a refusal is renamed by POSITION before it is
// printed. Its output is safe in any log.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBank, bankPath, MAX_ANSWER_LENGTH } from "../src/mcp/question.mjs";

/// The first entry `assertBankSane` would refuse for its id, in the order it
/// checks them, so a refusal carrying no usable id still names a position.
function firstBadId(entries) {
  const seen = new Set();
  for (const [i, q] of entries.entries()) {
    const id = q?.id;
    if (typeof id !== "string" || id === "" || seen.has(id)) return i;
    seen.add(id);
  }
  return -1;
}

/// Rewrite one of the Warden's refusals to name the entry's position instead
/// of its id. The Warden keeps the id in its own logs, which are private; this
/// output is not. A bank-wide refusal names no entry and passes through.
export function namedByPosition(message, entries = []) {
  const at = (i) => (i === -1 ? "an entry" : `entry ${i}`);
  if (/^question id missing or repeated: /.test(message)) {
    return `${at(firstBadId(entries))}: its id is missing or repeated`;
  }
  // "question bank <...>" is about the whole file -- an id is a slug and never
  // contains a space, so the space is what tells the two apart. Without this,
  // "question bank not found: ..." reads as an entry called "bank not found".
  if (/^question bank /.test(message)) return message;
  const named = message.match(/^question (.+?): (.+)$/);
  if (!named) return message;
  return `${at(entries.findIndex((q) => q?.id === named[1]))}: ${named[2]}`;
}

/// Best effort, and only ever used to name a position: `loadBank` has already
/// reported the real failure by the time this runs, and a bank too broken to
/// parse has no positions to name.
function entriesIn(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

const span = (ns) => (ns.length ? `${Math.min(...ns)} to ${Math.max(...ns)}` : "none");

function main() {
  const path = bankPath();
  let bank;
  try {
    bank = loadBank(path);
  } catch (err) {
    // The message only, renamed. A stack would name the path, and the default
    // path carries the home directory.
    console.error(`question bank REFUSED: ${namedByPosition(err.message, entriesIn(path))}`);
    process.exit(1);
  }

  const lists = bank.filter((q) => q.answers);
  const two = lists.filter((q) => q.answers.length === 2);
  const many = lists.filter((q) => q.answers.length > 2);
  const ranges = bank.filter((q) => q.range);
  const pct = (n) => `${((100 * n) / bank.length).toFixed(1)}%`;
  const widest = Math.max(0, ...ranges.map((q) => q.range.max - q.range.min + 1));
  const longest = Math.max(0, ...lists.flatMap((q) => q.answers.map((a) => a.length)));

  console.log(`question bank: ${bank.length} questions`);
  console.log(`  two-way  ${String(two.length).padStart(4)}  ${pct(two.length)}`);
  console.log(`  lists    ${String(many.length).padStart(4)}  ${pct(many.length)}  (${span(many.map((q) => q.answers.length))} options)`);
  console.log(`  ranges   ${String(ranges.length).padStart(4)}  ${pct(ranges.length)}  (widest ${widest} values)`);
  console.log(`  longest option ${longest} of ${MAX_ANSWER_LENGTH} characters`);
  console.log("PASS");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
