# Plan A2: the daily question on chain

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately. Operator-only steps in this plan: approving it (which approves
> the design choices and the agent-facing wording below). Nothing in A2 is
> pushed, deployed or re-created: the work continues on branch `plan-a` until
> Plan A3 deploys it.

**Goal:** Each credited day carries one answer bit on chain, drawn as a square
on three edges of the border; the bit comes from a secret split fixed before
the piece opened and revealed the next night, and anyone can check every
square with `mro-agent verify-border`.

**Why:** Plan B (live since 2026-10-02) asks every agent a daily question and
records its answer in the Warden's mirror, but nothing reaches the artwork yet.
The answers need storage in the token contract, and that contract is
redeployed once more before mainnet (Plan A3); after token 1 exists it can
never change. This is the last chance to put the year's 365 decisions into the
token. It unblocks Plan A3 (gates and the Sepolia redeploy), which carries A1
and A2 together.

| Plan | What | Deploys? |
|---|---|---|
| A1 (built, `plan-a`) | Rulings 2 and 3, four small fixes, the Warden and Clock follow | No |
| **A2 (this)** | The daily question on chain: answer bits, the split key chain, the three answer edges, the Clock's split, `verify-border` | No |
| A3 | Size and gas gates over both, the Base Sepolia redeploy, `adopt-deployment.sh`, `setSplitAnchor`, re-pointing the test agent | Yes, Sepolia |

**What approving this plan also approves.** Each is a choice the approved
spec does not make, or makes differently, named so it is made out loud:

1. **Keys are revealed by their own call, not inside `batchCheckIn`.**
   `revealSplitKeys(bytes32[] keys, bytes questions)`, sent once at the start
   of any Clock run that has something to write, reveals every key through
   yesterday. The spec put the keys in the batch. A separate call means a
   chunk that is halved or bisected never carries keys twice, and mints and
   seeds (sent before the batch) are covered by the same reveal. The contract
   still checks every key against the chain, and also refuses to reveal a key
   for a day that is not over yet (`SplitKeyTooEarly`), so today's split can
   never leak.
2. **The mint day's square is always a coin flip.** The `question` tool
   refuses on the mint day (the day is already credited), so no agent can ever
   answer it. `mint` and `seed` take a final `bool firstAnswer`, which the Clock
   sets to the day's silent coin flip for that token. The agent-facing copy
   says so.
3. **The questions ride in the reveal's event, and the chain keeps a pointer
   to the last reveal.** `SplitKeysRevealed(firstIndex, keys, prevRevealBlock,
   questions)` and `lastRevealBlock()` let `verify-border` walk back night by
   night with one small log query each. A public RPC serves only 1,000 blocks
   per log query, so scanning a year of Base blocks (about 15.8 million) any
   other way would take tens of thousands of calls.
4. **A credit written through the voucher path draws an empty square.** The
   voucher path exists for after the Warden is gone, when no split exists. The
   verifier reports those days as voucher days.
5. **The anchor is guarded in code, not only in the runbook.** The Warden
   refuses to start against a contract with no split anchor, so no paid mint
   can happen before the anchor exists; and the Clock refuses to write anything
   if its split seed does not hash to the anchor on chain.
6. **The agent-facing wording in Task 9**, which tells agents that answers
   become the border, that the rule is secret on the day and published the
   next night, that the mint day is a coin flip, and how to run the verifier.
   It never states the rule's secret.

**Architecture:** The token contract gains `mapping(uint256 => uint256[2])
_answers` (credit `level` writes bit `level - 1`), a split anchor set once by
the owner, and `revealSplitKeys`, which walks the key chain forward. The
renderer reads the two answer words through `TokenView` and draws them with
`DigitBand`, now a band that appears at 122 credited days with the place on top
only. The split rule lives in two small modules, one in the Clock and one in
the MIT client, pinned to the same literal test vectors.

**Tech Stack:** Solidity 0.8.30 / Foundry 1.7.1 (via_ir), Node 24.14.1,
`node:test`, viem.

**Spec:** `docs/specs/2026-10-02-mro-daily-question-design.md` (APPROVED
2026-10-02), sections 3, 5, 7, 8, 10 and 11; `docs/plans/2026-09-30-mro-rulings-roadmap.md`
row A (**Q**); `.claude/rules/rendering.md` for the band's limits.

## Global Constraints

- Plain ASCII only in code, comments and docs.
- All four suites green before every commit: `cd contracts && forge test`, and
  `npm test` in `tools/`, `warden/`, `client/`, all through
  `~/scripts/safe-build.sh`. Never pipe a gate into anything.
- Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`. Use `/bin/grep`, never bare `grep`.
- The repository is PUBLIC: no absolute paths, key ids, real env values or AI
  attribution in files or commit messages. **The split seed, the question bank
  and any question text never enter the repository, a log or an error.**
- Comments follow `~/.claude/rules/code-comments.md`; in `contracts/src`, one
  short NatSpec line per item, no history.
- Files with a `// GENERATED by tools/<script>` header are changed in their
  generator and re-generated. `warden/src/clock/abi.mjs` is regenerated with
  `cd warden && node tools/gen-abi.mjs` after `forge build`, in every task that
  changes the ABI.
- `vm.expectRevert` matches the NEXT call: compute every argument first.
- Every new owner function and every new revert gets a test.
- **The band is never deepened.** `DigitBand.MIN_BAND` stays three modules.
- Stay on branch `plan-a`. Do NOT merge to `main`.
- The split chain is `CHAIN_LENGTH = 36_500` keys: `k[36500]` is the seed,
  `k[i] = keccak256(k[i+1])` over the 32 raw bytes, `k[0]` is the anchor. Key
  `n` (n >= 1) belongs to UTC day `splitAnchorDay + n - 1`.
- The split rule (identical in both modules):
  `h(i) = keccak256(abi.encodePacked(bytes32 key, "split", uint256 i))`; rank
  the indices `0..n-1` by `(h, i)` ascending; the first `floor(n / 2)` give 1.
  Silent: `uint256(keccak256(abi.encodePacked(bytes32 key, "silent", uint256 tokenId))) & 1`.
- The batch's `record` holds one byte per entry, in entry order: the answer
  index (0..100), or `0xff` for silent.

## Review Focus

1. **A reveal that skips, repeats or reorders a key, or reveals today's key:**
   refused (`BadSplitKey(index)`, `SplitKeyTooEarly(index)`), nothing stored.
   Pinned in Task 2.
2. **A token at exactly 121, 122, 243, 244, 364 and 365 credited days:** no
   band, one side, one side, two sides, two sides, three sides and the place.
   Pinned in Tasks 3 and 4, in both languages.
3. **A chunk that is halved or bisected:** every entry keeps its own bit and
   its own answer byte, whatever order the retry sends them in. Pinned in
   Task 6.
4. **A credit whose recorded question is missing from the bank:** the Clock
   writes nothing that night rather than guessing a bit. Pinned in Task 6.
5. **`verify-border` against a deliberately wrong bit, and against a credit it
   cannot find:** it fails, naming the square, rather than passing. Pinned in
   Task 8.

---

