// The mirror hash, checked in the direction Solidity cannot check.
//
// WHY THIS EXISTS. contracts/test/Ladder.t.sol asserts
// keccak256(abi.encode(Ladder.all())) against a literal a human pasted in from
// `node tools/ladder-fixture.mjs`. Change the SOLIDITY ladder and that test
// fails, correctly. Change the JAVASCRIPT catalogue and nothing fails at all --
// Ladder.all() still hashes to the pasted constant, and nothing re-runs the
// generator. Proven on 2026-09-02: setting LADDER[3].minLevel from 30 to 10 left
// contracts, warden, tools and client all green, while the Warden would sell
// Static to a level-10 token, take $5.00, queue the order, and watch the chain
// revert MarkGate at 00:05. That is the exact "sells an agent something the
// chain will refuse, AFTER it has paid" failure the hash is meant to prevent.
//
// This is the same treatment warden/test/abi.test.mjs gave the generated ABI:
// re-run the generator's own comparison rather than trusting that somebody did.
//
// WHY IT SKIPS RATHER THAN FAILS without the Solidity file. Ladder.t.sol is
// committed, so in a normal checkout this never fires; it exists so a partial
// checkout produces a skip instead of a red suite, because a guard that fails
// for the wrong reason gets deleted and then it guards nothing. It needs no
// forge build -- the pinned literal is in the test source, not in contracts/out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ladderHash } from "../ladder-fixture.mjs";

const LADDER_TEST = fileURLToPath(
  new URL("../../contracts/test/Ladder.t.sol", import.meta.url)
);

let source = null;
try {
  source = readFileSync(LADDER_TEST, "utf8");
} catch {
  source = null;
}

const skip = source ? false : "contracts/test/Ladder.t.sol is not in this checkout";

test("the Warden catalogue still hashes to what Ladder.t.sol pins", { skip }, () => {
  // The only 64-digit hex literal in that file, and it is asserted to be the
  // only one: a second would make this test pick whichever came first and pass
  // for the wrong reason.
  const pinned = source.match(/0x[0-9a-fA-F]{64}/g);
  assert.equal(pinned?.length, 1,
    "expected exactly one 32-byte literal in Ladder.t.sol -- this test can no longer tell which is the ladder hash");
  assert.equal(ladderHash(), pinned[0].toLowerCase(),
    "the Warden's catalogue moved -- re-run `node tools/ladder-fixture.mjs` and paste the result into contracts/test/Ladder.t.sol, then check the two ladders really do agree");
});
