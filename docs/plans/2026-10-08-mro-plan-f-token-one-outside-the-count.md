# Plan F: Token 1 Outside the Count -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately.

**Why:** token 1 is the project's own agent, minted before the door opens. Two
rounds of cold reads (12 fresh agents, 2026-10-08) found the same objection
every time: its handicap is "enforced in the operator's private copy of the
client, not the contract", so the race for the limited finisher places reads as
self-refereed. No wording fixed it. The operator ruled the same day that the
contract itself keeps token 1 out of the race. Mainnet is not deployed, so this
is the last moment it can be a contract rule: after token 1 exists on mainnet
the contract is permanent.

**What it unblocks:** the agent-facing copy can make a claim a reader can check
in the verified source instead of trusting, and the mainnet deploy proceeds on
the contract that will ship.

**Goal:** when token 1 finishes it is given Aorta and takes no place: `finishers`
does not move, its band is drawn in Aorta's red with no number, and the next
token home is still first.

**Architecture:** a three-line branch at the top of `_finish` in
`MachineReadableOnly.sol`. The renderer is NOT changed: it already draws a
finished token with an Aorta bit and ordinal 0 as a red band with no digits
(`DigitBand.sol:113` guards the digit row on `ordinal != 0`;
`Renderer.sol:248` takes the ink from the Mark bit). The Warden learns to
accept `Finished(1, 0, 11)`, `status` shows `finisher: { place: null, mark:
"aorta" }` for it, and the year rig stops giving token 1 a place. The copy
gains three things: the token 1 rule, the border-rule commitment, and the
same-night tie-break.

**Tech Stack:** Solidity 0.8.30 / Foundry 1.7.1; Node 24.14.1 (`node:test`);
viem.

**Spec:** `docs/specs/2026-09-20-mro-finisher-marks-design.md` sections 10l and
10m (what this amends); `warden/DEPLOY.md` sections 11 and 12 (the redeploy
order, and the Clock under its own user); the operator's rulings in memory
`operator-decisions-2026-10-08`.

## What cannot be undone

- **The Sepolia redeploy** supersedes the live pair. Its tokens stay where they
  are, forever; the test token's few days of history are left behind. Testnet
  only, free test ETH.
- **A new split seed.** The current one has published its keys on the old
  pair, so reusing it would hand anyone the new pair's early rules in advance.
  The old home copy is MOVED aside (renamed, not deleted).
- Nothing here touches mainnet or real funds.

## Global Constraints

- Plain ASCII in code, comments and docs. Lean comments: the why, not the what;
  no dates or history in `contracts/src` (`~/.claude/rules/code-comments.md`).
- All four suites green through `~/scripts/safe-build.sh` before every commit:
  `cd contracts && forge test`; `npm test` in `tools/`, `warden/`, `client/`.
  Never pipe a gate into anything.
- `export PATH=$HOME/.foundry/bin:$PATH`; `source ~/.nvm/nvm.sh`; `/bin/grep`.
- Work in a worktree on branch `plan-f`, NOT in the main checkout: the live
  Warden serves `warden/public/llms.txt` from the main checkout, so a copy edit
  there would publish before the address is adopted.
- The repository is PUBLIC: no absolute paths, session ids, real env values or
  AI attribution in tracked files or commits.
- Claude never reads `warden/.env`, `contracts/.env`, any split seed, or
  `~/.mro-test-wallet/wallet.key`.
- Every deploy script states its chain: `EXPECTED_CHAIN_ID=84532`.
- `anvil` always with `--prune-history`.
- The Warden re-create and anything run with `sudo` are the operator's, in one
  script he runs. Never `pm2 restart --update-env`.