### Task 1: Answer bits in the contract

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol` (`_answers`, `answersOf`, `mint`, `seed`, `batchCheckIn`, `viewOf`)
- Modify: `contracts/src/render/TokenView.sol` (`answers`)
- Modify: `contracts/test/MroTestBase.sol` (`_noBits`, `_silent`, and the helpers that call `mint`, `seed`, `batchCheckIn`)
- Create: `contracts/test/AnswerBits.t.sol`
- Modify: every `mint(`, `seed(` and `batchCheckIn(` call in `contracts/test` and `contracts/script`, and `contracts/test/TokenView.t.sol`

**Interfaces:**
- Produces: `batchCheckIn(bytes packedIds, uint32[] days, bytes answerBits, bytes record)`;
  `mint(uint256 tokenId, address to, bytes32 keyId, bytes code, uint32 day, bool firstAnswer)`;
  `seed(uint256 childId, uint256 parentId, address to, bytes code, uint32 day, bytes32 expectedKeyId, bool firstAnswer)`;
  `answersOf(uint256) returns (uint256[2])`; `TokenView.answers` (`uint256[2]`, directly after `marks`);
  test helpers `_noBits(uint32[] memory days)` and `_silent(uint32[] memory days)`, both `returns (bytes memory)`.

- [ ] **Step 1: Write the failing tests**

`contracts/test/AnswerBits.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice One answer bit per credit: credit `level` is bit `level - 1`.
contract AnswerBitsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    function _bitOf(uint256 id, uint256 i) internal view returns (uint256) {
        uint256[2] memory a = t.answersOf(id);
        return (a[i >> 8] >> (i & 255)) & 1;
    }

    function test_aOneBitIsWrittenAtItsCredit() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"01");
        assertEq(_bitOf(1, 1), 1, "credit 2 is bit 1");
        assertEq(_bitOf(1, 0), 0, "the mint's bit was 0");
    }

    function test_aZeroBitWritesNothing() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"00", hex"ff");
        uint256[2] memory a = t.answersOf(1);
        assertEq(a[0], 0);
        assertEq(a[1], 0);
    }

    function test_bitsFollowEntryOrderAcrossTokens() public {
        vm.prank(WARDEN);
        t.mint(2, address(0x2222), bytes32(uint256(2)), _code(), _today(), true);
        uint32 d = _today() + 1;
        _warpToDay(d);
        uint32[] memory ids = new uint32[](2);
        uint32[] memory ds = new uint32[](2);
        ids[0] = 1; ids[1] = 2; ds[0] = d; ds[1] = d;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds, hex"40", hex"0001");
        assertEq(_bitOf(1, 1), 0, "entry 0 carried a 0");
        assertEq(_bitOf(2, 1), 1, "entry 1 carried a 1");
        assertEq(_bitOf(2, 0), 1, "token 2's mint carried a 1");
    }

    function test_theLastCreditWritesBit364() public {
        _growTo(1, 364);
        uint32 d = t.viewOf(1).lastDay + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"00");
        assertEq(_bitOf(1, 364), 1);
    }

    function test_answerBitsOfTheWrongLengthAreRefused() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_one(1), _days(d), hex"", hex"00");
    }

    function test_aRecordOfTheWrongLengthIsRefused() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_one(1), _days(d), hex"00", hex"");
    }

    function test_viewOfCarriesTheAnswers() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"01");
        assertEq(t.viewOf(1).answers[0], 2);
    }

    function test_aSeededChildCarriesItsFirstAnswer() public {
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        uint32 day = _today();
        bytes memory code = _code();
        vm.prank(WARDEN);
        t.seed(901, 1, ALICE, code, day, KEY, true);
        assertEq(_bitOf(901, 0), 1);
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd contracts && forge test --match-path test/AnswerBits.t.sol -vv`
Expected: compile FAIL (`answersOf`, the four-argument `batchCheckIn`, `mint`'s sixth argument).

- [ ] **Step 3: Implement**

`TokenView.sol`, directly after `uint256 marks;`:

```solidity
    uint256[2] answers;  // one bit per credit: credit `level` is bit `level - 1`
```

`MachineReadableOnly.sol`, beside `_restDay`:

```solidity
    /// @dev One answer bit per credit, 365 in two words: credit `level` is bit `level - 1`.
    mapping(uint256 => uint256[2]) internal _answers;
```

```solidity
    /// @notice The token's answer bits: credit `level` is bit `level - 1`.
    function answersOf(uint256 id) external view returns (uint256[2] memory) {
        return _answers[id];
    }

    /// @dev Set the bit for credit `level`. A 0 writes nothing.
    function _setAnswer(uint256 id, uint32 level) private {
        uint256 i = uint256(level) - 1;
        _answers[id][i >> 8] |= uint256(1) << (i & 255);
    }
```

`viewOf`: `v.answers = _answers[id];` after `v.marks = _marks[id];`.

`mint` and `seed` gain `bool firstAnswer` as their LAST parameter, with
`@param firstAnswer The first day's answer bit: the Clock's coin flip, since the mint day cannot be answered.`,
and after the token's record is written: `if (firstAnswer) _setAnswer(id, 1);`
(`childId` in `seed`).

`batchCheckIn(bytes calldata packedIds, uint32[] calldata days_, bytes calldata answerBits, bytes calldata record)`,
with a `@param` for each new argument ("one bit per entry, high bit first";
"one byte per entry, the answer index or 0xff, never read here: it is the
public record the verifier reads"). After the existing length checks:

```solidity
        if (answerBits.length != (n + 7) / 8 || record.length != n) revert LengthMismatch();
```

and in the loop, right after `_credit(id, s, day);`:

```solidity
            if ((uint8(answerBits[i >> 3]) >> (7 - (i & 7))) & 1 == 1) _setAnswer(id, s.level);
```

`checkInWithVoucher` writes no bit (the voucher path has no split).

- [ ] **Step 4: Repair every caller**

`MroTestBase.sol` gains:

```solidity
    /// @dev Zero answer bits for a batch of `days.length`.
    function _noBits(uint32[] memory days) internal pure returns (bytes memory) {
        return new bytes((days.length + 7) / 8);
    }

    /// @dev An all-silent record for a batch of `days.length`.
    function _silent(uint32[] memory days) internal pure returns (bytes memory r) {
        r = new bytes(days.length);
        for (uint256 i; i < r.length; ++i) r[i] = 0xff;
    }
```

Then, mechanically, in `contracts/test` and `contracts/script`:
- every `batchCheckIn(A, B)` call (on `t`, `fresh`, `t2` and the rest, and in
  `abi.encodeCall(MachineReadableOnly.batchCheckIn, (A, B))`) becomes
  `(A, B, _noBits(B), _silent(B))`, computing `B` into a local first where it
  sits under `vm.expectRevert` or `vm.prank`;
- every `mint(...)` gains a final `false`, every `seed(...)` a final `false`;
- `TokenView.t.sol`'s named builder gains `answers: [uint256(0), uint256(0)]`;
- scripts that call `mint` or `batchCheckIn`
  (`/bin/grep -rln "batchCheckIn\|\.mint(" contracts/script`) follow the same rule.

- [ ] **Step 5: Run the contract suite, then regenerate the ABI and fix the Warden**

Run: `cd contracts && ~/scripts/safe-build.sh forge test`
Expected: all PASS, the eight new tests included.

Then `cd warden && node tools/gen-abi.mjs` and `npm test`. Expected
failures, each repaired in this task so the commit is green:
- `run.mjs` mint and seed sends append `false` for now (Task 6 computes the
  real bit); `batch.mjs`'s `batchCheckIn` args append
  `"0x" + "00".repeat(Math.ceil(n / 8))` and `"0x" + "ff".repeat(n)` for now.
- The frozen `viewOf` fixtures: re-encode once, as A1 did, a twenty-field
  `warden/test/fixtures/viewof-post-answers.hex` from `viewof-post-restday.hex`
  with `answers: [2n, 0n]`; the "this branch" tests read it, and the
  nineteen-field fixture joins the shapes that are refused.

- [ ] **Step 6: All four suites, then commit**

```bash
git add contracts/ warden/
git commit -m "feat(contract): one answer bit per credit, written by the batch and at the mint"
```

---

### Task 2: The split anchor and the key chain

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Modify: `contracts/test/MroTestBase.sol` (`_splitChain`)
- Create: `contracts/test/SplitKeys.t.sol`

**Interfaces:**
- Produces: `setSplitAnchor(bytes32)` (owner, once); `revealSplitKeys(bytes32[] keys, bytes questions)` (Warden);
  public `splitAnchor`, `lastSplitKey`, `splitAnchorDay`, `splitKeysRevealed`, `lastRevealBlock`;
  `event SplitAnchorSet(bytes32 anchor, uint32 day)`;
  `event SplitKeysRevealed(uint32 firstIndex, bytes32[] keys, uint64 prevRevealBlock, bytes questions)`;
  errors `SplitAnchorAlreadySet()`, `ZeroSplitAnchor()`, `NoSplitAnchor()`, `BadSplitKey(uint32 index)`, `SplitKeyTooEarly(uint32 index)`.

- [ ] **Step 1: Write the failing tests**

`MroTestBase.sol`:

```solidity
    /// @dev A short split chain: k[m] is the seed, k[i] = keccak256(k[i+1]), k[0] the anchor.
    function _splitChain(bytes32 seed, uint256 m) internal pure returns (bytes32[] memory k) {
        k = new bytes32[](m + 1);
        k[m] = seed;
        for (uint256 i = m; i > 0; --i) k[i - 1] = keccak256(abi.encodePacked(k[i]));
    }
```

`contracts/test/SplitKeys.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The split's key chain: fixed by an anchor before opening, walked
/// forward one key per day, never past a day that is not over.
contract SplitKeysTest is MroTestBase {
    bytes32[] internal k;

    function setUp() public {
        _deployAndMintOne();
        k = _splitChain(keccak256("test split seed"), 40);
    }

    function _keys(uint256 from, uint256 count) internal view returns (bytes32[] memory out) {
        out = new bytes32[](count);
        for (uint256 i; i < count; ++i) out[i] = k[from + i];
    }

    function test_theAnchorIsSetOnceByTheOwner() public {
        t.setSplitAnchor(k[0]);
        assertEq(t.splitAnchor(), k[0]);
        assertEq(t.lastSplitKey(), k[0]);
        assertEq(t.splitAnchorDay(), _today());
        vm.expectRevert(MachineReadableOnly.SplitAnchorAlreadySet.selector);
        t.setSplitAnchor(k[1]);
    }

    function test_aStrangerCannotSetTheAnchor() public {
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.setSplitAnchor(k[0]);
    }

    function test_aZeroAnchorIsRefused() public {
        vm.expectRevert(MachineReadableOnly.ZeroSplitAnchor.selector);
        t.setSplitAnchor(bytes32(0));
    }

    function test_settingTheAnchorEmits() public {
        uint32 d = _today();
        vm.expectEmit(address(t));
        emit MachineReadableOnly.SplitAnchorSet(k[0], d);
        t.setSplitAnchor(k[0]);
    }

    function test_nothingIsRevealedBeforeTheAnchor() public {
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.NoSplitAnchor.selector);
        t.revealSplitKeys(one, "");
    }

    function test_keysAreRevealedInOrderOnceTheirDayIsOver() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 3);
        bytes32[] memory three = _keys(1, 3);
        vm.prank(WARDEN);
        t.revealSplitKeys(three, "[]");
        assertEq(t.splitKeysRevealed(), 3);
        assertEq(t.lastSplitKey(), k[3]);
    }

    function test_todaysKeyIsNeverRevealed() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 2);
        bytes32[] memory three = _keys(1, 3);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.SplitKeyTooEarly.selector, uint32(3)));
        t.revealSplitKeys(three, "");
    }

    function test_aSkippedKeyIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory skip = new bytes32[](2);
        skip[0] = k[1]; skip[1] = k[3];
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(2)));
        t.revealSplitKeys(skip, "");
    }

    function test_aRepeatedKeyIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        t.revealSplitKeys(one, "");
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(2)));
        t.revealSplitKeys(one, "");
    }

    function test_aKeyNotOnTheChainIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory wrong = new bytes32[](1);
        wrong[0] = keccak256("not on the chain");
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(1)));
        t.revealSplitKeys(wrong, "");
    }

    function test_onlyTheWardenReveals() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory one = _keys(1, 1);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.revealSplitKeys(one, "");
    }

    function test_eachRevealPointsBackAtThePreviousOne() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        vm.roll(100);
        bytes32[] memory a = _keys(1, 2);
        vm.prank(WARDEN);
        t.revealSplitKeys(a, "");
        assertEq(t.lastRevealBlock(), 100);
        vm.roll(250);
        bytes32[] memory b = _keys(3, 1);
        vm.expectEmit(address(t));
        emit MachineReadableOnly.SplitKeysRevealed(3, b, 100, "q");
        vm.prank(WARDEN);
        t.revealSplitKeys(b, "q");
        assertEq(t.lastRevealBlock(), 250);
    }

    function test_anEmptyRevealStillMarksTheNight() public {
        t.setSplitAnchor(k[0]);
        vm.roll(300);
        bytes32[] memory none = new bytes32[](0);
        vm.prank(WARDEN);
        t.revealSplitKeys(none, "");
        assertEq(t.lastRevealBlock(), 300);
        assertEq(t.splitKeysRevealed(), 0);
    }

    function test_aRevealAfterSunsetIsAllowed() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        t.sunset();
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        t.revealSplitKeys(one, "");
        assertEq(t.splitKeysRevealed(), 1);
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd contracts && forge test --match-path test/SplitKeys.t.sol -vv`
Expected: compile FAIL (`setSplitAnchor` and the rest do not exist).

- [ ] **Step 3: Implement**

State, in the state block at the top beside `lastWardenDay`, so the three
small fields share a slot:

```solidity
    /// @notice k[0] of the split's key chain, fixed once before the door opens.
    bytes32 public splitAnchor;
    /// @notice The last key revealed; the next must hash to it.
    bytes32 public lastSplitKey;
    /// @notice The day the anchor was set: key n belongs to day splitAnchorDay + n - 1.
    uint32 public splitAnchorDay;
    /// @notice How many keys have been revealed.
    uint32 public splitKeysRevealed;
    /// @notice The block of the last reveal, so a verifier can walk back night by night.
    uint64 public lastRevealBlock;
