import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CODE_BYTES, CODE_HEX_CHARS } from "../tools/code-bytes.mjs";

// The rehearsal tools carried 172 through a QR version raise and every one of
// them would have reverted BadCodeLength on the first mint. A copy of a
// contract constant needs something that reads the contract.
const constantIn = (path, name) => {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const m = src.match(new RegExp(`constant ${name} = (\\d+);`));
  assert.ok(m, `${name} not found in ${path}`);
  return Number(m[1]);
};

test("CODE_BYTES matches the length both token contracts enforce", () => {
  assert.equal(constantIn("../../contracts/src/MachineReadableOnly.sol", "CODE_BYTES"), CODE_BYTES);
  assert.equal(constantIn("../../contracts/src/spike/MROSpikeToken.sol", "CODE_BYTES"), CODE_BYTES);
  assert.equal(CODE_HEX_CHARS, CODE_BYTES * 2);
});