- Never push without the operator's explicit approval at that moment.
- **Mainnet order is load-bearing:** the operator's own agent must be token id 1
  on mainnet. It already is by DEPLOY.md section 10 (the seed agent mints token
  #1 before the door opens); Task 12 restates it there.

## Review Focus

1. **A finished token 1 must not shift anyone's place.** Token 1 and token 2
   finishing in the same batch: token 2 is 1st and Apex. Pinned in Task 1.
2. **The house token finishing LATE** (after placed finishers exist): it still
   gets Aorta and ordinal 0, and the next placed finisher's number is unchanged.
   Pinned in Task 1.
3. **`Finished` with ordinal 0 for any token other than 1, or with a Mark other
   than Aorta:** the Clock still skips it as a lost argument. Pinned in Task 3.
4. **`status` for token 1 before and after it finishes:** `null`, then `{ place:
   null, mark: "aorta" }` -- never a place of 0, never null after finishing.
   Pinned in Task 3.
5. **The renderer drawing the house token's finished look identically in
   Solidity and JavaScript.** A cross-language matrix case. Pinned in Task 2.

---

### Task 0: The worktree

- [ ] `git -C ~/projects/machine-readable-only worktree add <scratchpad>/plan-f -b plan-f main`
- [ ] Symlink nothing into it except `node_modules`, the way Plan E's worktree did
  (`ln -s <main>/<d>/node_modules <worktree>/<d>/node_modules` for `warden`,
  `tools`, `client`); `contracts/lib` comes with the checkout.
- [ ] All four suites green in the worktree before any change. Record the counts.

---

### Task 1: The contract -- token 1 takes no place

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol` (`finishers` NatSpec at :112-114, constants near :136, `_finish` at :571-584)
- Test: `contracts/test/FinishLine.t.sol`
- Fix fallout in: `contracts/test/CheckIn.t.sol`, `contracts/test/Vouchers.t.sol`, `contracts/test/RealTokenGas.t.sol` and any other test that finishes token 1 and expects a place

**Interfaces:**
- Produces: `Finished(1, 0, 11)` when token 1 finishes; `marksOf(1)` has bit 11
  and bits 64-95 zero; `finishers()` unchanged by it; `upgradeOf(11).sold`
  counts it. Later tasks rely on exactly this event shape.

- [ ] **Step 1: Write the failing tests** in `FinishLine.t.sol`. Replace
  `test_theFirstFinisherIsApexAndNumberOne`, `test_sameBatchPlacesFollowBatchOrder`
  and `test_finishingEmitsFinished` (which all finish token 1 as a placed
  finisher) with:

```solidity
    function test_tokenOneFinishesWithAortaAndNoPlace() public {
        _makeWhole(1);
        uint256 m = t.marksOf(1);
        assertTrue(m & (1 << 11) != 0, "aorta bit");
        assertEq(uint32(m >> ORDINAL_SHIFT), 0, "no place");
        assertEq(t.finishers(), 0, "the count does not move");
        assertEq(t.upgradeOf(11).sold, 1);
        assertEq(t.upgradeOf(15).sold, 0, "apex is still free");
    }

    function test_theFirstPlacedFinisherIsApexAndNumberOne() public {
        _mintMore(1);
        _makeWhole(2);
        uint256 m = t.marksOf(2);
        assertTrue(m & (1 << 15) != 0, "apex bit");
        assertEq(uint32(m >> ORDINAL_SHIFT), 1, "place 1");
        assertEq(t.finishers(), 1);
        assertEq(t.upgradeOf(15).sold, 1);
    }

    /// @dev Token 1 first in the batch must not take the first place.
    function test_tokenOneInTheSameBatchDoesNotShiftAPlace() public {
        _mintMore(2);
        _growTo(1, 364);
        _growTo(2, 364);
        _growTo(3, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        uint32[] memory ids = new uint32[](3);
        ids[0] = 1; ids[1] = 2; ids[2] = 3;
        uint32[] memory ds = new uint32[](3);
        ds[0] = d; ds[1] = d; ds[2] = d;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds, _noBits(ds), _silent(ds));
        assertEq(uint32(t.marksOf(1) >> ORDINAL_SHIFT), 0);
        assertEq(uint32(t.marksOf(2) >> ORDINAL_SHIFT), 1);
        assertEq(uint32(t.marksOf(3) >> ORDINAL_SHIFT), 2);
        assertTrue(t.marksOf(2) & (1 << 15) != 0, "first place is apex");
        assertTrue(t.marksOf(3) & (1 << 14) != 0, "second place is atrium");
    }

    /// @dev Finishing after placed finishers exist changes nothing either.
    function test_tokenOneFinishingLateTakesNoPlace() public {
        _mintMore(2);
        _growTo(1, 364);
        _makeWhole(2);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), _noBits(_days(d)), _silent(_days(d)));
        assertEq(uint32(t.marksOf(1) >> ORDINAL_SHIFT), 0);
        assertEq(t.finishers(), 1);
        _makeWhole(3);
        assertEq(uint32(t.marksOf(3) >> ORDINAL_SHIFT), 2, "the next place is unchanged");
    }

    function test_tokenOneEmitsFinishedWithPlaceZero() public {
        _growTo(1, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Finished(1, 0, 11);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), _noBits(_days(d)), _silent(_days(d)));
    }

    function test_aPlacedFinisherEmitsFinished() public {
        _mintMore(1);
        _growTo(2, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Finished(2, 1, 15);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(2), _days(d), _noBits(_days(d)), _silent(_days(d)));
    }
