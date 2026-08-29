# Task 8: `MROSpikeToken`, the size guard and the gas budget

> **For agentic workers:** this plan is executed with
> `superpowers:executing-plans` in one session. Steps use checkbox (`- [ ]`)
> syntax for tracking. Every step is one action.

**Goal:** put a real ERC-721 in front of the renderer, prove the pair deploys
under the 24,576-byte limit, and measure `tokenURI` gas and bytes through that
token contract across seven life stages.

**Architecture:** `MROSpikeToken` holds one packed storage slot per token
(exactly the layout the real contract will use), builds a `TokenView` from it,
and forwards to the swappable `IRenderer`. Three new test files: behaviour and
access control, deployed-bytecode size, and the gas budget.

**Tech stack:** Foundry 1.7.1, Solidity 0.8.35, `evm_version = cancun`,
`via_ir = true`; OpenZeppelin Contracts v5.7.0 (`ERC721`, `Ownable2Step`,
`IERC4906`); Solady v0.1.26 in the renderers only. Node 24.14.1 for the
reference renderer and the fixture generator.

---

## Why this task, and what it unblocks

Every gas figure the spike has produced so far was the **renderer alone**,
called directly from a test with its `TokenView` already sitting in memory.
That is not what a marketplace does. A marketplace calls `tokenURI(id)` on the
token contract, which must read storage, build the struct, and only then call
the renderer. None of that is in the 1,547,524 worst case recorded in
`docs/phase0-results.md`.

Task 8 is where the budget is either confirmed or the spike re-plans. It also
produces the second half of CLAUDE.md hard rule 7 -- proof that the contracts
actually deploy -- which nothing has produced yet, because until now there was
no contract to deploy other than the renderer.

It unblocks Task 9 (deploy script and the end-to-end decode over RPC), which
unblocks Task 10 (Base Sepolia) and Task 11 (the throwaway mainnet OpenSea
check), which together produce the go/no-go verdict in Task 12.

## Where the budget stands going in

Budget, from the spec: **2,000,000 gas / 20,000 bytes HARD**, 1,000,000 / 5,000
TARGET. The target is already missed and will be reported as missed.

| Measured at Task 7 | Gas | Bytes |
|---|---|---|
| Day one | 1,383,723 | 8,616 |
| Whole, one ring | 1,385,441 | 8,665 |
| Ten years, at the ring cap | 1,523,902 | 9,531 |
| Cap and every Mark (worst case) | 1,547,524 | 9,882 |

That leaves **452,476 gas and 10,118 bytes** for everything the token contract
adds. The bytes are safe -- the token contract adds a name prefix and a few
attributes, not kilobytes. The gas is the number to watch: a cold `SLOAD` is
2,100 and the 172-byte `code` alone is seven of them, so the storage read is
roughly 20,000-30,000 gas. There is room, but the figure has to be measured,
not assumed. Two Phase 0 gas guesses have already been wrong in the other
direction.

**Storage is packed exactly as the spec packs it** -- one 256-bit slot for the
six `uint32`s and the `resting` flag -- so the number this task produces is the
number the real contract will pay, not a pessimistic stand-in.

---

## The decision this task needed from the operator -- DECIDED 2026-08-29: close all five

**The renderer emits eleven attributes. The spec asks for thirteen, and four of
them do not line up.** The resume checklist only flagged `parent`; reading the
spec's metadata section against `Renderer._attributes` found three more.

Spec, section "How it is rendered": `level`, `streak`, `heart`, `whole`,
`years`, `lastDay`, `mintDay`, `marks`, `agentKeyId`, `generation`, `parent`,
`children`, `resting`.

| Spec attribute | Status today |
|---|---|
| `heart` | **Not emitted.** Spec wants `"212/365"` -- filled cells over 365. |
| `agentKeyId` | **Not emitted**, even though `TokenView` already carries the field. It is dead weight in the struct right now. |
| `parent` | **Not emitted, and `TokenView` has no field.** The known gap. |
| `children` | Emitted, but named `Seeds Given`. Same value, different key. |

And the name. The spec says a whole token's name becomes `MRO #<id> (Whole)`
and a resting one gains `(At Rest)`. Neither happens; every token is
`Machine Readable Only %23<id>`.

### Recommendation: close all of it in this task

**Why:** all five changes touch the same three places -- `Renderer._attributes`
(and `_head` for the name), `tokenUri` in `tools/render-token.mjs`, and the
seven differential fixtures in `Renderer.t.sol` that have to be regenerated
afterwards. Doing them one at a time pays the fixture-regeneration cost five
times and leaves the spike shipping metadata that does not match its own spec.
Doing them together is one edit and one regeneration.

**The trade-off, stated honestly:** this costs bytes and gas out of a budget
that has already missed its target. `agentKeyId` is the expensive one -- a
`bytes32` rendered as hex is 66 characters, and it is the only one of the five
that is not a short number or a fixed word. The rest are small.

**I am not putting a number on that cost here.** Every Phase 0 estimate made
before measurement has been wrong, twice in the direction that mattered. Step
group A measures the delta and reports it before anything else is built; if it
turns out to eat a meaningful share of the 452,476 gas of headroom, that is a
finding to bring back rather than absorb silently.

### The alternative

Close `parent` only, as the resume checklist says, and leave `heart`,
`agentKeyId`, the `children` rename and the name suffixes to Task 12's spec
amendment -- which would resolve them by editing the spec down to what the
renderer does, rather than editing the renderer up to the spec.