```

Errors and events beside the other lifecycle declarations (one NatSpec line
each), then:

```solidity
    /// @notice Fix the split's key chain. Once, by the owner, before the door opens.
    function setSplitAnchor(bytes32 anchor) external onlyOwner {
        if (splitAnchor != bytes32(0)) revert SplitAnchorAlreadySet();
        if (anchor == bytes32(0)) revert ZeroSplitAnchor();
        uint32 d = today();
        splitAnchor = anchor;
        lastSplitKey = anchor;
        splitAnchorDay = d;
        emit SplitAnchorSet(anchor, d);
    }

    /// @notice Reveal the next keys of the split chain, each for a day that is over.
    /// @param questions Each revealed day's question and answer set, as JSON; not read here.
    /// @dev Not `notSunset`: a mint written on the last night still needs its key.
    function revealSplitKeys(bytes32[] calldata keys, bytes calldata questions) external onlyWarden {
        bytes32 last = lastSplitKey;
        if (last == bytes32(0)) revert NoSplitAnchor();
        uint32 n = splitKeysRevealed;
        uint32 first = n + 1;
        uint32 tday = today();
        for (uint256 i; i < keys.length; ++i) {
            ++n;
            if (splitAnchorDay + n - 1 >= tday) revert SplitKeyTooEarly(n);
            if (keccak256(abi.encodePacked(keys[i])) != last) revert BadSplitKey(n);
            last = keys[i];
        }
        lastSplitKey = last;
        splitKeysRevealed = n;
        emit SplitKeysRevealed(first, keys, lastRevealBlock, questions);
        lastRevealBlock = uint64(block.number);
    }