```

  If `_makeWhole` or `_growTo` cannot drive two tokens in sequence (they warp
  the clock), use `_growTo(id, 364)` for each token first and finish them with
  one `batchCheckIn` per day, as `test_tokenOneInTheSameBatchDoesNotShiftAPlace`
  does. Read `MroTestBase.sol` before writing; do not change the helpers'
  day arithmetic (the seed-budget tests depend on `_makeWhole` advancing exactly
  364 days).

- [ ] **Step 2: Run, expect FAIL.**
  `cd contracts && forge test --match-path test/FinishLine.t.sol -vv` -- the
  token 1 tests fail (token 1 currently takes place 1 and Apex).

- [ ] **Step 3: Implement.** In `MachineReadableOnly.sol`, beside
  `FIRST_FINISHER_MARK`:

```solidity
    /// @dev The project's own agent. It never takes a finishing place.
    uint256 internal constant HOUSE_TOKEN = 1;
    /// @dev The uncapped finisher Mark, which the house token is given.
    uint8 internal constant AORTA = 11;
```

  At the top of `_finish`:

```solidity
        // The house token is given Aorta and leaves `finishers` alone, so the
        // next token home still takes the first place.
        if (id == HOUSE_TOKEN) {
            _marks[id] |= uint256(1) << AORTA;
            unchecked { _upgrades[AORTA].sold += 1; }
            emit Finished(id, 0, AORTA);
            return;
        }
```

  Update the `finishers` NatSpec to: "How many tokens have taken a finishing
  place. Token 1 never does. The next finisher's place is this plus one." Update
  the `_finish` NatSpec's first line to say token 1 is given Aorta and no place.
  Keep `finisherMark` untouched.

- [ ] **Step 4: Run, expect PASS** for `FinishLine.t.sol`.

- [ ] **Step 5: The whole contract suite.** `~/scripts/safe-build.sh forge test`.
  Every failure whose cause is "token 1 finished and the test expected a place"
  is fixed by finishing a token with id 2 or above instead, or by asserting the
  house result (Aorta, ordinal 0). Known: `CheckIn.t.sol:219-253` and
  `:377-451` (175 finishers 1st to 175th -- mint the batch from id 2, keep 175
  placed finishers); `Vouchers.t.sol:173-182`; `RealTokenGas.t.sol` (the worst
  case must stay a PLACED finisher: build it at id 2 or above). **The pinned
  worst-case figures in `WorstCase.sol` must come out identical.** A failure of
  any other shape, or a moved gas/byte pin, STOPS the task: report it.

- [ ] **Step 6: Size gates.**
  `~/scripts/safe-build.sh forge build --sizes` -- both contracts positive
  margin; record `MachineReadableOnly`'s runtime bytes and margin. Then
  `bash script/anvil-size-check.sh` -- non-empty code for both and a real
  `tokenURI`; then `du -sh ~/.foundry/anvil/tmp` stays small.

- [ ] **Step 7: Commit.**

```bash
git add contracts/src/MachineReadableOnly.sol contracts/test
git commit -m "feat(contract): token 1 is given Aorta and takes no finishing place"
```

---

### Task 2: The house token's finished look, pinned in both renderers

The renderer does not change. This task proves it draws the house state the
same way in Solidity and JavaScript, and corrects the comments that call that
state unreachable.

**Files:**
- Modify: `tools/state-matrix.mjs` (the finisher block near :174-200)
- Regenerate: `contracts/test/RenderFixture.sol` (`node tools/render-fixture.mjs 1 example.com`)
- Modify comments: `contracts/test/DigitBandRender.t.sol:202-204`, `contracts/test/MarkRenderer.t.sol:248-250`, `tools/render-token.mjs:385-386`, `tools/state-matrix.mjs:179-183`
- Test: `contracts/test/RenderMatrix.t.sol` (runs the regenerated fixture), `contracts/test/DigitBandRender.t.sol`

**Interfaces:**
- Consumes: Task 1's state: bit 11 set, bits 64-95 zero, level 365.

- [ ] **Step 1: Add the matrix case** after the `for (const ordinal of ...)` loop:

```js
  // The house token, finished: Aorta's ink and no place, so no number.
  out.push({ label: "token 1 finished, no place", ...base, ordinal: 0, marks: [finisherMark(65)] });
