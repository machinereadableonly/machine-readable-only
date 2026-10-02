// Validate the private question bank and print its SHAPE, never its content.
//
//   cd warden && node tools/check-question-bank.mjs
//
// Exits 0 only when the bank passes every rule the Warden enforces at boot, so
// it can gate an edit rather than be eyeballed. The bank is private: the
// repository is public and a published bank would let an agent prepare its
// answers in advance. Nothing printed here names a question, so the output is
// safe in any log.
import { loadBank, bankPath, MAX_ANSWER_LENGTH } from "../src/mcp/question.mjs";

let bank;
try {
  bank = loadBank(bankPath());
} catch (err) {
  // The message only. A stack would name the path, and the default path
  // carries the home directory.
  console.error(`question bank REFUSED: ${err.message}`);
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
console.log(`  lists    ${String(many.length).padStart(4)}  ${pct(many.length)}  (3 to ${Math.max(0, ...many.map((q) => q.answers.length))} options)`);
console.log(`  ranges   ${String(ranges.length).padStart(4)}  ${pct(ranges.length)}  (widest ${widest} values)`);
console.log(`  longest option ${longest} of ${MAX_ANSWER_LENGTH} characters`);
console.log("PASS");