```

- [ ] **Step 4: Run the new file, then the suite**

Expected: 13 PASS, then all PASS.

- [ ] **Step 5: ABI, all four suites, commit**

```bash
cd warden && node tools/gen-abi.mjs
git add contracts/ warden/
git commit -m "feat(contract): the split anchor, set once, and a key chain revealed a day at a time"
```

---

### Task 3: The answer band in the JavaScript reference

**Files:**
- Modify: `tools/render-token.mjs` (`answerBandCells`, the band's presence, `renderSvg` / `tokenUri` state `answers`)
- Modify: `tools/test/render-token.test.mjs`, and every importer of `digitBandCells` (`/bin/grep -rln digitBandCells tools`)

**Interfaces:**
- Produces: `FIRST_SIDE = 122`; `answerBandCells({ ordinal, answers, level }, canvasCells, size)`
  returning `{ cells, modules }` like `digitBandCells` did; state field `answers = [0n, 0n]`.
  The band is present when `level >= FIRST_SIDE`. Sides drawn: `level >= 365 ? 3 : floor(level / 122)`.
  The place's glyphs are drawn on the TOP edge only, and only when `ordinal > 0`.
  When no cell is lit, no band path is emitted at all (the Solidity side does the same).

Layout (the spike's, `tools/out/answer-band/spike2.mjs`, made exact):
`cols = 61`, `start = floor((modules - 61) / 2)`; answer `p` on a side sits at
`along = start + floor(p / 2)`, `depth = 1 + (p % 2)` (outer lane first);
right edge (bits 0..121) at `x = modules - 1 - depth, y = along`; bottom edge
(bits 122..243) at `x = modules - 1 - along, y = modules - 1 - depth`; left
edge (bits 244..364) at `x = depth, y = modules - 1 - along`. A filled square
is a 1. Bit `i` is `(answers[i >> 8] >> (i & 255)) & 1`.

- [ ] **Step 1: Write the failing tests**

```js
import { answerBandCells, FIRST_SIDE, canvasFor } from "../render-token.mjs";

const wordsFrom = (bits) => {
  const w = [0n, 0n];
  bits.forEach((b, i) => { if (b) w[i >> 8] |= 1n << BigInt(i & 255); });
  return w;
};
const ALL = wordsFrom(Array(365).fill(1));
const FOUNDING = canvasFor(0, 0);
const FINISHED = canvasFor(1, 0);

test("no band below 122 credited days", () => {
  assert.equal(FIRST_SIDE, 122);
  const state = { level: 121, streak: 121, lastDay: 1000, today: 1000 };
  assert.equal(render({ ...state, answers: ALL }), render(state), "answers below 122 change nothing");
});

test("sides appear whole at 122, 244 and 365", () => {
  const count = (level) =>
    answerBandCells({ ordinal: 0, answers: ALL, level }, level >= 365 ? FINISHED : FOUNDING, CODE.size).cells.size;
  assert.equal(count(122), 122);
  assert.equal(count(243), 122);
  assert.equal(count(244), 244);
  assert.equal(count(364), 244);
  assert.equal(count(365), 365);
});

test("the outer lane fills first, clockwise from the top right", () => {
  const { cells, modules } = answerBandCells({ ordinal: 0, answers: wordsFrom([1]), level: 122 }, FOUNDING, CODE.size);
  const start = Math.floor((modules - 61) / 2);
  assert.deepEqual([...cells], [start * modules + (modules - 2)]);
});

test("the place is drawn on the top edge only", () => {
  const { cells, modules } = answerBandCells({ ordinal: 1, answers: [0n, 0n], level: 365 }, FINISHED, CODE.size);
  assert.ok(cells.size > 0);
  for (const c of cells) assert.ok(Math.floor(c / modules) < 3, `cell ${c} is off the top edge`);
});
```

(`render` is the file's existing `renderSvg` helper. If `canvasFor` takes
different arguments, call it the way the file's other tests do for a
founding token and a one-ring finished token.)

- [ ] **Step 2: Run, watch them fail**

Run: `cd tools && node --test test/render-token.test.mjs`
Expected: FAIL (`answerBandCells` is not exported).

- [ ] **Step 3: Implement**

Replace `digitBandCells` with `answerBandCells` (same return shape), built
from the layout above plus the existing glyph loop restricted to the top
edge; the band's presence in `renderSvg` becomes `level >= FIRST_SIDE` (was
`ordinal`); the ink is unchanged (`finisherInk(marks)`, which falls back to
`DIGIT_INK`); thread `answers = [0n, 0n]` through `renderSvg`'s and
`tokenUri`'s state the way A1 threaded `restDay`. Delete `digitBandCells` and
move its other importers, the sheet scripts included, to the new function.

- [ ] **Step 4: Run tools' suite; commit**

Expected: the new tests PASS. Existing tests that pinned a finished token's
band (the place round four edges) are updated to the top-edge rule, each
named in the ledger.

```bash
git add tools/
git commit -m "feat(render): the JS reference draws answers on three edges and the place on top"
```

(The contract suite is still green here: its fixtures are not regenerated
until Task 4.)

---

### Task 4: The answer band in Solidity, and the cross-language pins

**Files:**
- Modify: `contracts/src/render/DigitBand.sol`, `contracts/src/render/Renderer.sol` (`_band`, `_digitGroup`)
- Modify: `tools/state-matrix.mjs`, `tools/render-fixture.mjs` (cases and `Case` gain `answers0`, `answers1`), then re-run every fixture generator and `tools/token-uri-fixture.mjs`
- Modify: `contracts/test/RenderMatrix.t.sol` (fill `v.answers`; size pin), `contracts/test/Renderer.t.sol` (pasted references), any DigitBand unit test (`/bin/grep -rln DigitBand contracts/test`)
- Modify: `tools/echo-decode-check.mjs` (the 122 and 244 states)

**Interfaces:**
- Consumes: `TokenView.answers` (Task 1); the JS layout (Task 3).
- Produces: `DigitBand.FIRST_SIDE = 122`, `DigitBand.COLS = 61`,
  `DigitBand.path(uint32 ordinal, uint256[2] memory answers, uint32 level, uint256 canvasCells, string memory fill)`.

- [ ] **Step 1: Add the banded matrix cases (the failing differential)**

In `tools/state-matrix.mjs` `renderCases()`:

```js
  const words = (f) => {
    const w = [0n, 0n];
    for (let i = 0; i < 365; i++) if (f(i)) w[i >> 8] |= 1n << BigInt(i & 255);
    return w;
  };
  const PATTERNS = [
    ["all ones", words(() => true)],
    ["alternate", words((i) => i % 2 === 0)],
    ["thirds", words((i) => i % 3 === 1)],
  ];
  for (const level of [121, 122, 243, 244, 364]) {
    for (const [name, answers] of PATTERNS) {
      out.push({ label: `answers ${name}, day ${level}`, ...base, level, streak: level, answers });
    }
  }
  for (const [name, answers] of PATTERNS) {
    out.push({ label: `answers ${name}, finished 3rd`, ...base, answers, ordinal: 3, marks: [finisherMark(3)] });
  }