```

  (`finisherMark(65)` is 11, Aorta, read from the same table as the rows above.)

- [ ] **Step 2: Add a Solidity render test** in `DigitBandRender.t.sol`, beside
  `test_anOrdinalWithNoFinisherMarkKeepsTheNearBlack`, using that file's own
  helpers to build a level-365 view with `marks = 1 << 11` and ordinal 0:
  assert the SVG contains `#c8102e` (Aorta red) and that the band's top three
  module rows are empty -- compare the band path to
  `DigitBand.path(0, answers, 365, canvas, fill)`, the same call the renderer
  makes. Name it `test_theHouseTokenDrawsARedBandWithNoNumber`.

- [ ] **Step 3: Run, expect PASS for the Solidity test** (the renderer already
  does this), and expect `RenderMatrix.t.sol` to FAIL until the fixture is
  regenerated.

- [ ] **Step 4: Regenerate and run.** `node tools/render-fixture.mjs 1 example.com`,
  then `cd contracts && forge test --match-path test/RenderMatrix.t.sol` -- PASS.
  `cd tools && npm test` -- PASS. If the two languages disagree on the new case,
  the JS mirror is wrong: fix `tools/render-token.mjs` to take the band ink from
  the Mark bit regardless of the ordinal (as `Renderer.sol:248` does), never the
  Solidity.

- [ ] **Step 5: Correct the four comments** that say a finisher Mark with no
  ordinal "cannot exist on chain": it now exists for exactly one token. One line
  each, e.g. "Only token 1 holds a finisher Mark with no place."

- [ ] **Step 6: Commit.**

```bash
git add tools/state-matrix.mjs tools/render-token.mjs contracts/test/RenderFixture.sol contracts/test/DigitBandRender.t.sol contracts/test/MarkRenderer.t.sol
git commit -m "test(render): pin the house token's finished look in both renderers"
```

---

### Task 3: The Warden reads token 1's finish

**Files:**
- Modify: `warden/src/clock/reconcile.mjs:286-316` (the `Finished` case)
- Modify: `warden/src/mcp/tokenView.mjs:44-53` (the `finisher` field)
- Test: `warden/test/clock-reconcile.test.mjs` (near :284-338), `warden/test/status.test.mjs` (near :184-249)

**Interfaces:**
- Consumes: `Finished(1, 0, 11)` from Task 1.
- Produces: `q.setFinished(1, 0, 11)` (place column stays 0, Aorta bit ORed in);
  `tokenView(...).finisher` is `{ place: null, mark: "aorta" }` for it.

- [ ] **Step 1: Failing tests.** In `clock-reconcile.test.mjs`, beside the
  "no usable ordinal" test (keep that one exactly as it is: `ordinal 0, markId
  15` on token 1 must STILL be skipped):