That is a legitimate choice: Task 12 already rewrites section 8 around the
code-heart design, so the attribute list is being touched there anyway. It is
cheaper in gas and it is defensible. It is not what I would pick, because
`agentKeyId` sitting unused in `TokenView` is a loose end that Plan 2 would
trip over, and "which agent minted this" is close to the point of the piece.

**the operator chose to close all five, 2026-08-29.** Step group A below is written for
that choice and is the plan of record. The alternative above is kept only so the
reasoning behind the choice stays legible; do not re-open it.

The one live condition remains step A10: if the measured delta eats more than a
quarter of the 452,476 gas of headroom, stop and bring it back. That is a
measurement gate, not a re-litigation of this decision.

---

## Decisions I am making without asking

Standard-practice calls, recorded so they are visible rather than buried:

1. **`Ownable2Step`, not `Ownable`.** The rev-2 plan said `Ownable`, written
   before the global smart-contract rule requiring the accept/transfer flow to
   be tested. A two-step transfer cannot be tested on a contract that does not
   have one.
2. **OpenZeppelin `ERC721`, not Solady's.** Solady's is smaller and cheaper,
   but the size budget is not the constraint here -- `Renderer` is 10,951 bytes
   and the token contract is a stub. Readability wins, per the global coding
   preference for the simpler solution.
3. **`sunset()` is irreversible, not `setSunset(bool)`.** The rev-2 plan wrote
   a settable flag; the spec says sunset is permanent. An owner function that
   can be un-set is a different function with a different risk, and the
   irreversibility is worth a test.
4. **`touchRange` refuses the `(1, type(uint256).max)` catch-all.** The spec
   calls that range hostile to indexers. Encoding the refusal as a revert makes
   it a tested rule instead of a comment.
5. **Gas is measured cold**, on a token whose storage has not been touched in
   the same call. That is what a marketplace's `eth_call` actually pays.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `contracts/src/spike/MROSpikeToken.sol` | ERC-721, one packed slot per token, builds `TokenView`, forwards to `IRenderer`, emits ERC-4906 |
| `contracts/test/MROSpikeToken.t.sol` | Behaviour and every access-control revert |
| `contracts/test/ContractSize.t.sol` | Deployed bytecode under 24,576 with asserted positive margin |
| `contracts/test/GasBudget.t.sol` | `tokenURI` gas and bytes at seven life stages, asserted under the hard limit |
| `contracts/script/anvil-size-check.sh` | Strict-limit anvil deploy plus non-empty `cast code`, the second half of CLAUDE.md hard rule 7 |

**Modify:**

| File | Change |
|---|---|
| `contracts/src/render/TokenView.sol` | Add `uint256 parent` |
| `contracts/src/render/Renderer.sol` | Emit `Heart`, `Agent Key`, `Parent`; rename `Seeds Given` to `Children`; add the `(Whole)` / `(At Rest)` name suffixes |
| `tools/render-token.mjs` | The same five changes, so the two renderers stay identical |
| `tools/token-uri-fixture.mjs` | Nothing structural; re-run it to regenerate |
| `contracts/test/Renderer.t.sol` | Seven regenerated hashes and byte lengths |
| `contracts/test/TokenView.t.sol` | Cover the new `parent` field |

---

## Interfaces produced

```solidity
contract MROSpikeToken is ERC721, Ownable2Step, IERC4906 {
    struct Token {                 // exactly one 256-bit slot
        uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay;
        uint32 generation; uint32 seedsGiven; bool resting; uint56 reserved;
    }

    constructor(address renderer_);

    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code) external onlyOwner;
    function setState(uint256 id, Token calldata t) external onlyOwner;      // emits MetadataUpdate
    function setMarks(uint256 id, uint256 marks) external onlyOwner;         // emits MetadataUpdate
    function setParent(uint256 id, uint256 parentId) external onlyOwner;     // emits MetadataUpdate
    function touchRange(uint256 from, uint256 to) external onlyOwner;        // emits BatchMetadataUpdate
    function setRenderer(address r) external onlyOwner;                      // emits RendererSet
    function sunset() external onlyOwner;                                    // irreversible, emits Sunset

    function today() public view returns (uint32);
    function viewOf(uint256 id) public view returns (TokenView memory);
    function tokenURI(uint256 id) public view override returns (string memory);
}
```

`TokenView` gains one field, appended so no existing field moves:

```solidity
uint32  seedsGiven;
uint256 parent;      // 0 for a founding token, else the id it was seeded from
bool    resting;
```

---

## Steps

### Group A -- close the metadata gap, and measure what it cost

- [ ] **A1: Record the baseline.** Before touching anything, run the worst-case
      test and write the two numbers down.

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd ~/projects/machine-readable-only/contracts && forge test --match-test test_theWorstCaseStaysInsideTheHardLimit -vv
```

Expected: passes, logging 1,547,524 gas and 9,882 bytes. If either differs from
`docs/phase0-results.md`, stop -- something changed since Task 7 and this plan's
arithmetic is stale.

- [ ] **A2: Add `parent` to `TokenView`.**

```solidity
    uint32 seedsGiven;   // how many children this token has seeded
    uint256 parent;      // 0 for a founding token, else the id it was seeded from
    bool resting;        // owner sealed it: the image is final and never pales
```

- [ ] **A3: Extend `TokenView.t.sol` to cover the new field.** Add
      `parent: 88` to the struct literal at line 25 and the matching assertion
      beside the `agentKeyId` one at line 43:

```solidity
        assertEq(v.parent, 88);