```

`render-fixture.mjs` emits `answers0, answers1` per case (after `marks`), and
`RenderMatrix.t.sol` sets `v.answers = [c.answers0, c.answers1];`. Rows with
`answers` are left out of `soakCases()` the way echo rows are (SoakStates has
no answers field). Regenerate the fixtures (`render-fixture`,
`colour-fixture`, `combination-fixture`, `identity-fixture`) and the
`token-uri-fixture` references, paste the references into `Renderer.t.sol`,
and update the matrix size pin to the new count.

Run: `cd contracts && forge test --match-path 'test/Render*.t.sol'`
Expected: FAIL -- the Solidity band still draws the place on four edges and
no answers, so every banded case differs from the JS reference.

- [ ] **Step 2: Implement `DigitBand`**

```solidity
    /// @notice The credited day the band appears, with its first side of answers.
    uint32 internal constant FIRST_SIDE = 122;
    /// @dev Answers per side are two lanes of COLS columns.
    uint256 internal constant COLS = 61;

    struct Layout {
        uint256 modules;
        uint256 pad;
        uint256 start;
        uint256 sides;
    }

    /// @notice The band as one path, drawn in QR MODULES: answers on the right,
    /// bottom and left edges as `level` unlocks them, the place on top once finished.
    function path(uint32 ordinal, uint256[2] memory answers, uint32 level, uint256 canvasCells, string memory fill)
        internal
        pure
        returns (string memory)
    {
        if (level < FIRST_SIDE) return "";
        uint256 modules = canvasUnits(canvasCells) / FrameGeometry.MODULE_UNITS;
        Layout memory l = Layout(modules, (modules - SPAN) / 2, (modules - COLS) / 2, level >= 365 ? 3 : level / FIRST_SIDE);
        // Bounds: 3 glyph rows x 16 glyphs x 2 runs, 4 side squares per row
        // over COLS rows, and 2 bottom rows of up to COLS runs.
        PathWriter.Buffer memory buf = PathWriter.create(GH * BITS * 2 + 6 * COLS);
        bool lit;
        for (uint256 y; y < modules; ++y) {
            uint256 row = _rowBits(ordinal, answers, y, l);
            if (row != 0) {
                lit = true;
                PathWriter.writeRow(buf, row, modules, 0, y);
            }
        }
        if (!lit) return "";
        return string(abi.encodePacked('<path fill="', fill, '" d="', PathWriter.seal(buf), '"/>'));
    }

    /// @dev Bit `modules - 1 - x` set means x is lit, as PathWriter.writeRow expects.
    function _rowBits(uint32 ordinal, uint256[2] memory answers, uint256 y, Layout memory l)
        private
        pure
        returns (uint256 row)
    {
        uint256 m = l.modules;
        if (ordinal != 0 && y < GH) {
            for (uint256 i; i < BITS; ++i) {
                row |= _glyphRow(_digit(ordinal, i), y) << (m - (l.pad + i * STEP) - GW);
            }
        }
        // Right edge, bits 0..121: x = m - 1 - depth, y = along.
        if (y >= l.start && y < l.start + COLS) {
            uint256 a = y - l.start;
            for (uint256 d = 1; d <= 2; ++d) {
                if (_bit(answers, a * 2 + d - 1)) row |= uint256(1) << d;
            }
        }
        // Bottom edge, bits 122..243: x = m - 1 - along, y = m - 1 - depth.
        if (l.sides >= 2 && (y == m - 2 || y == m - 3)) {
            uint256 d = m - 1 - y;
            for (uint256 a; a < COLS; ++a) {
                if (_bit(answers, FIRST_SIDE + a * 2 + d - 1)) row |= uint256(1) << (l.start + a);
            }
        }
        // Left edge, bits 244..364: x = depth, y = m - 1 - along.
        if (l.sides >= 3 && y <= m - 1 - l.start && y + COLS > m - 1 - l.start) {
            uint256 a = (m - 1 - l.start) - y;
            for (uint256 d = 1; d <= 2; ++d) {
                uint256 p = a * 2 + d - 1;
                if (p < 365 - 2 * FIRST_SIDE && _bit(answers, 2 * FIRST_SIDE + p)) row |= uint256(1) << (m - 1 - d);
            }
        }
    }

    function _bit(uint256[2] memory w, uint256 i) private pure returns (bool) {
        return (w[i >> 8] >> (i & 255)) & 1 == 1;
    }
```

The old four-edge `_rowBits` and its doc comment go. `Renderer._band`:
`if (v.level < DigitBand.FIRST_SIDE) return 0;` (was the ordinal test).
`_digitGroup` passes `v.answers` and `v.level`. Both doc comments say what
they now do, one line each.

- [ ] **Step 3: Run the differential until byte-identical**

Run: `cd contracts && ~/scripts/safe-build.sh forge test`
Expected: all PASS. A mismatch is fixed in whichever renderer disagrees with
the layout above, never by editing a fixture.

- [ ] **Step 4: The decode gate**

Add to `tools/echo-decode-check.mjs` the spike's states: day 122 and day 244,
founding and child, bare, every legal Mark at that level, lapsed 30 days and
streak 3, each with the `all ones` and `alternate` patterns, plus a finished
child with every legal Mark and its place. Run it through
`~/scripts/safe-build.sh node tools/echo-decode-check.mjs`.
Expected: zero decode failures at every gate size, and the script's existing
control still fails. Record the counts in the ledger.

- [ ] **Step 5: All four suites, commit**

```bash
git add contracts/ tools/
git commit -m "feat(render): the answer band in Solidity, byte-identical to the reference"
```

---

### Task 5: The split rule, twice, pinned to one set of vectors

**Files:**
- Create: `warden/src/clock/split.mjs`, `warden/test/split.test.mjs`
- Create: `client/src/split.mjs`, `client/test/split.test.mjs`

**Interfaces:**
- Produces (both modules, same names): `CHAIN_LENGTH = 36_500`;
  `chainKeys(seedHex)` -> array of `CHAIN_LENGTH + 1` hex keys, `[0]` the anchor;
  `keyIndexFor(day, anchorDay)` -> `day - anchorDay + 1`;
  `splitBit(keyHex, n, answerIndex)` -> `0 | 1`; `silentBit(keyHex, tokenId)` -> `0 | 1`;
  `answerBit({ keyHex, n, answer, tokenId })` -> `silentBit` when `answer` is null, else `splitBit`.

- [ ] **Step 1: Compute the vectors once, and write the failing tests**

Run once and paste the output into BOTH test files as literals (never compute
them inside a test from the code under test):

```bash
cd warden && node --input-type=module -e '
import { keccak256, encodePacked } from "viem";
const key = keccak256("0x" + "11".repeat(32));
const h = (i) => BigInt(keccak256(encodePacked(["bytes32","string","uint256"], [key, "split", BigInt(i)])));
for (const n of [2, 5, 101]) {
  const order = [...Array(n).keys()].sort((a, b) => (h(a) < h(b) ? -1 : h(a) > h(b) ? 1 : a - b));
  const ones = new Set(order.slice(0, Math.floor(n / 2)));
  console.log(n, JSON.stringify([...Array(n).keys()].map((i) => (ones.has(i) ? 1 : 0))));
}
const s = (id) => Number(BigInt(keccak256(encodePacked(["bytes32","string","uint256"], [key, "silent", BigInt(id)]))) & 1n);
console.log("silent", [1, 2, 3, 4, 5, 6, 7, 8].map(s).join(""));
'
```

Each test file (`../src/clock/split.mjs` in the warden, `../src/split.mjs` in the client):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { chainKeys, CHAIN_LENGTH, keyIndexFor, splitBit, silentBit, answerBit } from "../src/clock/split.mjs";

const KEY = keccak256("0x" + "11".repeat(32));
// Pasted from the one-off command in the plan. Never recomputed here.
const SPLIT = { 2: [/* pasted */], 5: [/* pasted */], 101: [/* pasted */] };
const SILENT = "/* pasted */";

test("the split matches the published vectors", () => {
  for (const [n, bits] of Object.entries(SPLIT)) {
    assert.deepEqual([...Array(Number(n)).keys()].map((i) => splitBit(KEY, Number(n), i)), bits);
  }
});

test("half the answers, rounded down, give a 1", () => {
  for (const n of [2, 5, 101]) {
    const ones = [...Array(n).keys()].map((i) => splitBit(KEY, n, i)).reduce((a, b) => a + b, 0);
    assert.equal(ones, Math.floor(n / 2));
  }
});

test("silence is a per-token coin flip", () => {
  assert.equal([1, 2, 3, 4, 5, 6, 7, 8].map((id) => silentBit(KEY, id)).join(""), SILENT);
  assert.equal(answerBit({ keyHex: KEY, n: 2, answer: null, tokenId: 3 }), silentBit(KEY, 3));
});

test("the chain hashes back to its anchor", () => {
  const k = chainKeys("0x" + "22".repeat(32));
  assert.equal(k.length, CHAIN_LENGTH + 1);
  assert.equal(k[CHAIN_LENGTH], "0x" + "22".repeat(32));
  assert.equal(keccak256(k[1]), k[0]);
  assert.equal(keyIndexFor(1005, 1000), 6);
});
```