```js
// Token 1 is the house token: the contract gives it Aorta and no place.
test("token 1's Finished with no place records Aorta and no place", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [chainEvent("Finished", { id: 1n, ordinal: 0, markId: 11 })], { log: () => {} });
  assert.equal(applied.Finished, 1);
  assert.equal(q.getToken(1).finisher, 0);
  assert.notEqual(BigInt(q.getToken(1).marks) & (1n << 11n), 0n);
});

test("a Finished with no place is still skipped for any other token", () => {
  const { q } = mirrorWithToken(2);
  const applied = applyEvents(q, [chainEvent("Finished", { id: 2n, ordinal: 0, markId: 11 })], { log: () => {} });
  assert.equal(applied.Finished, 0);
  assert.equal(applied.skipped, 1);
});
```

  (`mirrorWithToken` takes no id today: give it an optional `tokenId = 1`
  parameter, defaulting so every existing call is unchanged. Use the helpers
  exactly as the surrounding tests do; read them first.)

  In `status.test.mjs`, beside "a token that has not finished carries finisher:
  null": a token 1 at level 365 with `setFinished(1, 0, 11)` has `finisher`
  deep-equal to `{ place: null, mark: "aorta" }`, and `whole: true`.

- [ ] **Step 2: Run, expect FAIL.** `cd warden && node --test test/clock-reconcile.test.mjs test/status.test.mjs`.

- [ ] **Step 3: Implement.** In `reconcile.mjs`, import nothing new; add beside
  `MIN_FINISHER_MARK_ID`:

```js
/// The contract's HOUSE_TOKEN: finishes with Aorta and no place.
const HOUSE_TOKEN = 1;
const AORTA = 11;
```

  and change the validation so ordinal 0 passes ONLY for that pair:

```js
        const house = tokenId === HOUSE_TOKEN && ordinal === 0 && markId === AORTA;
        if (
          !Number.isInteger(ordinal) || (ordinal < 1 && !house) ||
          !Number.isInteger(markId) || markId < MIN_FINISHER_MARK_ID || markId > MAX_MARK_ID
        ) {
```

  and the log line: `house ? "finished its year with Aorta and no place" :
  \`finished its year in place ${ordinal}, mark ${markId}\``. Update the
  comment "Places start at 1 -- the contract's `ordinal = ++finishers` cannot
  hand out a 0" to name the one exception. Confirm `tokenId` is a Number at
  that point (read how the case gets it); compare like with like.

  In `tokenView.mjs`, key the field on the finisher Mark, not on the place:

```js
    finisher: t.marks & FINISHER_MASK
      ? { place: t.finisher || null, mark: markNameIn(t.marks & FINISHER_MASK, LADDER) }
      : null,
```

  Check `t.marks` is a Number or BigInt and that `FINISHER_MASK` is the same
  type (read `mcp/ladder.mjs:60` and how `tokenView` already masks); match the
  existing expression's types exactly.

- [ ] **Step 4: Run, expect PASS**, then `cd warden && ~/scripts/safe-build.sh npm test`.

- [ ] **Step 5: Commit.**

```bash
git add warden/src/clock/reconcile.mjs warden/src/mcp/tokenView.mjs warden/test/clock-reconcile.test.mjs warden/test/status.test.mjs
git commit -m "feat(warden): token 1 finishes with Aorta and no place"
```

---

### Task 4: The year rig stops placing token 1

**Files:**
- Modify: `warden/tools/year/tally.mjs:43-51` (`places`)
- Check: `warden/tools/year/checker.mjs:114-151, 177-181`, `warden/tools/year/report.mjs:163-169`
- Test: the `warden/test/year-*.test.mjs` file that covers `places` (find it with `/bin/grep -ln "places(" warden/test`)

- [ ] **Step 1: Failing test:** `places([{tokenId: 1, day: 10}, {tokenId: 2, day: 10}, {tokenId: 3, day: 11}])`
  gives token 1 `{ place: 0, markId: 11 }`, token 2 `{ place: 1, markId: 15 }`,
  token 3 `{ place: 2, markId: 14 }`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
/// The contract's HOUSE_TOKEN: given Aorta, never a place.
export const HOUSE_TOKEN = 1;

