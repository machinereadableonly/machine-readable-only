// The "read the contract yourself" command agents are given must decode what
// viewOf actually returns: the tuple is derived from the ABI, not remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MRO_ABI } from "../src/clock/abi.mjs";

const type = (c) => (c.type === "tuple" ? `(${c.components.map(type).join(",")})` : c.type);
const fields = MRO_ABI.find((x) => x.name === "viewOf").outputs[0].components;
const signature = `viewOf(uint256)((${fields.map(type).join(",")}))`;

for (const doc of ["../../skills/machine-readable-only/SKILL.md", "../../docs/2026-09-01-mro-raw-protocol.md", "../../skills/machine-readable-only/references/raw-protocol.md"]) {
  test(`${doc.split("/").pop()} prints viewOf's real tuple`, () => {
    const text = readFileSync(new URL(doc, import.meta.url), "utf8");
    const printed = [...text.matchAll(/viewOf\(uint256\)\([^']*\)/g)].map((m) => m[0]);
    assert.ok(printed.length > 0, "the command is there");
    for (const p of printed) assert.equal(p, signature);
  });
}

test("the raw protocol names every field, in order", () => {
  const text = readFileSync(new URL("../../docs/2026-09-01-mro-raw-protocol.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(text.includes(`Reading left to right: ${fields.map((f) => f.name).join(", ")}.`));
});