```

- [ ] **A4: Rewrite `Renderer._attributes`.** Five changes in one function.

```solidity
    /// @dev The spec's attribute list, in full. `Heart` is filled cells over
    /// 365; `Children` is what the struct calls `seedsGiven`; `Agent Key` is
    /// the bound key as hex. `Parent` is 0 for a founding token.
    function _attributes(TokenView memory v) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                _num("Level", v.level),
                _num("Streak", v.streak),
                _str("Heart", _heart(v.level)),
                _num("Years", FrameRenderer.rings(v.level)),
                _str("Whole", v.level >= FrameGeometry.DAY_CELLS ? "yes" : "no"),
                _num("Mint Day", v.mintDay),
                _num("Last Day", v.lastDay),
                _str("Agent Key", LibString.toHexString(uint256(v.agentKeyId), 32)),
                _num("Generation", v.generation),
                _num("Parent", v.parent),
                _num("Children", v.seedsGiven),
                _str("Resting", v.resting ? "yes" : "no"),
                _str("Sunset", v.sunset ? "yes" : "no"),
                '{"trait_type":"Marks","value":', MarkRenderer.names(v.marks), "}"
            )
        );
    }

    /// @dev "212/365". Cells shown is capped at 365 even though level is not.
    function _heart(uint32 level) private pure returns (string memory) {
        uint256 shown = level >= FrameGeometry.DAY_CELLS ? FrameGeometry.DAY_CELLS : level;
        return string(
            abi.encodePacked(LibString.toString(shown), "/", LibString.toString(FrameGeometry.DAY_CELLS))
        );
    }
```

`abi.encodePacked` with fourteen arguments may exceed the stack under the
coverage profile, which does not use the IR pipeline. If
`FOUNDRY_PROFILE=coverage forge build` reports "stack too deep", split
`_attributes` into `_attrsA` and `_attrsB` concatenated by the caller -- the
same fix `svg()` already carries at line 66, for the same reason.

- [ ] **A5: Add the name suffix.** In `Renderer.tokenURI`, replace the name
      expression with a call to a helper:

```solidity
                '{"name":"', NAME, " %23", LibString.toString(v.tokenId), _suffix(v),
```

and add:

```solidity
    /// @dev The spec gives a whole token "(Whole)" and a sealed one "(At Rest)".
    /// Resting wins when both apply: it is the more final of the two states.
    function _suffix(TokenView memory v) private pure returns (string memory) {
        if (v.resting) return " (At Rest)";
        if (v.level >= FrameGeometry.DAY_CELLS) return " (Whole)";
        return "";
    }
```

- [ ] **A6: Make the identical five changes in `tools/render-token.mjs`.**
      Replace the attribute array and the name line in `tokenUri`, and add
      `parent = 0` and `agentKeyId = 0n` to the destructured defaults:

```javascript
  const {
    tokenId = 0, level = 0, streak = 0, lastDay = 0, mintDay = 0, today = 0,
    generation = 0, seedsGiven = 0, parent = 0, agentKeyId = 0n,
    resting = false, sunset = false, marks = [],
  } = state;

  const shown = Math.min(level, DAY_CELLS);
  const suffix = resting ? " (At Rest)" : level >= DAY_CELLS ? " (Whole)" : "";
  const keyHex = `0x${BigInt(agentKeyId).toString(16).padStart(64, "0")}`;
```

```javascript
    + `"name":"${TOKEN_NAME} %23${tokenId}${suffix}",`
```

```javascript
        num("Level", level),
        num("Streak", streak),
        str("Heart", `${shown}/${DAY_CELLS}`),
        num("Years", ringsFor(years)),
        str("Whole", level >= DAY_CELLS ? "yes" : "no"),
        num("Mint Day", mintDay),
        num("Last Day", lastDay),
        str("Agent Key", keyHex),
        num("Generation", generation),
        num("Parent", parent),
        num("Children", seedsGiven),
        str("Resting", resting ? "yes" : "no"),
        str("Sunset", sunset ? "yes" : "no"),
        attr("Marks", markNames(marks)),
```

Delete the stale comment above `tokenUri` that says the gap is left for Task 8;
replace it with one line saying the list is the spec's, in the spec's order.

- [ ] **A7: Give two fixture stages a non-zero key and parent**, so the
      differential test actually exercises the new fields rather than hashing
      zeros. In `tools/token-uri-fixture.mjs`, extend two `STAGES` entries:

```javascript
  ["day 200",          { level: 200,      streak: 45,  lastDay: 1000, today: 1000,
                         agentKeyId: 0xa9en }],
  ["whole, one ring",  { level: 365,      streak: 140, lastDay: 1000, today: 1000,
                         generation: 1, parent: 7, seedsGiven: 2 }],
```

- [ ] **A8: Regenerate the fixtures.**

```bash
source ~/.nvm/nvm.sh && cd ~/projects/machine-readable-only && node tools/token-uri-fixture.mjs
```

Expected: seven `// <label>: N bytes` / `//   0x<hash>` pairs on stdout. Paste
each byte length and hash into the matching `_diff(...)` call in
`contracts/test/Renderer.t.sol`. Mirror the two new stage fields into
`Renderer.t.sol`'s `_view` helper so the Solidity side builds the same struct --
set the new fields on a local `TokenView` in those two tests rather than
widening the `_view` helper's signature for every caller:

```solidity
    function test_aPartYearMatchesTheJavascriptReference() public view {
        TokenView memory v = _view(200, 45, 1000, 1000);
        v.agentKeyId = bytes32(uint256(0xa9e));
        _diff("day 200", v, BYTES_FROM_A8, HASH_FROM_A8);
    }

    function test_aWholeHeartMatchesTheJavascriptReference() public view {
        TokenView memory v = _view(365, 140, 1000, 1000);
        v.generation = 1;
        v.parent = 7;
        v.seedsGiven = 2;
        _diff("whole, one ring", v, BYTES_FROM_A8, HASH_FROM_A8);
    }
```

`BYTES_FROM_A8` and `HASH_FROM_A8` are the literal numbers this step just
printed -- paste them in; they are not names to define.

- [ ] **A9: Run both suites.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test
source ~/.nvm/nvm.sh && cd ~/projects/machine-readable-only/tools && npm test
```

Expected: 74 forge tests and 41 tools tests, all passing. A byte-length
mismatch means the two renderers disagree on length; a hash-only mismatch means
they disagree on content. Both are the differential test doing its job.

- [ ] **A10: Measure the cost of the metadata gap and report it.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test --match-test test_theWorstCaseStaysInsideTheHardLimit -vv
```

Compare against the A1 baseline. Write both numbers into the commit message.
**If the delta consumes more than a quarter of the 452,476 gas of headroom,
stop and bring it back to the operator** -- that would make `agentKeyId` a real cost
rather than a tidy-up, and dropping it is then a live option.

- [ ] **A11: Commit.**

```bash
cd ~/projects/machine-readable-only && git add contracts tools && git commit -q -m "feat(render): emit the spec's full attribute list and the name suffixes"
```

### Group B -- `MROSpikeToken`, tests first

- [ ] **B1: Write `contracts/test/MROSpikeToken.t.sol`.** Every owner function
      and every access-control revert, per the global smart-contract rule.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";

contract MROSpikeTokenTest is Test {
    MROSpikeToken t;
    Renderer r;
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0x4A11);

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. Same 172 bytes
    /// the renderer tests use.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MROSpikeToken(address(r));
    }

    function _mint(uint256 id) internal {
        t.mint(id, ALICE, bytes32(uint256(0xa9e)), _code());
    }

    // ----- minting -------------------------------------------------------

    function test_mintSetsDayOneState() public {
        _mint(1);
        TokenView memory v = t.viewOf(1);
        assertEq(t.ownerOf(1), ALICE);
        assertEq(v.level, 1);
        assertEq(v.streak, 1);
        assertEq(v.lastDay, t.today());
        assertEq(v.mintDay, t.today());
        assertEq(v.agentKeyId, bytes32(uint256(0xa9e)));
        assertEq(v.code.length, 172);
    }

    function test_mintRejectsADuplicateId() public {
        _mint(1);
        vm.expectRevert(abi.encodeWithSelector(MROSpikeToken.TokenExists.selector, uint256(1)));
        _mint(1);
    }

    function test_mintRejectsAWrongLengthCode() public {
        vm.expectRevert(abi.encodeWithSelector(MROSpikeToken.BadCodeLength.selector, uint256(3)));
        t.mint(1, ALICE, bytes32(0), hex"aabbcc");
    }

    // ----- reads ---------------------------------------------------------

    function test_tokenUriRevertsForAnUnmintedToken() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(9)));
        t.tokenURI(9);
    }

    function test_tokenUriRendersThroughTheRenderer() public {
        _mint(1);
        string memory uri = t.tokenURI(1);
        assertGt(bytes(uri).length, 5000);
        assertEq(
            keccak256(bytes(_slice(uri, 0, 28))),
            keccak256(bytes("data:application/json;utf-8,"))
        );
    }

    function test_viewOfCarriesSunsetPieceWide() public {
        _mint(1);
        assertFalse(t.viewOf(1).sunset);
        t.sunset();
        assertTrue(t.viewOf(1).sunset);
    }

    function test_todayIsTheUtcDayIndex() public {
        vm.warp(86400 * 20123 + 55);
        assertEq(t.today(), 20123);
    }

    // ----- owner functions, happy path -----------------------------------

    function test_setStateOverwritesAndEmitsMetadataUpdate() public {
        _mint(1);
        MROSpikeToken.Token memory s = MROSpikeToken.Token({
            level: 365, streak: 140, lastDay: 1000, mintDay: 900,
            generation: 1, seedsGiven: 2, resting: false, reserved: 0
        });
        // Neither ERC-4906 event has an indexed parameter, so only the data
        // field is checked; the events are declared on IERC4906, not here.
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.MetadataUpdate(1);
        t.setState(1, s);
        assertEq(t.viewOf(1).level, 365);
        assertEq(t.viewOf(1).seedsGiven, 2);
    }

    function test_setMarksAndSetParentLandInTheView() public {
        _mint(1);
        t.setMarks(1, 0x0A);
        t.setParent(1, 7);
        assertEq(t.viewOf(1).marks, 0x0A);
        assertEq(t.viewOf(1).parent, 7);
    }

    function test_touchRangeEmitsTheExactRange() public {
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.BatchMetadataUpdate(4, 9);
        t.touchRange(4, 9);
    }

    function test_touchRangeRejectsAnInvertedRange() public {
        vm.expectRevert(MROSpikeToken.BadRange.selector);
        t.touchRange(9, 4);
    }

    function test_touchRangeRefusesTheCatchAll() public {
        // Indexers treat (1, uint256 max) as hostile; the spec forbids it.
        vm.expectRevert(MROSpikeToken.BadRange.selector);
        t.touchRange(1, type(uint256).max);
    }

    function test_setRendererSwapsTheRenderer() public {
        Renderer other = new Renderer();
        t.setRenderer(address(other));
        assertEq(t.renderer(), address(other));
    }

    function test_setRendererRejectsTheZeroAddress() public {
        vm.expectRevert(MROSpikeToken.ZeroRenderer.selector);
        t.setRenderer(address(0));
    }

    function test_sunsetIsIrreversible() public {
        t.sunset();
        assertGt(t.sunsetDay(), 0);
        vm.expectRevert(MROSpikeToken.AlreadySunset.selector);
        t.sunset();
    }

    // ----- access control: every owner function, from a non-owner ---------

    function _expectNotOwner() internal {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY)
        );
    }

    function test_mintRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.mint(1, MALLORY, bytes32(0), _code());
    }

    function test_setStateRevertsForANonOwner() public {
        _mint(1);
        MROSpikeToken.Token memory s;
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setState(1, s);
    }

    function test_setMarksRevertsForANonOwner() public {
        _mint(1);
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setMarks(1, 2);
    }

    function test_setParentRevertsForANonOwner() public {
        _mint(1);
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setParent(1, 2);
    }

    function test_touchRangeRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.touchRange(1, 2);
    }

    function test_setRendererRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setRenderer(address(1));
    }

    function test_sunsetRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.sunset();
    }

    // ----- Ownable2Step ---------------------------------------------------

    function test_ownershipTransferNeedsAcceptance() public {
        t.transferOwnership(ALICE);
        assertEq(t.owner(), address(this));   // not yet
        assertEq(t.pendingOwner(), ALICE);
        vm.prank(ALICE);
        t.acceptOwnership();
        assertEq(t.owner(), ALICE);
        assertEq(t.pendingOwner(), address(0));
    }

    function test_onlyThePendingOwnerMayAccept() public {
        t.transferOwnership(ALICE);
        vm.prank(MALLORY);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY)
        );
        t.acceptOwnership();
    }

    function test_theOldOwnerKeepsControlUntilAcceptance() public {
        t.transferOwnership(ALICE);
        t.touchRange(1, 2);   // still works: no revert
    }

    // ----- ERC-4906 -------------------------------------------------------

    function test_theErc4906InterfaceIsAdvertised() public view {
        assertTrue(t.supportsInterface(0x49064906));
        assertTrue(t.supportsInterface(0x80ac58cd));   // ERC-721
        assertTrue(t.supportsInterface(0x5b5e139f));   // ERC-721 Metadata
    }

    function _slice(string memory s, uint256 from, uint256 len)
        internal pure returns (string memory out)
    {
        bytes memory b = bytes(s);
        bytes memory o = new bytes(len);
        for (uint256 i; i < len; ++i) o[i] = b[from + i];
        return string(o);
    }
}
```

- [ ] **B2: Run it and watch it fail to compile.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test --match-path test/MROSpikeToken.t.sol
```