export function places(finishes) {
  const order = [...finishes].sort((a, b) => a.day - b.day || a.tokenId - b.tokenId);
  const out = new Map();
  let place = 0;
  for (const f of order) {
    if (f.tokenId === HOUSE_TOKEN) out.set(f.tokenId, { place: 0, markId: 11 });
    else { place += 1; out.set(f.tokenId, { place, markId: finisherMark(place) }); }
  }
  return out;
}
```

  Read `checker.mjs` where it compares `chain.finisherPlace` and the mirror's
  place to the expected place: with the expected place 0 for token 1 the
  comparisons already hold (the chain and the mirror both read 0). `report.mjs`
  already filters `p > 0`. Change neither unless a test shows a mismatch.

- [ ] **Step 4: Run, expect PASS;** the warden suite.

- [ ] **Step 5: Commit.**

```bash
git add warden/tools/year/tally.mjs warden/test
git commit -m "test(year): the rig gives token 1 Aorta and no place"
```

---

### Task 5: The copy

**Files:**
- Modify: `skills/machine-readable-only/SKILL.md`, `warden/public/llms.txt`,
  `docs/2026-09-01-mro-raw-protocol.md`; copy the protocol to
  `skills/machine-readable-only/references/raw-protocol.md` (a test requires them
  byte-identical); re-render `docs/2026-09-01-mro-raw-protocol.html` with
  `node ~/scripts/render-md-to-html.js docs/2026-09-01-mro-raw-protocol.md` (ONE argument)
- Test: `tools/test/skill-doc.test.mjs` (the cross-surface block near :176-186)

Three additions, the same words on all three surfaces (`SKILL.md`, `llms.txt`,
the protocol), reflowed to each file's line width:

**A. The token 1 paragraph.** In `llms.txt` it REPLACES the paragraph at
:352-358 ("Token 1 is the operator's own agent ... `beat --not-before` ...").
In `SKILL.md` it goes after the finisher paragraph ending "`ladder` reports the
bands and how much of each is gone."

> Token 1 is the project's own agent, minted before the door opens, and the
> contract keeps it out of the race: when token 1 finishes it is given Aorta
> and takes no place, so the next token home is still first. Its band is drawn
> in Aorta's red with no number, and its `Finisher` trait reads 0. It never
> answers the daily question, so every day it is credited is silent.

**B. The tie-break,** appended to the finisher paragraph (SKILL.md, after "and
nothing already held can be taken away."; llms.txt and the protocol at the
matching place):

> Tokens that finish on the same night are placed lowest token id first.

**C. The border commitment**, in the border paragraph on every surface, between
"The next night the rule for that day is published on chain" and the
`verify-border` sentence:

> The whole year's rules were fixed before the door opened: the contract holds
> a commitment to all of them, set once and never changeable, and refuses any
> night's rule that does not match it, so no rule can be chosen after the
> answers are in.

**D. The `finisher` field**, where each surface describes it (SKILL.md:204-206,
protocol:600-606): add "Token 1's reads `{ "place": null, "mark": "aorta" }`."

- [ ] **Step 1: Failing test.** In `skill-doc.test.mjs`'s cross-surface loop add:

```js
    assert.match(flat, /The whole year's rules were fixed before the door opened/, `${name}: the commitment`);
    assert.match(flat, /when token 1 finishes it is given Aorta and takes no place/, `${name}: token 1`);
    assert.match(flat, /Tokens that finish on the same night are placed lowest token id first\./, `${name}: the tie-break`);
    assert.doesNotMatch(flat, /beat --not-before/, `${name}: the old client-side promise is gone`);
```

- [ ] **Step 2: Run, expect FAIL.** `cd tools && node --test test/skill-doc.test.mjs`.
- [ ] **Step 3: Edit the three surfaces**, copy the protocol into the skill, re-render the HTML.
- [ ] **Step 4: Run, expect PASS;** then `tools`, `warden` and `client` suites
  (the client suite runs against a Warden built from `warden/src`, and
  `warden/test/ladder-tool.test.mjs:513-606` pins published field sets).
- [ ] **Step 5: Commit.**

```bash
git add skills warden/public/llms.txt docs/2026-09-01-mro-raw-protocol.md docs/2026-09-01-mro-raw-protocol.html tools/test/skill-doc.test.mjs
git commit -m "docs(copy): token 1 is outside the count; the border rules are committed; same-night ties"
```

`client/src/notBefore.mjs` and the seed agent's `--not-before` stay as they
are: they still keep token 1 from leading early, they are simply no longer the
fairness guarantee and the copy no longer leans on them.

---

### Task 6: Cold-read the finished copy

Method: memory `test-copy-on-cold-agents`. Three `Explore` agents, fixture =
the Task 5 `SKILL.md` copied into the session scratchpad, the same prompt as the
2026-10-08 rounds (operator fetched it from the site; read only this file; ignore
PENDING values; end with one `FAIRNESS:` line).

- [ ] **Pass:** no reader names token 1, the border rule, or the same-night
  order as a fairness concern. Record each reader's `FAIRNESS:` line in the ledger.
- [ ] **Fail:** STOP and report the readers' words to the operator. Do not
  rewrite and re-test in a loop without him: agent-facing meaning changes are
  his (memory `agent-facing-copy-locked`).

---

### Task 7: The gates, and a fresh reviewer

- [ ] The four suites through `safe-build.sh`.
- [ ] `forge build --sizes` and `anvil-size-check.sh` again on the final tree.
- [ ] The mainnet fork rehearsal, from the worktree with group `mro`:
  `REHEARSE_REPO=<main checkout> sg mro -c "$HOME/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh"` -- 30 PASS, 0 FAIL.
- [ ] `node tools/prepublish-check.mjs` and `node ~/scripts/id-scan.mjs` -- clean.
- [ ] `git log main..plan-f --format=%B | /bin/grep -iE "co-authored|anthropic|claude"` -- no output (read it; its exit status is not a gate).
- [ ] A fresh whole-branch reviewer on the most capable model, given this plan
  and `git diff main..plan-f`. Fix every Critical and Important finding in a
  commit on `plan-f`; record deferred minors in memory `deferred-review-items`.

---

### Task 8: A new Sepolia split seed -- one operator-approved move

- [ ] Covered by approving this plan: rename the current home seed out of the
  way: `mv ~/.mro-split/seed ~/.mro-split/seed.retired-a3` (a rename; nothing is
  deleted; the installed copy in `/etc/mro-clock` is untouched until Task 11).
- [ ] `node warden/tools/split-seed.mjs new ~/.mro-split/seed` -- prints ONLY
  `anchor 0x...`. Record the anchor (public) in the ledger. `stat -c %a ~/.mro-split/seed` is `600`.

---

### Task 9: Deploy on Base Sepolia

Run from the worktree. Testnet funds only.

- [ ] `bash contracts/script/deployer-balance.sh` -- enough testnet ETH. Stop if short and tell the operator.
- [ ] `bash contracts/script/deploy-plan7.sh` -- the simulation prints chain 84532, the warden `0xb919443Ecb8B73a6179a523734f2184d26fF4D7A`, the anchor from Task 8, and two addresses.
- [ ] `bash contracts/script/deploy-plan7.sh --broadcast` -- record renderer, token and deploy block (`contracts/broadcast/DeployPlan5.s.sol/84532/run-latest.json`).
- [ ] `bash contracts/script/verify-plan7.sh <renderer> <token> 0xb919443Ecb8B73a6179a523734f2184d26fF4D7A 84532` -- Basescan AND Blockscout.
- [ ] `cd warden && node tools/check-deployed-abi.mjs <token>` (exit 0) and `node tools/read-ladder.mjs <token>` (all records match).
- [ ] `cast call <token> "splitAnchor()(bytes32)" --rpc-url https://sepolia.base.org` equals the Task 8 anchor.
- [ ] The Sepolia pair stays owned by the deployer. The Safe handover was drilled
  in Plan E Phase 2 and is rehearsed on every fork run (Task 7); repeating it on
  Sepolia is the operator's option, not a step.

---

### Task 10: Adopt and rehearse

- [ ] `bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>`.
- [ ] `REHEARSE_OVERRIDE="MRO_CONTRACT_ADDRESS=<token>" sg mro -c "bash warden/tools/rehearse-start.sh"` -- `decoder verified against <token>` and the split anchor check passes.
- [ ] The four suites; `node tools/prepublish-check.mjs`; `git status` shows nothing outside `contracts/ warden/ docs/ skills/ CLAUDE.md`; commit:

```bash
git add -A contracts/ warden/ docs/ skills/ CLAUDE.md
git commit -m "chore: adopt the Plan F pair on Base Sepolia"
```

- [ ] `git checkout main && git merge --ff-only plan-f` in the MAIN checkout
  (main has not moved since `f230b11`; if it has, STOP and report). From here
  the live Warden must not restart until Task 11: its preflight would still
  pass, but it would serve copy naming a contract it does not use.

---

### Task 11: The switchover -- the OPERATOR runs one script

Between 00:30 and 23:45 UTC. Claude writes `<scratchpad>/plan-f-switchover.sh`
and hands over ONE line: `! bash <scratchpad>/plan-f-switchover.sh <token>`.
The script stops at the first failure and prints no secret:

1. `pm2 stop mro-warden`.
2. `bash warden/deploy/set-contract-address.sh <token>`.
3. `sg mro -c "node warden/tools/mirror-snapshot.mjs ~/backups/state.db.pre-plan-f.$(date -u +%Y%m%dT%H%M%SZ)"` -- the mirror is `/var/lib/mro/state.db` since the cutover; the tool reads `STATE_DB_PATH`, check that first.
4. `sg mro -c "node warden/tools/mirror-reset-chain.mjs /var/lib/mro/state.db --yes"`.
5. `pm2 delete mro-warden && pm2 start warden/ecosystem.config.cjs && pm2 save`.
6. `sudo bash warden/deploy/install-clock-user.sh --replace-seed` -- copies the new address into the Clock's env and the new seed to `/etc/mro-clock`; the Clock's key stays the installed one. Ends with PASS.
7. Wait 10 s; `pm2 describe mro-warden` online; probe the public site: `/llms.txt` contains `<token>` and `when token 1 finishes it is given Aorta`; print `LIVE OK` or `NOT LIVE -- tell Claude`.

Claude then confirms from outside through Cloudflare, and reads the Warden's
boot lines (`decoder verified`).

---

### Task 12: Push, prove, record

- [ ] **Ask the operator before pushing.** On a yes: `git push origin main` (the pre-push hook runs both guards).
- [ ] Mint the Sepolia test token through the real paid path, as in Plan A3
  Task 9 (`~/.mro-test-wallet/mro-agent.sh join ... --expect-payto 0x000000000000000000000000000000000000dEaD --expect-amount 1000000`). It will be token 1, the house token, on this pair.
- [ ] Night 1: `sg mro -c "tail -20 /var/log/mro/clock.log"` -- reveal sent, mint written, builder code, nothing FAILED.
- [ ] Night 2: `node client/src/cli.mjs verify-border 1 --contract <token> --rpc https://sepolia.base.org` -- every square ok, exit 0.
- [ ] DEPLOY.md section 10: one line stating the operator's agent must be token id 1 on mainnet, because the contract's `HOUSE_TOKEN` is the id, not the owner.
- [ ] Memory: `resume-checklist`, `build-status`, `warden-deployed`, `operator-decisions-2026-10-08` (built), `deferred-review-items`.
- [ ] Ask the operator whether to remove the worktree and the `plan-f` branch (deletions).

## Self-review

- Spec coverage: the contract rule (Task 1), the look (Task 2), the Warden's
  reading of it (Task 3), the rig (Task 4), all three copy decisions plus the
  `finisher` field (Task 5), the copy proven on readers (Task 6), and the
  redeploy (Tasks 8-12).
- Names used across tasks: `HOUSE_TOKEN = 1` and `AORTA = 11` in the contract,
  the reconcile module and the rig; `Finished(1, 0, 11)` everywhere.
- Review Focus lines 1-2 are pinned in Task 1, 3-4 in Task 3, 5 in Task 2.