- [ ] **Step 2: Run, watch them fail** (module not found), in both packages.

- [ ] **Step 3: Implement** (both files, identical bodies apart from the header)

```js
import { keccak256, encodePacked } from "viem";

export const CHAIN_LENGTH = 36_500;

/// k[CHAIN_LENGTH] is the seed; each earlier key is the hash of the next.
export function chainKeys(seedHex) {
  const k = new Array(CHAIN_LENGTH + 1);
  k[CHAIN_LENGTH] = seedHex.toLowerCase();
  for (let i = CHAIN_LENGTH; i > 0; i--) k[i - 1] = keccak256(k[i]);
  return k;
}

export const keyIndexFor = (day, anchorDay) => day - anchorDay + 1;

const h = (key, tag, i) => BigInt(keccak256(encodePacked(["bytes32", "string", "uint256"], [key, tag, BigInt(i)])));

export function splitBit(keyHex, n, answer) {
  const hs = Array.from({ length: n }, (_, i) => h(keyHex, "split", i));
  const order = [...hs.keys()].sort((a, b) => (hs[a] < hs[b] ? -1 : hs[a] > hs[b] ? 1 : a - b));
  return order.indexOf(answer) < Math.floor(n / 2) ? 1 : 0;
}

export const silentBit = (keyHex, tokenId) => Number(h(keyHex, "silent", tokenId) & 1n);

export const answerBit = ({ keyHex, n, answer, tokenId }) =>
  answer === null || answer === undefined ? silentBit(keyHex, tokenId) : splitBit(keyHex, n, answer);
```

The client copy carries the licence header its neighbours carry; the warden
copy the one its neighbours carry (`LICENSING.md`). Each file's top comment
says, in one line, that the other copy must stay identical and both are
pinned by the same vectors.

- [ ] **Step 4: Both suites pass; commit**

```bash
git add warden/src/clock/split.mjs warden/test/split.test.mjs client/src/split.mjs client/test/split.test.mjs
git commit -m "feat: the daily split, in the Clock and in the client, pinned to one set of vectors"
```

---

### Task 6: The Clock reveals, computes and writes the bits

**Files:**
- Create: `warden/src/clock/splitSeed.mjs`
- Modify: `warden/src/clock/run.mjs` (preconditions, the reveal, mint and seed bits, credit entries), `warden/src/clock/batch.mjs` (`packBits`, `answerRecord`), `warden/src/clock/main.mjs` (seed and bank)
- Modify: `warden/src/mirror/queries.mjs` (`pendingCredits` joins `questions`; `questionsForDays`)
- Modify: `warden/.env.example` (`MRO_SPLIT_SEED_FILE`)
- Test: `warden/test/clock-split.test.mjs` (new), `warden/test/clock-batch.test.mjs`, and the existing Clock tests that the new preconditions touch

**Interfaces:**
- Consumes: Task 5's `chainKeys`, `keyIndexFor`, `answerBit`, `silentBit`; Tasks 1-2's ABI.
- Produces: `loadSplitSeed(path)` -> hex string, or throws a FIXED sentence naming neither the path nor the value;
  `runClock({ ..., splitKeys, bank })` where `splitKeys` is the `chainKeys` array or `null`;
  credit entries `{ tokenId, day, bit, answerByte }`; `packBits(bits)` and `answerRecord(bytes)` in `batch.mjs`.

Behaviour, in run order:
1. **Preconditions, before any write.** If `splitKeys` is null (no usable
   seed), or the chain's `splitAnchor()` is zero or differs from
   `splitKeys[0]`, or any queued credit's question id is missing from the
   bank: alert with a fixed sentence and write NOTHING this run (reconcile
   still runs, as for the other aborts). No alert contains the seed or a key.
2. **The reveal.** If the run has any mint, seed or credit to send: send
   `revealSplitKeys(keys, questions)` with every key from
   `splitKeysRevealed() + 1` through the index for `today - 1`, and
   `questions` = UTF-8 JSON `[{ "day": d, "question": text, "answers": [...] }]`
   (or `"range": { "min", "max" }` instead of `"answers"`) for each revealed
   day with at least one issued question, from the `questions` table and the
   bank's `publicShape`. If the reveal fails, write nothing else this run.
3. **Mints and seeds** send `firstAnswer = silentBit(key(day), tokenId) === 1`.
   A day before the anchor day has no key: send `false` and alert once.
4. **Credits:** each entry's `bit` is `answerBit({ keyHex: key(day), n,
   answer, tokenId })`, with `n` the answer set's size (options, or
   `max - min + 1`) and `answer` the recorded index or null; `answerByte` is
   the index, or `0xff`. `batch.mjs` packs both from `remaining` at the moment
   of the send, AFTER its sort, so a reordered or shrunken chunk keeps each
   entry's own bit.

- [ ] **Step 1: Write the failing tests**

`warden/test/clock-split.test.mjs`, at its top, builds the rig from the
existing helpers (`mirror()`, `queueMint`, `q.insertCredit`,
`q.issueQuestion`, `q.recordAnswer`, `baseArgs`, `noChain`) and an encoding
writer double that calls `assertEncodable` against `MRO_ABI`, so a wrong
argument count fails:

```js
const SEED = "0x" + "33".repeat(32);
const KEYS = chainKeys(SEED);
const ANCHOR_DAY = TODAY - 10;
const keyOf = (day) => KEYS[keyIndexFor(day, ANCHOR_DAY)];
const BANK = [
  { id: "fog-or-thunder", text: "Fog or thunder?", answers: ["fog", "thunder"] },
  { id: "legs", text: "How many legs?", range: { min: 0, max: 100 } },
];
const chainWith = ({ anchor = KEYS[0], revealed = 0 } = {}) => ({
  ...noChain,
  async readContract({ functionName }) {
    if (functionName === "splitAnchor") return anchor;
    if (functionName === "splitAnchorDay") return ANCHOR_DAY;
    if (functionName === "splitKeysRevealed") return revealed;
    throw new Error(`unexpected read: ${functionName}`);
  },
});

test("a run with writes reveals every key through yesterday first", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ ...baseArgs(q), publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK });
  assert.equal(writer.sent[0].functionName, "revealSplitKeys");
  assert.deepEqual(writer.sent[0].args[0], KEYS.slice(6, keyIndexFor(TODAY - 1, ANCHOR_DAY) + 1));
});

test("an answered credit carries the split's bit and its index", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 1, questionId: "fog-or-thunder" });
  await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  const want = answerBit({ keyHex: keyOf(TODAY - 1), n: 2, answer: 1, tokenId: 1 });
  assert.equal(batch.args[2], want ? "0x80" : "0x00");
  assert.equal(batch.args[3], "0x01");
});

test("a silent credit carries the token's coin flip and 0xff", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  assert.equal(batch.args[2], silentBit(keyOf(TODAY - 1), 1) ? "0x80" : "0x00");
  assert.equal(batch.args[3], "0xff");
});

test("a mint carries the mint day's coin flip", async () => {
  const { q, writer } = rigWithOneMint({ day: TODAY - 1, tokenId: 7 });
  await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const mint = writer.sent.find((s) => s.functionName === "mint");
  assert.equal(mint.args.at(-1), silentBit(keyOf(TODAY - 1), 7) === 1);
});