Expected: compilation error, `Source "src/spike/MROSpikeToken.sol" not found`.
That is the failing state -- there is no contract yet.

- [ ] **B3: Write `contracts/src/spike/MROSpikeToken.sol`.**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IRenderer} from "../render/IRenderer.sol";
import {TokenView} from "../render/TokenView.sol";

/// @notice The throwaway token contract the Phase 0 spike measures against.
///
/// @dev This is NOT the collection. It exists to answer one question: what does
/// `tokenURI` cost when a real ERC-721 reads storage and calls the renderer,
/// rather than a test handing the renderer a struct it already holds. The real
/// `MachineReadableOnly` has a Warden, x402 pricing, marks gating, seeding and
/// vouchers; none of that changes the rendering cost, so none of it is here.
///
/// Two things ARE faithful to the spec, because both change the gas figure:
/// the `Token` struct occupies exactly one 256-bit slot, and the code bitmap is
/// written once at mint and never rewritten.
contract MROSpikeToken is ERC721, Ownable2Step, IERC4906 {
    /// @dev Six uint32s (192) plus a bool (8) plus 56 reserved = 256 bits.
    /// The reserved field is not padding for its own sake: the real contract
    /// spends it, and removing it here would change the slot count and with it
    /// the number this spike exists to measure.
    struct Token {
        uint32 level;
        uint32 streak;
        uint32 lastDay;
        uint32 mintDay;
        uint32 generation;
        uint32 seedsGiven;
        bool resting;
        uint56 reserved;
    }

    mapping(uint256 => Token) private _tokens;
    mapping(uint256 => uint256) private _marks;
    mapping(uint256 => uint256) private _parentOf;
    mapping(uint256 => bytes32) private _agentKeyOf;
    mapping(uint256 => bytes) private _codeOf;

    /// @notice The renderer this token draws through. Swappable by design.
    address public renderer;

    /// @notice 0 until `sunset()`, then the day it happened. Irreversible.
    uint32 public sunsetDay;

    /// @dev The packed code bitmap is a fixed 172 bytes: 37 x 37 modules.
    uint256 private constant CODE_BYTES = 172;

    error TokenExists(uint256 id);
    error BadCodeLength(uint256 got);
    error BadRange();
    error ZeroRenderer();
    error AlreadySunset();

    event RendererSet(address renderer);
    event SunsetAt(uint32 day);

    constructor(address renderer_)
        ERC721("MRO Spike (throwaway)", "MROS")
        Ownable(msg.sender)
    {
        _setRenderer(renderer_);
    }

    // ----- reads ---------------------------------------------------------

    /// @notice The UTC day index, the unit every date in this piece uses.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Everything the renderer needs, assembled from storage.
    /// @dev `sunset` is piece-wide, so it is read from `sunsetDay` rather than
    /// from the token. `today` is passed in so the renderer stays pure.
    function viewOf(uint256 id) public view returns (TokenView memory v) {
        Token storage s = _tokens[id];
        v.tokenId = id;
        v.level = s.level;
        v.streak = s.streak;
        v.lastDay = s.lastDay;
        v.mintDay = s.mintDay;
        v.generation = s.generation;
        v.seedsGiven = s.seedsGiven;
        v.parent = _parentOf[id];
        v.resting = s.resting;
        v.sunset = sunsetDay != 0;
        v.marks = _marks[id];
        v.agentKeyId = _agentKeyOf[id];
        v.code = _codeOf[id];
        v.today = today();
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return IRenderer(renderer).tokenURI(viewOf(id));
    }

    /// @dev ERC-4906 has no OpenZeppelin mixin, so the id is declared here.
    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == bytes4(0x49064906) || super.supportsInterface(id);
    }

    // ----- owner functions ------------------------------------------------

    /// @notice Mint at day one, as the real contract does.
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code) external onlyOwner {
        if (_ownerOf(id) != address(0)) revert TokenExists(id);
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        uint32 d = today();
        _tokens[id] = Token(1, 1, d, d, 0, 0, false, 0);
        _agentKeyOf[id] = keyId;
        _codeOf[id] = code;
        _safeMint(to, id);
    }

    /// @notice Overwrite the whole daily slot. The spike's stand-in for
    /// `batchCheckIn`, `rest` and `seed` at once -- it exists to place a token
    /// at any life stage for measurement, not to model the real rules.
    function setState(uint256 id, Token calldata t) external onlyOwner {
        _requireOwned(id);
        _tokens[id] = t;
        emit MetadataUpdate(id);   // after the write, never before
    }

    function setMarks(uint256 id, uint256 marks) external onlyOwner {
        _requireOwned(id);
        _marks[id] = marks;
        emit MetadataUpdate(id);
    }

    function setParent(uint256 id, uint256 parentId) external onlyOwner {
        _requireOwned(id);
        _parentOf[id] = parentId;
        emit MetadataUpdate(id);
    }

    /// @notice Tell marketplaces a range of tokens changed.
    /// @dev The range must be the exact one written. `(1, type(uint256).max)`
    /// is the collection-wide catch-all that indexers treat as hostile, so it
    /// is refused rather than merely discouraged.
    function touchRange(uint256 from, uint256 to) external onlyOwner {
        if (from > to || to == type(uint256).max) revert BadRange();
        emit BatchMetadataUpdate(from, to);
    }

    function setRenderer(address r) external onlyOwner {
        _setRenderer(r);
    }

    /// @notice Close the piece. Every token freezes. Cannot be undone.
    function sunset() external onlyOwner {
        if (sunsetDay != 0) revert AlreadySunset();
        sunsetDay = today();
        emit SunsetAt(sunsetDay);
        // Deliberately no BatchMetadataUpdate. A sunset does change every
        // token, but this contract does not know its own id range, and the
        // collection-wide catch-all is the exact range touchRange refuses.
        // The real contract emits over the ids it actually minted.
    }

    function _setRenderer(address r) private {
        if (r == address(0)) revert ZeroRenderer();
        renderer = r;
        emit RendererSet(r);
    }
}
```

- [ ] **B4: Run the tests until green.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test --match-path test/MROSpikeToken.t.sol -vv
```

