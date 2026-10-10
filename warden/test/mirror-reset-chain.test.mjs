// The redeploy reset, driven as the operator runs it.
//
// The tool is a script rather than a module, so this runs the real file against
// a real database file: a test importing a copy of its table list would be
// testing its own copy. A table missing from that list leaves phantom rows
// keyed on ids the new contract restarts at 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";

const TOOL = fileURLToPath(new URL("../tools/mirror-reset-chain.mjs", import.meta.url));

test("the reset clears every chain-derived table, questions included, and keeps keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-reset-"));
  const path = join(dir, "state.db");
  try {
    const db = openDb(path);
    const q = queries(db);
    q.insertKey({ keyId: "k1", jwk: { kty: "OKP" }, directory: "https://example.com", registeredAt: 1_000 });
    q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
    q.insertMint({ tokenId: 1, toAddress: "0xabc", keyId: "k1", payNonce: "0x01" });
    q.insertCredit(1, 101, "f".repeat(64));
    q.issueQuestion(1, 101, "t-two", 1_000);
    q.recordAnswer(1, 101, 1, 2_000);
    q.putEvidence("credit", "1:101", { base: "old contract's request" });
    assert.ok(q.getQuestion(1, 101), "the row to be cleared must exist first");
    db.close();

    execFileSync("node", [TOOL, path, "--yes"], { encoding: "utf8", stdio: "pipe" });

    const after = openDb(path);
    const rows = (table) => after.prepare(`select count(*) as c from "${table}"`).get().c;
    for (const table of ["tokens", "mints", "credits", "mark_orders", "questions", "evidence"]) {
      assert.equal(rows(table), 0, `${table} still holds rows of the old contract`);
    }
    assert.equal(rows("keys"), 1, "a registered key is door state and must survive");
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