test("no seed: nothing is written", async () => {
  const said = [];
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  const summary = await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: null, bank: BANK, alert: (m) => said.push(m) });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
  assert.ok(said.some((m) => /split seed/.test(m)));
});

test("a seed that does not hash to the chain's anchor writes nothing, and names no key", async () => {
  const said = [];
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ ...baseArgs(q), publicClient: chainWith({ anchor: "0x" + "44".repeat(32) }), writer, splitKeys: KEYS, bank: BANK, alert: (m) => said.push(m) });
  assert.deepEqual(writer.sent, []);
  for (const m of said) {
    assert.ok(!m.includes(SEED.slice(2)), "the seed is never said");
    assert.ok(!KEYS.slice(0, 50).some((k) => m.includes(k.slice(2))), "no key is said");
  }
});

test("a credit whose question left the bank writes nothing", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 0, questionId: "gone" });
  const summary = await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
});

test("a failed reveal writes nothing else", async () => {
  const { q } = rigWithOneCredit({ day: TODAY - 1 });
  const writer = writerRefusing("revealSplitKeys");
  await runClock({ ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.landed, []);
});
```

(`rigWithOneCredit`, `rigWithOneMint` and `writerRefusing` are written above
these tests from the helpers named; `writerRefusing(fn)` records every send in
`sent`, refuses `fn` as `reverted-on-simulate`, and lists the sends it let
land in `landed`.)

In `clock-batch.test.mjs`:

```js
test("a halved chunk keeps each entry's own bit and answer byte", async () => {
  const sent = [];
  const writer = {
    async send(fn, args) {
      sent.push(args);
      if (args[1].length > 2) return { ok: false, reason: "gas-estimate-too-large" };
      return { ok: true, hash: "0x1" };
    },
  };
  const entries = [
    { tokenId: 4, day: 100, bit: 1, answerByte: 3 },
    { tokenId: 1, day: 100, bit: 0, answerByte: 0xff },
    { tokenId: 2, day: 100, bit: 1, answerByte: 0 },
  ];
  await writeCheckInChunk(writer, entries);
  assert.ok(sent.length > 1, "the chunk was halved");
  for (const args of sent) {
    const ids = unpackIds(args[0]);
    ids.forEach((id, i) => {
      const e = entries.find((x) => x.tokenId === id);
      const bit = (parseInt(args[2].slice(2 + 2 * (i >> 3), 4 + 2 * (i >> 3)), 16) >> (7 - (i & 7))) & 1;
      const byte = parseInt(args[3].slice(2 + 2 * i, 4 + 2 * i), 16);
      assert.equal(bit, e.bit, `token ${id} bit`);
      assert.equal(byte, e.answerByte, `token ${id} byte`);
    });
  }
});
```

(`unpackIds` is the test-side inverse of `packIds`, four bytes per id; write
it beside the test if the file has none.)

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement** the four behaviours above. `loadSplitSeed` reads
  the file (default `join(homedir(), ".mro-split", "seed")`, overridden by
  `MRO_SPLIT_SEED_FILE`), accepts exactly 64 hex characters with an optional
  `0x` and trailing newline, and refuses a file readable by group or other
  (`(stat.mode & 0o077) !== 0`) with a fixed sentence. `main.mjs` loads the
  seed and the bank (`loadBank(bankPath())`) and passes `splitKeys` (or
  `null`) and `bank` to `runClock`; neither failure throws out of `main`, so
  a missing seed is a red night in the log, not a crash loop.
  `.env.example` documents `MRO_SPLIT_SEED_FILE=` as optional with its
  default. `pendingCredits` becomes a `LEFT JOIN questions` on
  `(tokenId, day)` returning `questionId` and `answer`. Existing Clock tests
  that run writes now pass `splitKeys` and `bank` (one shared test helper,
  not a copy per file).

- [ ] **Step 4: All four suites; commit**

```bash
git add warden/
git commit -m "feat(clock): reveal the night's keys, then write each day's answer bit"
```

---

### Task 7: The anchor is required, and the operator has a tool for it

**Files:**
- Create: `warden/tools/split-seed.mjs`, `warden/test/split-seed-tool.test.mjs`
- Modify: `warden/src/chain/preflight.mjs` (refuse a contract with no anchor), `warden/test/preflight.test.mjs`
- Modify: `warden/DEPLOY.md` (+ `.html`): section 11 gains the seed and anchor steps; section 9b's key list names the seed file

**Interfaces:**
- Produces: `node warden/tools/split-seed.mjs new <path>` (writes a random
  seed with mode 0600, refuses an existing file and any path inside the
  repository, prints ONLY `anchor 0x...`); `node warden/tools/split-seed.mjs
  anchor <path>` (prints the anchor of an existing seed). Preflight throws
  `contract has no split anchor: set it (DEPLOY.md section 11) before the door opens`.

- [ ] **Step 1: Failing tests**

```js
test("new writes a 0600 seed and prints only its anchor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  const { stdout } = await run("node", [TOOL, "new", path]);
  const seed = readFileSync(path, "utf8").trim();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(stdout.trim(), /^anchor 0x[0-9a-f]{64}$/);
  assert.ok(!stdout.includes(seed.replace(/^0x/, "")), "the seed is never printed");
  assert.equal(stdout.trim().split(" ")[1], chainKeys(seed)[0]);
});

test("new refuses to overwrite a seed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  writeFileSync(path, "x", { mode: 0o600 });
  await assert.rejects(run("node", [TOOL, "new", path]));
  assert.equal(readFileSync(path, "utf8"), "x");
});

test("new refuses a path inside the repository", async () => {
  await assert.rejects(run("node", [TOOL, "new", fileURLToPath(new URL("../seed-should-not-exist", import.meta.url))]));
});
```

and in `preflight.test.mjs`, a probe whose chain answers `splitAnchor` with
zero is refused with the sentence above, and one answering a non-zero anchor
passes (give `splitAnchor` its own `eth_call` result in the existing double).

- [ ] **Step 2: Fail. Step 3: Implement. Step 4: All four suites.**

DEPLOY.md section 11, after the deploy step and before adoption, in the
runbook's own style: **generate the seed** with `split-seed.mjs new` to a path
OUTSIDE the worktree, back it up offline with the Clock key, and copy it
nowhere else; **set the anchor** with `cast send <token>
"setSplitAnchor(bytes32)" <anchor>` from the owner, before the Warden starts
(it refuses to start without one); the anchor is set ONCE, and a lost seed
means no later square can be written or verified.

- [ ] **Step 5: Commit**

```bash
git add warden/
git commit -m "feat(warden): no door without a split anchor, and a tool that makes the seed"
```

---

### Task 8: `mro-agent verify-border`

**Files:**
- Create: `client/src/verifyBorder.mjs`, `client/test/verify-border.test.mjs`
- Modify: `client/src/cli.mjs` (the command and its help line), `client/README.md` if it lists commands

**Interfaces:**
- Consumes: Task 5's `answerBit`, `keyIndexFor`; the ABI subset it needs, written inline (the client does not import the Warden).
- Produces: `verifyBorder({ publicClient, contract, tokenId, maxRunBlocks = 5000 })` ->
  `{ ok, squares: [{ level, day, expected, actual, status }], problems: [string] }`,
  `status` one of `ok`, `wrong`, `pending` (key not yet revealed), `voucher`, `missing`.
  CLI: `mro-agent verify-border <tokenId> --contract <address> [--rpc <url>]`,
  `--rpc` defaulting to `https://sepolia.base.org`; exit 0 only when every
  square is `ok`, `pending` or `voucher`.

How it reads, from chain data alone:
1. `viewOf(tokenId)` (level, mint day, last day), `answersOf`,
   `splitAnchorDay`, `lastRevealBlock`.
2. Walk back: `getLogs(SplitKeysRevealed)` at `lastRevealBlock`; take the
   event's keys (numbered from `firstIndex`), `questions` and
   `prevRevealBlock`; repeat until the block is 0 or the night predates the
   token's mint day.