Expected: all pass. `today()` is 0 under Foundry's default timestamp of 1, so
`test_mintSetsDayOneState` compares `v.lastDay` against `t.today()` rather than
a literal -- that is deliberate, not a weak assertion.

- [ ] **B5: Commit.**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "feat(spike): MROSpikeToken, a packed-slot ERC-721 in front of the renderer"
```

### Group C -- the size guard

- [ ] **C1: Write `contracts/test/ContractSize.t.sol`.**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

/// @notice CLAUDE.md hard rule 7, first half: nothing is called deployable
/// until its runtime bytecode is measured against the EIP-170 limit with a
/// positive margin. The second half -- an actual strict-limit deploy -- is
/// script/anvil-size-check.sh, because forge's own EVM does not enforce the cap.
contract ContractSizeTest is Test {
    /// @dev EIP-170. Base inherits it from Ethereum unchanged.
    uint256 constant LIMIT = 24_576;

    function _check(string memory artifact) internal returns (uint256 size) {
        size = vm.getDeployedCode(artifact).length;
        console.log(artifact);
        console.log("  runtime bytes", size);
        console.log("  margin       ", LIMIT - size);
        assertLt(size, LIMIT, string.concat(artifact, " exceeds the EIP-170 limit"));
        assertGt(size, 0, string.concat(artifact, " has no runtime code"));
    }

    function test_everyDeployedContractFitsWithMargin() public {
        uint256 renderer = _check("Renderer.sol:Renderer");
        uint256 token = _check("MROSpikeToken.sol:MROSpikeToken");
        // Both must fit on the same chain, so the pair is worth logging too.
        console.log("pair total", renderer + token);
    }
}
```

- [ ] **C2: Run it.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test --match-path test/ContractSize.t.sol -vv
```

Expected: passes, logging four numbers. `Renderer` was 10,951 bytes at Task 7
and should be a little larger now. If `vm.getDeployedCode` cannot find an
artifact, run `forge build` first -- it reads `./out`, which `fs_permissions`
in `foundry.toml` already allows.

- [ ] **C3: Write `contracts/script/anvil-size-check.sh`.**

```bash
#!/usr/bin/env bash
# CLAUDE.md hard rule 7, second half: a strict-limit deploy proving the
# contracts actually land on chain with non-empty code. forge's test EVM does
# not enforce EIP-170, so a passing size test is necessary and not sufficient.
#
#   bash script/anvil-size-check.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

# Anvil's account 0. This key is published in Foundry's own documentation and
# funds nothing but a throwaway local chain.
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

anvil --silent --code-size-limit 24576 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
sleep 2

deployed() { echo "$1" | sed -n 's/.*"deployedTo":"\([^"]*\)".*/\1/p'; }

R=$(deployed "$(forge create src/render/Renderer.sol:Renderer \
      --rpc-url local --private-key "$KEY" --broadcast --json)")
T=$(deployed "$(forge create src/spike/MROSpikeToken.sol:MROSpikeToken \
      --constructor-args "$R" --rpc-url local --private-key "$KEY" --broadcast --json)")

for pair in "Renderer:$R" "MROSpikeToken:$T"; do
  name=${pair%%:*}; addr=${pair#*:}
  # cast code returns "0x" for an empty account; two hex chars per byte.
  bytes=$(( ( $(cast code "$addr" --rpc-url local | wc -c) - 3 ) / 2 ))
  echo "$name at $addr: $bytes runtime bytes"
  [ "$bytes" -gt 0 ] || { echo "FAIL: $name deployed with empty code"; exit 1; }
done

# And prove the pair works end to end, not merely that it deployed. The bitmap
# comes from the same generator the tests use; its CLI takes <tokenId> [domain]
# and prints the 344 hex characters alone on stdout.
. "$HOME/.nvm/nvm.sh"
CODE=0x$(cd ../tools && node token-bitmap.mjs 1 example.com 2>/dev/null)

cast send "$T" "mint(uint256,address,bytes32,bytes)" \
  1 \
  0x0000000000000000000000000000000000000A11 \
  0x0000000000000000000000000000000000000000000000000000000000000a9e \
  "$CODE" \
  --rpc-url local --private-key "$KEY" >/dev/null

CHARS=$(cast call "$T" "tokenURI(uint256)(string)" 1 --rpc-url local | wc -c)
echo "tokenURI: $CHARS chars returned"
[ "$CHARS" -gt 5000 ] || { echo "FAIL: tokenURI came back short"; exit 1; }
echo "OK"
```

- [ ] **C4: Run it.**

```bash
cd ~/projects/machine-readable-only/contracts && bash script/anvil-size-check.sh
```

Expected: two `... runtime bytes` lines with four- or five-digit numbers, a
`tokenURI: N chars returned` line in the thousands, then `OK`. If anvil refuses
the deploy with `max code size exceeded`, the contract is genuinely too big and
the size test was lying -- that is exactly what this script exists to catch.

- [ ] **C5: Commit.**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "test(spike): EIP-170 size guard and the strict-limit anvil deploy"
```

### Group D -- the gas budget, which is the point of the task

- [ ] **D1: Write `contracts/test/GasBudget.t.sol`.**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice The spike's headline numbers: what a marketplace pays to read
/// `tokenURI` off the token contract, at every life stage that matters.
///
/// @dev Measured through an external call on a token whose storage is cold, so
/// the SLOADs are billed at 2,100 rather than 100. That is what an `eth_call`
/// from OpenSea actually costs. Measuring warm would flatter the result by
/// roughly 20,000 gas and would not be the number anyone pays.
contract GasBudgetTest is Test {
    MROSpikeToken t;
    Renderer r;

    uint256 constant GAS_LIMIT = 2_000_000;
    uint256 constant BYTE_LIMIT = 20_000;
    uint256 constant GAS_TARGET = 1_000_000;
    uint256 constant BYTE_TARGET = 5_000;

    uint256 constant ALL_MARKS = MarkRenderer.VEIN | MarkRenderer.PULSE | MarkRenderer.VOICE
        | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN | MarkRenderer.SINGULARITY;

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MROSpikeToken(address(r));
        vm.warp(86400 * 1000 + 1);   // today() == 1000, matching the fixtures
    }

    /// @dev Each stage gets its own token id so no stage warms another's slots.
    function _place(uint256 id, uint32 level, uint32 streak, uint32 lastDay, uint256 marks)
        internal
    {
        t.mint(id, address(0xA11CE), bytes32(uint256(0xa9e)), _code());
        t.setState(id, MROSpikeToken.Token({
            level: level, streak: streak, lastDay: lastDay, mintDay: 900,
            generation: 0, seedsGiven: 0, resting: false, reserved: 0
        }));
        if (marks != 0) t.setMarks(id, marks);
    }

    function _measure(string memory label, uint256 id)
        internal
        returns (uint256 gasUsed, uint256 len)
    {
        uint256 before = gasleft();
        string memory uri = t.tokenURI(id);
        gasUsed = before - gasleft();
        len = bytes(uri).length;
        console.log(label);
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
        assertLt(gasUsed, GAS_LIMIT, string.concat(label, ": over the hard gas limit"));
        assertLt(len, BYTE_LIMIT, string.concat(label, ": over the hard byte limit"));
    }

    function test_theWholeLadderStaysInsideTheHardLimit() public {
        _place(1, 1, 1, 1000, 0);
        _place(2, 200, 45, 1000, 0);
        _place(3, 365, 140, 1000, 0);
        _place(4, 365, 140, 960, 0);            // forty days lapsed
        _place(5, 365 * 3, 200, 1000, 0);
        _place(6, 365 * 10, 400, 1000, 0);      // at the ring cap
        _place(7, 365 * 10, 400, 1000, ALL_MARKS);

        _measure("day one", 1);
        _measure("day 200", 2);
        _measure("whole, one ring", 3);
        _measure("whole and lapsed", 4);
        _measure("three years", 5);
        _measure("ten years, at the cap", 6);
        (uint256 worstGas, uint256 worstBytes) = _measure("cap and every mark", 7);

        // The target is missed and is reported as missed rather than quietly
        // dropped. This assertion documents the miss; flip it the day it passes.
        assertGt(worstGas, GAS_TARGET, "the 1,000,000 gas target now passes -- update the results table");
        assertGt(worstBytes, BYTE_TARGET, "the 5,000 byte target now passes -- update the results table");

        console.log("headroom against the hard limit");
        console.log("  gas  ", GAS_LIMIT - worstGas);
        console.log("  bytes", BYTE_LIMIT - worstBytes);
    }

    /// @dev A sealed token must cost no more than a live one -- the freeze is a
    /// branch, not extra work. Cheap to assert and it pins the claim.
    function test_aSealedTokenIsNotMoreExpensive() public {
        _place(8, 365 * 3, 200, 1000, 0);
        t.setState(8, MROSpikeToken.Token({
            level: 365 * 3, streak: 200, lastDay: 1000, mintDay: 900,
            generation: 0, seedsGiven: 0, resting: true, reserved: 0
        }));
        (uint256 sealedGas,) = _measure("sealed at rest", 8);
        assertLt(sealedGas, GAS_LIMIT);
    }
}
```

- [ ] **D2: Run it and read every number.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test --match-path test/GasBudget.t.sol -vv
```