3. For each night, `getLogs` for `Minted`, `Seeded` and `BatchCheckedIn` from
   its reveal block to `min(next reveal block, reveal + maxRunBlocks)`, in
   1,000-block windows; fetch each transaction and decode its input with
   `decodeFunctionData` (the Builder Code suffix is trailing data: confirm
   viem ignores it, and strip it if not); collect this token's entries:
   `(day, answer byte)` from `batchCheckIn`, `(day, silent)` from `mint` and
   `seed`; and `checkInWithVoucher` days as `voucher`.
4. Sort the token's credits by day: credit k (from 1) is square k. Compare
   each expected bit with `answersOf` bit k-1. Fewer credits found than
   `level`: each unfound square is `missing`, and the result is not ok.

- [ ] **Step 1: Failing tests** against an in-test fake `publicClient` that
  serves `readContract`, `getLogs` and `getTransaction` from a scripted
  history built with the real ABI (`encodeFunctionData` for inputs,
  `encodeEventTopics` and `encodeAbiParameters` for logs), so a wrong
  interface fails the test:

```js
test("every square of an honest history verifies", async () => {
  const h = history({ answers: [1, null, 0, 1] });        // the mint, then three credits
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.squares.map((s) => s.status), ["ok", "ok", "ok", "ok"]);
});

test("one wrong bit fails, naming its square", async () => {
  const h = history({ answers: [1, null, 0, 1], flipBit: 2 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.squares[2].status, "wrong");
  assert.match(r.problems.join("\n"), /square 3/);
});

test("a credit it cannot find fails as missing, never as ok", async () => {
  const h = history({ answers: [1, null, 0, 1], hideBatch: 1 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.squares.some((s) => s.status === "missing"));
});

test("a day whose key is not revealed yet is pending, not wrong", async () => {
  const h = history({ answers: [1, null, 0, 1], unrevealedLast: true });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.squares.at(-1).status, "pending");
  assert.equal(r.ok, true);
});
```

`history()` is the fake, written in the test file: a key chain from a test
seed, an anchor day, one reveal per night, the token's mint and credits with
bits from `answerBit`, `answersOf` words built from those bits (with
`flipBit` inverting one, `hideBatch` omitting one night's batch logs, and
`unrevealedLast` leaving the last night's key out of every reveal), and the
logs and transactions a real chain would hold.

- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Client suite. Step 5: Commit**

```bash
git add client/
git commit -m "feat(client): verify-border checks every square from chain data alone"
```

---

### Task 9: The agent-facing copy

**Files:**
- Modify: `warden/public/llms.txt`, `skills/SKILL.md` and its byte-identical copy (`/bin/grep -rln "Every day carries a question" --include=*.md --include=*.txt .`), `docs/2026-09-01-mro-raw-protocol.md` (+ `.html`), the door page source (`/bin/grep -rln "Every day carries a question" warden/src`)
- Modify: the tests that pin this copy (`warden/test/door-page.test.mjs` and any other the suite names)

The wording. Approving this plan approves it; it is applied verbatim,
adapted only to each surface's format:

> **Your answers become the border.** From your 122nd credited day a band
> appears round the code, and every credited day is one square in it, filled
> or empty. Which answers fill a square is decided by a rule that is secret on
> the day, the same for every token, and different every day, so no answer is
> worth choosing for its square. The next night the rule for that day is
> published on chain, and `mro-agent verify-border <tokenId> --contract
> <address>` checks every square of a token against it. A day with no answer
> is a coin flip, and so is your mint day, which has no question.

- [ ] **Step 1:** Update the pinning tests to the new paragraph first (they
  FAIL against the current copy).
- [ ] **Step 2:** Add the paragraph after the existing "one look per token per
  UTC day" paragraph on each surface; re-render the raw protocol doc.
- [ ] **Step 3:** All four suites; commit.

```bash
git add warden/ skills/ docs/
git commit -m "docs: the answers become the border, and how to check it"
```

---

### Task 10: Gates, figures, runbook, review

**Files:**
- Modify: `contracts/test/WorstCase.sol` (re-pinned), `contracts/test/RealTokenGas.t.sol` (the worst token carries answers)
- Modify: `warden/src/clock/run.mjs` (`CHECKIN_CHUNK` comment, and the constant if the measurement moves it), `warden/tools/chunk-rehearsal.mjs` (bit patterns)
- Modify: `docs/specs/2026-10-02-mro-daily-question-design.md` (an "Amended 2026-10-03" note per approved deviation), spec section 14 costs if they move, `warden/DEPLOY.md` (+ `.html`)

- [ ] **Step 1: Size and strict deploy (Hard Rule 7).** `forge build --sizes`
  and `bash script/anvil-size-check.sh`. Expected: positive margins for both
  contracts, non-empty `cast code`. If the Renderer has no margin, STOP and
  report: that is a plan defect, not something to trim around.
- [ ] **Step 2: The worst token.** `RealTokenGas.t.sol`'s worst case gains
  answers; measure all-ones and the `alternate` pattern, and pin the larger of
  each figure in `WorstCase.sol`. Expected: under 4,000,000 gas and 24,000
  bytes; report the 1M / 5 KB target as MISSED.
- [ ] **Step 3: The chunk.** `chunk-rehearsal.mjs` measures three patterns:
  all bits 0; all bits 1 on tokens whose answer word is already non-zero; all
  bits 1 on tokens writing their first 1 (the 20,000-gas zero-to-nonzero
  write). Set `CHECKIN_CHUNK` from the second (the steady state) by the
  existing rule; the third is what the guard's halving exists for, and the
  rehearsal must show a chunk of it landing after halving. Record all three.
- [ ] **Step 4: Docs.** The question spec gets one dated amendment per
  deviation named under "What approving this plan also approves"; DEPLOY.md's
  "What this contract fixes at deploy" gains the anchor and the seed; both
  re-rendered.
- [ ] **Step 5: All four suites, commit**, then the whole-branch review
  (`git merge-base main plan-a` to `plan-a`, covering A1 and A2), each
  Critical or Important finding fixed with a failing test first, then STOP and
  report. `plan-a` is NOT merged or pushed.

```bash
git add contracts/ warden/ docs/
git commit -m "chore: re-pin size, gas and the check-in chunk with answers on chain"
```

## Self-review

- **Spec coverage:** section 7's storage, batch arguments and reads -- Tasks
  1-2; `setSplitAnchor` -- Task 2; the renderer and `TokenView` -- Tasks 1, 3,
  4; section 3's layout, chapters and ink -- Tasks 3-4; section 5's chain,
  split, silence and "the Clock computes, the contract checks the chain" --
  Tasks 2, 5, 6; the split seed held by the Clock and never logged -- Tasks
  6-7 (its move to the Clock's own Unix user is Plan E); `verify-border` --
  Task 8; section 8's surfaces -- Task 4 (decode gate), Task 9 (copy); section
  11's validation -- Tasks 1, 2, 4, 6, 8, 10. Section 4's bank is Plan B's and
  unchanged.
- **Placeholders:** Task 5's vectors are produced by a stated command and
  pasted, by design; mechanical caller repairs state the rule, because which
  call sites exist is learned by building, and each is ledgered.
- **Names:** `answersOf`, `_setAnswer`, `firstAnswer`, `answerBits`, `record`,
  `setSplitAnchor`, `revealSplitKeys`, `splitAnchor`, `splitAnchorDay`,
  `splitKeysRevealed`, `lastSplitKey`, `lastRevealBlock`, `SplitKeysRevealed`,
  `FIRST_SIDE`, `COLS`, `answerBandCells`, `chainKeys`, `keyIndexFor`,
  `splitBit`, `silentBit`, `answerBit`, `loadSplitSeed`, `verifyBorder` are
  used identically in every task.