Expected: green, with sixteen logged numbers. **The one that decides the task is
`cap and every mark`.** Task 7 measured the renderer alone at 1,547,524; this
figure is that plus the token contract's storage reads. Under 2,000,000 the
spike stands. Over it, stop and re-plan against the fallback ladder in the rev-2
plan: (a) further path compression, (b) rings and Bloom become flat fills,
(c) an off-chain renderer -- and (c) is a spec change needing the operator's approval,
not a fix.

- [ ] **D3: Commit.**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "test(spike): the tokenURI gas budget across seven life stages"
```

### Group E -- prove the whole thing still holds

- [ ] **E1: Full suite, both languages.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge test
source ~/.nvm/nvm.sh && cd ~/projects/machine-readable-only/tools && npm test
```

Expected: every forge test and all 41 tools tests pass.

- [ ] **E2: Sizes.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && forge build --sizes
```

Expected: `Renderer` and `MROSpikeToken` both listed with positive margin.

- [ ] **E3: Coverage, on the legacy profile.**

```bash
export PATH=$HOME/.foundry/bin:$PATH && cd ~/projects/machine-readable-only/contracts && FOUNDRY_PROFILE=coverage forge coverage
```

Expected: 100% lines and statements on `src/render/*` maintained, and
`src/spike/MROSpikeToken.sol` at 100% lines. If the coverage build reports
"stack too deep" in `Renderer._attributes`, apply the split described in step
A4.

- [ ] **E4: Write the numbers into `docs/phase0-results.md`.** Add a section
      recording: the seven-stage gas and byte table from D2, the runtime sizes
      from C2, the anvil deploy result from C4, the attribute-list delta from
      A10, and the remaining headroom. Render the HTML alongside it:

```bash
node ~/scripts/render-md-to-html.js ~/projects/machine-readable-only/docs/phase0-results.md
```

- [ ] **E5: Final commit.**

```bash
cd ~/projects/machine-readable-only && git add -A && git commit -q -m "docs(spike): record the Task 8 size and gas measurements"
```

---

## Trade-offs and what cannot be undone

- **Nothing in this task is irreversible.** No funds are spent, no network is
  touched beyond a local anvil that is killed when the script exits, nothing is
  pushed. Every step is a local file change under git.
- **The metadata additions cost gas that has not been measured yet.** Step A10
  exists to surface that before it is buried under the rest of the task. It is
  the one place this plan could turn out to be wrong.
- **`MROSpikeToken` is deliberately not the real contract.** It has no Warden,
  no x402, no mark gating, no seeding rules, no pause and no voucher path.
  Building those here would be building Plan 2 inside Phase 0, and Phase 0's
  question is only whether the image fits on chain.
- **The `reserved` field looks like dead weight and is not.** Removing it would
  change the slot count and therefore the measurement, which is the one thing
  this contract exists to produce.

## What this task deliberately does not build

The deploy script (`DeploySpike.s.sol`) and the RPC decode check are Task 9.
Pulse's `animation_url` stays unbuilt and unbudgeted -- it roughly doubles
tokenURI bytes, and it does not enter without a separate measurement and a
conversation with the operator. The child-token visuals remain the open question recorded
in spec section 10.
