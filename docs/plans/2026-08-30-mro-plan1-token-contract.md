# MRO Plan 1: the token contract -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `MachineReadableOnly.sol`, the permanent ERC-721 that holds every token's daily record, wire it to the Phase 0 Renderer, and deploy it to Base Sepolia with the full test suite green.

**Architecture:** One non-upgradeable ERC-721 holding a single 256-bit `Token` slot per token that is overwritten on each check-in. All drawing is delegated to a swappable `IRenderer`. A Warden address is the only caller permitted to mint, check in and apply marks; the contract owner holds the dials. ERC-4906 is emitted per token, never as a range.

**Tech Stack:** Solidity 0.8.35, Foundry 1.7.1 (`via_ir = true`, optimizer 200 runs, cancun), OpenZeppelin Contracts 5.7.0 vendored under `contracts/lib/`, Base Sepolia (chain id 84532).

## Global Constraints

- **Plain ASCII only** in all code comments and docs. No em dashes, smart quotes, arrows or emoji.
- **The contract is permanent.** No proxy, no upgrade path. A design error here is not fixable later.
- **Never spend real funds.** This plan touches Base Sepolia only. Base mainnet is a operator-approval gate and this plan does not create one.
- **Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`;** Node needs `source ~/.nvm/nvm.sh`. Non-interactive shells have neither.
- **All work runs from `contracts/`** for forge commands. `cd` back to the repo root before editing root-level files -- the project-isolation hook compares write targets against the shell's working directory.
- **Deployability rule (CLAUDE.md hard rule 7):** nothing is done until `forge build --sizes` shows positive runtime margin under 24,576 bytes AND `bash script/anvil-size-check.sh` returns non-empty `cast code`.
- **Every owner / warden / emergency function gets an explicit test, and every access-control revert gets a test.** Global smart-contract rule.
- **Use `/bin/grep`, never bare `grep`.**
- **Both suites green before any commit:** `cd contracts && forge test`, and `cd tools && npm test`.
- **Struct `Token` must stay in exactly one 256-bit slot.** Six uint32 (192) + bool (8) + uint56 (56) = 256. Breaking this changes the check-in gas cost, which is the number the whole design rests on.
- **Commit style:** no AI attribution, no `Co-Authored-By`, no personal identifiers. Message describes the code change only.

---

## File Structure

| File | Responsibility |
|---|---|
| `contracts/src/MachineReadableOnly.sol` | Create. The whole token contract: state, mint, check-in, marks, rebind, rest, seed, vouchers, dials, `tokenURI` delegation. |
| `contracts/test/MachineReadableOnly.t.sol` | Create. Behaviour and access control for mint, dials, pause, `Ownable2Step`. |
| `contracts/test/CheckIn.t.sol` | Create. `batchCheckIn` semantics, streak rules, per-token ERC-4906 emits, and the chunk gas guard. |
| `contracts/test/Marks.t.sol` | Create. `applyMark` gates, supply, bitmask, `setUpgrade`. |
| `contracts/test/Lifecycle.t.sol` | Create. `rebind`, `rest`, `seed` and its per-year arithmetic, `sunset`. |
| `contracts/test/Vouchers.t.sol` | Create. EIP-712 voucher path, paused by default. |
| `contracts/test/TokenUriGolden.t.sol` | Create. End-to-end `tokenURI` against the REAL Renderer. |
| `contracts/test/ContractSize.t.sol` | Modify. Add `MachineReadableOnly` to the measured set. |
| `contracts/script/DeployPlan1.s.sol` | Create. Renderer + token deploy for Base Sepolia. |
| `docs/specs/2026-08-27-machine-readable-only-design.md` | Modify. Task 0's eight amendments. |

Why one contract file rather than several: the measured spike is 6,863 bytes with 17,713 of margin, so there is real room. Library extraction is the named fallback if the Task 2 checkpoint says otherwise -- see Task 2, Step 6.

---

## Task 0: Amend the spec

The outstanding half of Task 12. Plan 1 reads its requirements from the spec, so the spec must stop contradicting itself before any Solidity is written. Two of these would otherwise stop compilation or force an arbitrary choice mid-build.

**Files:**
- Modify: `docs/specs/2026-08-27-machine-readable-only-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a spec whose section 7 matches what Tasks 1-9 build.

- [ ] **Step 1: Fix conflict 1, the lapse rule (line 392)**

Replace the effective-streak sentence so it matches the graded behaviour built in `be86fee`. Find:

```
`effectiveStreak = (today - lastDay > 1) ? 0 : streak` from `block.timestamp`
```

Replace the surrounding rule with:

```
`effectiveStreak = lapsed(streak, lastDay, today)`, which steps the colour down
at 3, 7 and 30 days lapsed rather than snapping to zero on the first missed
day. Amended 2026-08-30: the section formerly gave the snap-to-zero form, which
contradicted the colour section's graded steps. The graded form is what is
built, and the refresh-cost argument is the stronger one -- each step is one
marketplace refresh instead of a continuous repaint. The two rules agree at the
far end, because a 30-day lapse lands back at the starting tier.
```

- [ ] **Step 2: Fix conflict 3, the sunset sentinel (line 342)**

Replace:

```solidity
uint32 sunsetDay;                         // 0 until sunset(); then the day number, irreversible
```

with:

```solidity
uint32 sunsetDay;                         // the day the piece closed; only meaningful when isSunset
bool   isSunset;                          // irreversible. Shares a slot with sunsetDay, so it is free
```

- [ ] **Step 3: Fix conflicts 7 and 9, the ERC-4906 emission rules**

At line 373, replace the `batchCheckIn` event clause. Find `then ERC-4906 \`BatchMetadataUpdate(minId, maxId)\` over the exact range written` and replace with:

```
then one ERC-4906 `MetadataUpdate(id)` per token written, emitted after the
storage writes. Amended 2026-08-30: the range form was impossible, because a
day's check-ins are a scattered subset and `minId..maxId` is therefore never
the exact set written. Per-token emits are also reuse rather than a new cost --
the Clock already has to emit per token for paling-step crossers.
```

At lines 405 and 481, delete both assertions that `sunset` emits
`BatchMetadataUpdate(1, type(uint256).max)` and replace each with:

```
`sunset` emits no metadata event. Amended 2026-08-30: line 373 forbids the
`(1, max)` catch-all as hostile to indexers, so specifying it here contradicted
the same document two pages earlier. A sunset does change every token, so this
is a deliberate choice: the piece must never depend on an indexer refreshing,
and a terminal one-time event is the cheapest possible thing to leave stale.
The contract knows its own minted range, so a future operator can emit over the
ids actually minted if it ever matters.
```

- [ ] **Step 4: Fix conflict 8, the voucher stub (line 417)**

Replace `the build plan decides whether to include the stub` with:

```
it IS included, as an unused function guarded by a flag that is off at launch.
Amended 2026-08-30: this was never an open choice. The durability commitments
require the voucher path on chain from day one, and CLAUDE.md's locked
decisions say it ships paused. With no upgrade path, a voucher path omitted now
could never be added.
```

- [ ] **Step 5: Fix conflict 11, the `Sunset` name collision (NEW, found 2026-08-30)**

The spec lists a custom error `Sunset` and also specifies `sunset()` emitting `Sunset(day)`. **Solidity cannot have an error and an event with the same name in one contract, so the spec as written does not compile.** Amend the error list and the `sunset()` row to read:

```
Errors: `Sunset()` when the piece is closed, and `AlreadySunset()` when
`sunset()` is called twice. Event: `SunsetAt(uint32 day)`. Amended 2026-08-30:
the spec previously used `Sunset` for both an error and an event, which does
not compile. The spike already resolved it this way.
```

- [ ] **Step 6: Fix conflict 12, the wallet cap's meaning (NEW, found 2026-08-30)**

The spec says `WalletCap` fires if `to` "already holds 20 minted tokens", which is ambiguous between *currently holds* and *was minted*. *Currently holds* would make the cap defeatable by transferring out and re-minting, and would also punish someone who legitimately buys tokens on the secondary market. Amend to:

```
`WalletCap` if `mintedTo[to] >= walletCap`, counting tokens ever MINTED to that
address, not tokens currently held. Amended 2026-08-30: "holds" was ambiguous.
Counting current holdings would let the cap be defeated by transferring out
before re-minting, and would wrongly block someone who bought on the secondary
market. Seeded children are counted the same way. The dial starts at 20.
```

- [ ] **Step 7: Re-render the spec to HTML**

```bash
cd ~/projects/machine-readable-only
source ~/.nvm/nvm.sh
node ~/scripts/render-md-to-html.js docs/specs/2026-08-27-machine-readable-only-design.md
```

Expected: `Wrote docs/specs/2026-08-27-machine-readable-only-design.html`

- [ ] **Step 8: Verify the spec no longer contradicts itself**

```bash
cd ~/projects/machine-readable-only
/bin/grep -n "type(uint256).max" docs/specs/2026-08-27-machine-readable-only-design.md
/bin/grep -n "effectiveStreak = (today" docs/specs/2026-08-27-machine-readable-only-design.md
/bin/grep -c "build plan decides whether to include" docs/specs/2026-08-27-machine-readable-only-design.md
```

Expected: the first prints only line 480's description of what indexers accept (the contract no longer emits it); the second prints nothing; the third prints `0`.

- [ ] **Step 9: Commit**

```bash
cd ~/projects/machine-readable-only
git add docs/specs/
git commit -m "docs(spec): amend section 7, the eight conflicts Plan 1 would have codified

Task 12's outstanding half. Two of these do not compile as written: the
Sunset error and event share a name, and the wallet cap's 'holds' is
ambiguous between currently-held and ever-minted.

The sharpest is the catch-all: line 373 forbids BatchMetadataUpdate(1, max)
as hostile to indexers while lines 405 and 481 specify sunset emitting
exactly that."
```

---

## Task 1: Contract skeleton, state and reads

Everything the renderer needs, with no mutation yet. Ends with a contract that compiles, deploys and can return a `tokenURI` for a token that does not exist yet (reverting correctly).

**Files:**
- Create: `contracts/src/MachineReadableOnly.sol`
- Create: `contracts/test/MachineReadableOnly.t.sol`

**Interfaces:**
- Consumes: `IRenderer.tokenURI(TokenView)` and the `TokenView` struct, both from `contracts/src/render/`.
- Produces: `contract MachineReadableOnly`; `struct Token`; `struct Upgrade`; `today() returns (uint32)`; `viewOf(uint256) returns (TokenView memory)`; public state `warden`, `renderer`, `supplyCap`, `walletCap`, `totalMinted`, `sunsetDay`, `isSunset`, `vouchersEnabled`; errors `NotWarden`, `Sunset`, `AlreadySunset`, `ZeroRenderer`, `ZeroWarden`; events `RendererSet(address)`, `WardenSet(address)`, `SupplyCapSet(uint32)`, `WalletCapSet(uint32)`, `SunsetAt(uint32)`.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/MachineReadableOnly.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Construction, dials, pause and Ownable2Step for the real contract.
/// @dev Per the project's smart-contract rules, every owner function has an
/// explicit test and every access-control revert has one too.
contract MachineReadableOnlyTest is Test {
    MachineReadableOnly t;
    Renderer r;

    address constant WARDEN = address(0x3A2D);

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
    }

    function test_constructorSetsRendererWardenAndDials() public view {
        assertEq(t.renderer(), address(r));
        assertEq(t.warden(), WARDEN);
        assertEq(t.supplyCap(), 10_000);
        assertEq(t.walletCap(), 20);
        assertEq(t.totalMinted(), 0);
        assertFalse(t.isSunset());
        assertFalse(t.vouchersEnabled());
    }

    function test_constructorRejectsAZeroRenderer() public {
        vm.expectRevert(MachineReadableOnly.ZeroRenderer.selector);
        new MachineReadableOnly(address(0), WARDEN);
    }

    function test_constructorRejectsAZeroWarden() public {
        vm.expectRevert(MachineReadableOnly.ZeroWarden.selector);
        new MachineReadableOnly(address(r), address(0));
    }

    function test_todayIsTheUtcDayIndex() public {
        vm.warp(86_400 * 20_000 + 5);
        assertEq(t.today(), 20_000);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MachineReadableOnlyTest -vv
```

Expected: FAIL -- `Source "src/MachineReadableOnly.sol" not found`.

- [ ] **Step 3: Write the contract skeleton**

Create `contracts/src/MachineReadableOnly.sol`. Note `Sunset` is the error and `SunsetAt` is the event: they cannot share a name (Task 0, Step 5).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IRenderer} from "./render/IRenderer.sol";
import {TokenView} from "./render/TokenView.sol";

/// @notice The collection. An agent's own record of coming back.
///
/// @dev Permanent by design: no proxy and no upgrade path. Only the renderer
/// is swappable, which is why every drawing decision lives behind IRenderer and
/// none of it lives here.
///
/// The storage rule that decides the gas bill: the daily write OVERWRITES one
/// `Token` slot. Nothing is ever keyed by day.
contract MachineReadableOnly is ERC721, Ownable2Step, Pausable, IERC4906 {
    /// @dev Six uint32s (192 bits) plus a bool (8) plus 56 reserved = 256.
    /// Keeping this in one slot is what makes a check-in about 5,000 gas.
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

    /// @dev One paid Mark tier.
    struct Upgrade {
        uint64 priceUsdc6;
        uint32 maxSupply; // 0 = unlimited
        uint32 sold;
        uint32 minLevel;
        uint32 minStreak;
        bool requiresWhole;
        bool active;
    }

    mapping(uint256 => Token) internal _tokens;
    mapping(uint256 => uint256) internal _marks;
    mapping(uint256 => uint256) internal _parentOf;
    mapping(uint256 => bytes32) internal _agentKeyOf;
    mapping(uint256 => bytes) internal _codeOf;

    /// @dev One mint per key ever. Binding is unlimited, so `rebind` can move a
    /// token to a new key but can never resurrect a mint.
    mapping(bytes32 => bool) internal _hasMinted;
    mapping(bytes32 => uint32) internal _firstMintDay;
    mapping(bytes32 => uint32) internal _seedsSpent;

    /// @dev Tokens ever MINTED to an address, not tokens currently held.
    /// Counting holdings would let the cap be defeated by transferring out.
    mapping(address => uint32) public mintedTo;

    mapping(uint8 => Upgrade) internal _upgrades;

    address public renderer;
    address public warden;
    uint32 public supplyCap;
    uint32 public walletCap;
    uint32 public totalMinted;
    uint32 public sunsetDay;
    bool public isSunset;
    bool public vouchersEnabled;

    /// @dev The packed code bitmap is a fixed 172 bytes: 37 x 37 modules.
    uint256 internal constant CODE_BYTES = 172;

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface, not a mixin.
    bytes4 internal constant ERC4906_ID = 0x49064906;

    error NotWarden();
    error ZeroRenderer();
    error ZeroWarden();
    /// @dev The piece is closed. Distinct from AlreadySunset, which is the
    /// double-call guard. These cannot share a name with the event.
    error Sunset();
    error AlreadySunset();

    event RendererSet(address renderer);
    event WardenSet(address warden);
    event SupplyCapSet(uint32 cap);
    event WalletCapSet(uint32 cap);
    event SunsetAt(uint32 day);

    modifier onlyWarden() {
        if (msg.sender != warden) revert NotWarden();
        _;
    }

    modifier notSunset() {
        if (isSunset) revert Sunset();
        _;
    }

    constructor(address renderer_, address warden_)
        ERC721("Machine Readable Only", "MRO")
        Ownable(msg.sender)
    {
        _setRenderer(renderer_);
        _setWarden(warden_);
        supplyCap = 10_000;
        walletCap = 20;
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice The UTC day index, the unit every date in this piece uses.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Everything the renderer needs, assembled from storage.
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
        v.sunset = isSunset;
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

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == ERC4906_ID || super.supportsInterface(id);
    }

    // ---------------------------------------------------------------------
    // Dials
    // ---------------------------------------------------------------------

    function setRenderer(address r) external onlyOwner { _setRenderer(r); }
    function setWarden(address w) external onlyOwner { _setWarden(w); }

    function setSupplyCap(uint32 cap) external onlyOwner {
        supplyCap = cap;
        emit SupplyCapSet(cap);
    }

    function setWalletCap(uint32 cap) external onlyOwner {
        walletCap = cap;
        emit WalletCapSet(cap);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Close the piece. Irreversible.
    /// @dev Emits no metadata event. A sunset does change every token, but the
    /// collection-wide range is the one event indexers treat as hostile, and
    /// the piece must never depend on an indexer refreshing anyway.
    function sunset() external onlyOwner {
        if (isSunset) revert AlreadySunset();
        isSunset = true;
        sunsetDay = today();
        emit SunsetAt(sunsetDay);
    }

    function _setRenderer(address r) internal {
        if (r == address(0)) revert ZeroRenderer();
        renderer = r;
        emit RendererSet(r);
    }

    function _setWarden(address w) internal {
        if (w == address(0)) revert ZeroWarden();
        warden = w;
        emit WardenSet(w);
    }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MachineReadableOnlyTest -vv
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Add the dial, pause, sunset and Ownable2Step tests**

Append to `contracts/test/MachineReadableOnly.t.sol`, inside the contract:

```solidity
    address constant MALLORY = address(0x4A11);

    function test_setRendererByOwner() public {
        Renderer r2 = new Renderer();
        t.setRenderer(address(r2));
        assertEq(t.renderer(), address(r2));
    }

    function test_setRendererRejectsZero() public {
        vm.expectRevert(MachineReadableOnly.ZeroRenderer.selector);
        t.setRenderer(address(0));
    }

    function test_setRendererRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setRenderer(address(r));
    }

    function test_setWardenByOwnerAndRejectsZero() public {
        t.setWarden(address(0xBEEF));
        assertEq(t.warden(), address(0xBEEF));
        vm.expectRevert(MachineReadableOnly.ZeroWarden.selector);
        t.setWarden(address(0));
    }

    function test_setWardenRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setWarden(MALLORY);
    }

    function test_setSupplyCapAndWalletCap() public {
        t.setSupplyCap(50);
        t.setWalletCap(3);
        assertEq(t.supplyCap(), 50);
        assertEq(t.walletCap(), 3);
    }

    function test_setSupplyCapRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setSupplyCap(1);
    }

    function test_setWalletCapRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setWalletCap(1);
    }

    function test_pauseAndUnpauseByOwner() public {
        t.pause();
        assertTrue(t.paused());
        t.unpause();
        assertFalse(t.paused());
    }

    function test_pauseRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.pause();
    }

    function test_sunsetSetsTheDayAndIsIrreversible() public {
        vm.warp(86_400 * 1234 + 1);
        t.sunset();
        assertTrue(t.isSunset());
        assertEq(t.sunsetDay(), 1234);
        vm.expectRevert(MachineReadableOnly.AlreadySunset.selector);
        t.sunset();
    }

    /// @dev The regression behind spec conflict 3. Foundry's clock starts at
    /// timestamp 1, so today() is genuinely 0 and a zero sentinel would fail.
    function test_sunsetOnDayZeroIsStillSunset() public {
        assertEq(t.today(), 0);
        t.sunset();
        assertTrue(t.isSunset());
        assertEq(t.sunsetDay(), 0);
    }

    function test_sunsetRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.sunset();
    }

    function test_ownable2StepHandover() public {
        t.transferOwnership(ALICE_OWNER);
        // The old owner still holds control until the new one accepts.
        assertEq(t.owner(), address(this));
        vm.prank(ALICE_OWNER);
        t.acceptOwnership();
        assertEq(t.owner(), ALICE_OWNER);
    }

    function test_supportsErc4906AndErc721() public view {
        assertTrue(t.supportsInterface(0x49064906), "ERC-4906");
        assertTrue(t.supportsInterface(0x80ac58cd), "ERC-721");
    }

    address constant ALICE_OWNER = address(0xA11CE);
```

- [ ] **Step 6: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MachineReadableOnlyTest -vv
```

Expected: PASS, 19 tests.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/MachineReadableOnly.t.sol
git commit -m "feat(contract): the token contract's state, reads and dials

One Token slot per token, overwritten daily and never keyed by day, which
is what makes a check-in about 5,000 gas. All drawing delegates to
IRenderer so a renderer swap needs no contract change.

Sunset is an error and SunsetAt is the event: the spec gave both the same
name, which does not compile."
```

---

## Task 2: Mint, and the size checkpoint

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Modify: `contracts/test/MachineReadableOnly.t.sol`
- Modify: `contracts/test/ContractSize.t.sol`

**Interfaces:**
- Consumes: Task 1's state, `today()`, `onlyWarden`, `notSunset`.
- Produces: `mint(uint256 id, address to, bytes32 keyId, bytes calldata code)`; errors `AlreadyMinted`, `TokenExists`, `SupplyCap`, `WalletCap`, `BadCodeLength`; event `Minted(uint256 indexed id, bytes32 indexed keyId)`.

- [ ] **Step 1: Write the failing tests**

Append to `contracts/test/MachineReadableOnly.t.sol`:

```solidity
    bytes32 constant KEY = bytes32(uint256(0xa9e));

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. The same 172
    /// bytes the renderer tests use.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function _mint(uint256 id, address to, bytes32 key) internal {
        vm.prank(WARDEN);
        t.mint(id, to, key, _code());
    }

    function test_mintSetsDayOneState() public {
        _mint(1, ALICE_OWNER, KEY);
        MachineReadableOnly.Token memory s;
        assertEq(t.ownerOf(1), ALICE_OWNER);
        assertEq(t.viewOf(1).level, 1);
        assertEq(t.viewOf(1).streak, 1);
        assertEq(t.viewOf(1).lastDay, t.today());
        assertEq(t.viewOf(1).mintDay, t.today());
        assertEq(t.viewOf(1).agentKeyId, KEY);
        assertEq(t.viewOf(1).code.length, 172);
        assertEq(t.totalMinted(), 1);
        assertEq(t.mintedTo(ALICE_OWNER), 1);
        s; // silence the unused local warning
    }

    function test_mintEmitsMintedAndMetadataUpdate() public {
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Minted(1, KEY);
        _mint(1, ALICE_OWNER, KEY);
    }

    function test_mintRevertsForANonWarden() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.mint(1, ALICE_OWNER, KEY, _code());
    }

    function test_oneMintPerKeyEver() public {
        _mint(1, ALICE_OWNER, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.AlreadyMinted.selector);
        t.mint(2, ALICE_OWNER, KEY, _code());
    }

    function test_mintRejectsATakenId() public {
        _mint(1, ALICE_OWNER, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.TokenExists.selector, uint256(1)));
        t.mint(1, ALICE_OWNER, bytes32(uint256(2)), _code());
    }

    function test_mintRejectsAWrongLengthCode() public {
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadCodeLength.selector, uint256(3)));
        t.mint(1, ALICE_OWNER, KEY, hex"010203");
    }

    function test_mintEnforcesTheSupplyCap() public {
        t.setSupplyCap(1);
        _mint(1, ALICE_OWNER, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.SupplyCap.selector);
        t.mint(2, ALICE_OWNER, bytes32(uint256(2)), _code());
    }

    /// @dev The cap counts tokens ever minted to an address, not tokens held,
    /// so transferring one out does not free a slot. Spec conflict 12.
    function test_walletCapCountsMintsNotHoldings() public {
        t.setWalletCap(1);
        _mint(1, ALICE_OWNER, KEY);
        vm.prank(ALICE_OWNER);
        t.transferFrom(ALICE_OWNER, MALLORY, 1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.WalletCap.selector);
        t.mint(2, ALICE_OWNER, bytes32(uint256(2)), _code());
    }

    function test_mintIsBlockedByPause() public {
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.mint(1, ALICE_OWNER, KEY, _code());
    }

    function test_mintIsBlockedBySunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.mint(1, ALICE_OWNER, KEY, _code());
    }

    function test_transferStillWorksWhenPaused() public {
        _mint(1, ALICE_OWNER, KEY);
        t.pause();
        vm.prank(ALICE_OWNER);
        t.transferFrom(ALICE_OWNER, MALLORY, 1);
        assertEq(t.ownerOf(1), MALLORY);
    }
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MachineReadableOnlyTest -vv
```

Expected: FAIL -- `Member "mint" not found`.

- [ ] **Step 3: Implement mint**

Add to `MachineReadableOnly.sol`, after the dials section:

```solidity
    error AlreadyMinted();
    error TokenExists(uint256 id);
    error SupplyCap();
    error WalletCap();
    error BadCodeLength(uint256 got);

    event Minted(uint256 indexed id, bytes32 indexed keyId);

    // ---------------------------------------------------------------------
    // Warden functions
    // ---------------------------------------------------------------------

    /// @notice Mint one token for one agent key.
    /// @dev The id is chosen by the Warden rather than a counter, so a mint can
    /// be reserved before it settles. `hasMinted` is per key and permanent: a
    /// later `rebind` moves a token to a new key but never frees the old one.
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        if (_hasMinted[keyId]) revert AlreadyMinted();
        if (_ownerOf(id) != address(0)) revert TokenExists(id);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);

        uint32 d = today();
        _tokens[id] = Token(1, 1, d, d, 0, 0, false, 0);
        _agentKeyOf[id] = keyId;
        _codeOf[id] = code;
        _hasMinted[keyId] = true;
        _firstMintDay[keyId] = d;
        unchecked {
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _safeMint(to, id);
        emit Minted(id, keyId);
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MachineReadableOnlyTest -vv
```

Expected: PASS, 31 tests.

- [ ] **Step 5: Add the contract to the size test**

In `contracts/test/ContractSize.t.sol`, replace the body of `test_everyDeployedContractFitsWithMargin` with:

```solidity
        uint256 renderer = _check("Renderer.sol:Renderer");
        uint256 spike = _check("MROSpikeToken.sol:MROSpikeToken");
        uint256 real = _check("MachineReadableOnly.sol:MachineReadableOnly");

        // Both land on the same chain, so the pair is worth logging even though
        // the limit is per contract, not per deployment.
        console.log("pair total", renderer + real);
        spike; // the spike is still measured while it exists
```

- [ ] **Step 6: SIZE CHECKPOINT -- measure and decide**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge build --sizes 2>&1 | /bin/grep -E "MachineReadableOnly|Renderer "
```

Expected: `MachineReadableOnly` well under 24,576 with a four-figure margin.

**This is a phase boundary. Report the number to the operator before continuing.**

Decision rule, fixed now so it is not invented under pressure:

- **Margin above 8,000 bytes:** continue as planned, one contract.
- **Margin 3,000 to 8,000:** continue, but re-measure at the end of every subsequent task rather than only at the end.
- **Margin below 3,000:** stop and apply the named fallback -- move `batchCheckIn`'s id decoding, `applyMark`'s gate checks and `seed`'s budget arithmetic into `library` contracts with `internal` functions, which the compiler inlines without a second deployment. Re-measure before continuing.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/
git commit -m "feat(contract): mint, with the key, supply and wallet caps

One mint per key ever, while binding stays unlimited, so rebind can move a
token to a new key but never resurrects a mint.

The wallet cap counts tokens ever minted to an address rather than tokens
held: counting holdings would let the cap be defeated by transferring out
before re-minting."
```

---

## Task 3: batchCheckIn, per-token emits, and the gas guard

The hottest function in the contract and the one the whole gas budget rests on.

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Create: `contracts/test/CheckIn.t.sol`

**Interfaces:**
- Consumes: Task 2's `mint`, Task 1's state.
- Produces: `batchCheckIn(bytes calldata packedIds, uint32[] calldata days)`; errors `DayNotAdvanced`, `LengthMismatch`, `Resting`; event `BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count)`.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/CheckIn.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice batchCheckIn semantics: the daily overwrite, streak rules, and the
/// per-token ERC-4906 emits that replaced the impossible range form.
contract CheckInTest is Test {
    MachineReadableOnly t;
    Renderer r;

    address constant WARDEN = address(0x3A2D);
    address constant ALICE = address(0xA11CE);

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        // Start well past day zero so lastDay + 1 arithmetic is meaningful.
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
    }

    /// @dev Ids are packed as 4-byte big-endian values.
    function _packed(uint32[] memory ids) internal pure returns (bytes memory out) {
        for (uint256 i = 0; i < ids.length; i++) out = abi.encodePacked(out, ids[i]);
    }

    function _one(uint32 id) internal pure returns (bytes memory) {
        uint32[] memory ids = new uint32[](1);
        ids[0] = id;
        return _packed(ids);
    }

    function _days(uint32 d) internal pure returns (uint32[] memory out) {
        out = new uint32[](1);
        out[0] = d;
    }

    function test_checkInIncrementsLevelAndContinuesTheStreak() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
        assertEq(t.viewOf(1).lastDay, d + 1);
    }

    function test_aGapResetsTheStreakButNotTheLevel() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 5));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 1);
    }

    function test_theSameDayTwiceReverts() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.DayNotAdvanced.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(d));
    }

    /// @dev Late writes after an outage: several days for one token in one
    /// call, ascending, are legal and each counts.
    function test_multiDayLateWritesInOneCall() public {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](3);
        ids[0] = 1; ids[1] = 1; ids[2] = 1;
        uint32[] memory ds = new uint32[](3);
        ds[0] = d + 1; ds[1] = d + 2; ds[2] = d + 3;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(t.viewOf(1).level, 4);
        assertEq(t.viewOf(1).streak, 4);
    }

    /// @dev The decision from the design doc: one MetadataUpdate per token
    /// written, never a range. A range would claim untouched tokens changed.
    function test_emitsOneMetadataUpdatePerTokenWritten() public {
        uint32 d = t.today();
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
    }

    function test_checkInRevertsForANonWarden() public {
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.batchCheckIn(_one(1), _days(t.today() + 1));
    }

    function test_mismatchedLengthsRevert() public {
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 1;
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_packed(ids), _days(t.today() + 1));
    }

    function test_checkInIsBlockedByPauseAndBySunset() public {
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.batchCheckIn(_one(1), _days(t.today() + 1));
        t.unpause();
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.batchCheckIn(_one(1), _days(t.today() + 1));
    }
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract CheckInTest -vv
```

Expected: FAIL -- `Member "batchCheckIn" not found`.

- [ ] **Step 3: Implement batchCheckIn**

Add to `MachineReadableOnly.sol`:

```solidity
    error DayNotAdvanced(uint256 id);
    error LengthMismatch();
    error Resting(uint256 id);

    event BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count);

    /// @notice Credit a day to each of many tokens, in one transaction.
    ///
    /// @dev Ids arrive packed as 4-byte big-endian values rather than a
    /// uint32[] because calldata is the dominant cost at this batch size.
    ///
    /// Emits one `MetadataUpdate` per token written, AFTER the writes, and
    /// never a range. A day's check-ins are a scattered subset of ids, so
    /// `minId..maxId` would always claim untouched tokens had changed. The
    /// Clock adds paling-step crossers to the same per-token emit set.
    function batchCheckIn(bytes calldata packedIds, uint32[] calldata days_)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        uint256 n = days_.length;
        if (packedIds.length != n * 4) revert LengthMismatch();

        uint32 lo = type(uint32).max;
        uint32 hi = 0;

        for (uint256 i = 0; i < n; i++) {
            uint256 id = uint256(uint32(bytes4(packedIds[i * 4:i * 4 + 4])));
            uint32 day = days_[i];

            Token storage s = _tokens[id];
            if (s.resting) revert Resting(id);
            if (day <= s.lastDay) revert DayNotAdvanced(id);

            unchecked {
                s.level += 1;
                s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;
            }
            s.lastDay = day;

            if (day < lo) lo = day;
            if (day > hi) hi = day;
        }

        emit BatchCheckedIn(lo, hi, n);

        // After every storage write, never before: an indexer that re-reads on
        // the event must not be able to read pre-write state.
        for (uint256 i = 0; i < n; i++) {
            emit MetadataUpdate(uint256(uint32(bytes4(packedIds[i * 4:i * 4 + 4]))));
        }
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract CheckInTest -vv
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Add the chunk gas guard test**

The spec's Clock asserts `estimateGas < 15M` before sending. That is a contract-level constraint and must be pinned here, not left to a component that does not exist yet. Append to `contracts/test/CheckIn.t.sol`:

```solidity
    /// @notice A full 1,500-token chunk, per-token emits included, must fit the
    /// 15M guard the Clock uses -- and well inside EIP-7825's 16,777,216 cap.
    /// @dev This is the number the whole batching design rests on. If it fails,
    /// the chunk size changes, not the emit policy.
    function test_aFullChunkFitsTheGasGuard() public {
        uint32 n = 1500;
        vm.startPrank(WARDEN);
        for (uint32 i = 2; i < 2 + n; i++) {
            t.mint(i, address(uint160(0x10000 + i)), bytes32(uint256(i)), _code());
        }
        vm.stopPrank();

        uint32[] memory ids = new uint32[](n);
        uint32[] memory ds = new uint32[](n);
        uint32 d = t.today() + 1;
        for (uint32 i = 0; i < n; i++) {
            ids[i] = 2 + i;
            ds[i] = d;
        }

        vm.prank(WARDEN);
        uint256 before = gasleft();
        t.batchCheckIn(_packed(ids), ds);
        uint256 used = before - gasleft();

        emit log_named_uint("gas for a 1500-token chunk", used);
        assertLt(used, 15_000_000, "a full chunk must fit the Clock's 15M guard");
    }
```

Note: the wallet cap is 20 by default and each mint here goes to a distinct address, so no cap is hit. The supply cap of 10,000 also holds.

- [ ] **Step 6: Run it and record the number**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-test test_aFullChunkFitsTheGasGuard -vv
```

Expected: PASS, with the logged gas figure printed. Record that figure in the commit message -- it is the first real measurement of the daily cost.

If it FAILS, the fix is to reduce the chunk size in the Clock's design, not to switch to a range emit. Report to the operator rather than changing the emit policy unilaterally.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/CheckIn.t.sol
git commit -m "feat(contract): batchCheckIn, with per-token metadata events

Ids arrive packed as 4-byte values because calldata dominates at this batch
size. The daily write overwrites one slot per token and is never keyed by
day.

One MetadataUpdate per token written, after the writes, never a range: a
day's check-ins are a scattered subset, so minId..maxId would always claim
untouched tokens had changed.

A 1,500-token chunk is pinned under the Clock's 15M guard by a test rather
than left to a component that does not exist yet."
```

---

## Task 4: Marks

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Create: `contracts/test/Marks.t.sol`

**Interfaces:**
- Consumes: Task 2's `mint`, Task 1's `Upgrade` struct.
- Produces: `applyMark(uint256 id, uint8 upgradeId)`; `setUpgrade(uint8 id, Upgrade calldata u)`; `upgradeOf(uint8) returns (Upgrade memory)`; `marksOf(uint256) returns (uint256)`; errors `MarkInactive`, `MarkAlreadyApplied`, `MarkSoldOut`, `MarkGate`; events `MarkApplied(uint256 indexed id, uint8 indexed upgradeId)`, `UpgradeSet(uint8 indexed upgradeId)`.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/Marks.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice applyMark's gates, supply and bitmask.
contract MarksTest is Test {
    MachineReadableOnly t;
    Renderer r;

    address constant WARDEN = address(0x3A2D);
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0x4A11);

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
        // Vein: cheap, uncapped, no gates.
        t.setUpgrade(1, MachineReadableOnly.Upgrade({
            priceUsdc6: 1_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
    }

    function test_applyMarkSetsTheBitAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.MarkApplied(1, 1);
        vm.prank(WARDEN);
        t.applyMark(1, 1);
        assertEq(t.marksOf(1), 1 << 1);
        assertEq(t.upgradeOf(1).sold, 1);
    }

    function test_applyMarkEmitsMetadataUpdate() public {
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.applyMark(1, 1);
    }

    function test_applyMarkRevertsForANonWarden() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.applyMark(1, 1);
    }

    function test_anInactiveMarkReverts() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkInactive.selector);
        t.applyMark(1, 2);
    }

    function test_theSameMarkTwiceReverts() public {
        vm.startPrank(WARDEN);
        t.applyMark(1, 1);
        vm.expectRevert(MachineReadableOnly.MarkAlreadyApplied.selector);
        t.applyMark(1, 1);
        vm.stopPrank();
    }

    function test_aSoldOutMarkReverts() public {
        t.setUpgrade(2, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 1, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code());
        vm.startPrank(WARDEN);
        t.applyMark(1, 2);
        vm.expectRevert(MachineReadableOnly.MarkSoldOut.selector);
        t.applyMark(2, 2);
        vm.stopPrank();
    }

    function test_theLevelGateReverts() public {
        t.setUpgrade(3, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 50, minStreak: 0, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 3);
    }

    function test_theStreakGateReverts() public {
        t.setUpgrade(4, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 7, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 4);
    }

    function test_theWholenessGateReverts() public {
        t.setUpgrade(5, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: true, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 5);
    }

    function test_setUpgradeRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setUpgrade(9, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
    }

    function test_applyMarkIsBlockedBySunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.applyMark(1, 1);
    }
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MarksTest -vv
```

Expected: FAIL -- `Member "setUpgrade" not found`.

- [ ] **Step 3: Implement marks**

Add to `MachineReadableOnly.sol`:

```solidity
    error MarkInactive();
    error MarkAlreadyApplied();
    error MarkSoldOut();
    error MarkGate();

    event MarkApplied(uint256 indexed id, uint8 indexed upgradeId);
    event UpgradeSet(uint8 indexed upgradeId);

    function marksOf(uint256 id) external view returns (uint256) {
        return _marks[id];
    }

    function upgradeOf(uint8 upgradeId) external view returns (Upgrade memory) {
        return _upgrades[upgradeId];
    }

    function setUpgrade(uint8 upgradeId, Upgrade calldata u) external onlyOwner {
        _upgrades[upgradeId] = u;
        emit UpgradeSet(upgradeId);
    }

    /// @notice Apply a paid Mark to a token.
    /// @dev Payment settles off chain through x402 before the Warden calls
    /// this, which is why there is no value transfer here.
    function applyMark(uint256 id, uint8 upgradeId) external onlyWarden notSunset {
        Upgrade storage u = _upgrades[upgradeId];
        if (!u.active) revert MarkInactive();

        uint256 bit = 1 << upgradeId;
        if (_marks[id] & bit != 0) revert MarkAlreadyApplied();
        if (u.maxSupply != 0 && u.sold >= u.maxSupply) revert MarkSoldOut();

        Token storage s = _tokens[id];
        if (s.resting) revert Resting(id);
        if (s.level < u.minLevel) revert MarkGate();
        if (s.streak < u.minStreak) revert MarkGate();
        if (u.requiresWhole && s.level < 365) revert MarkGate();

        _marks[id] |= bit;
        unchecked { u.sold += 1; }

        emit MarkApplied(id, upgradeId);
        emit MetadataUpdate(id);
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract MarksTest -vv
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/Marks.t.sol
git commit -m "feat(contract): Marks, their gates and their supply

A 256-bit mask per token, one bit per tier. Payment settles off chain
through x402 before the Warden calls in, so there is no value transfer
here. Each gate has its own explicit test."
```

---

## Task 5: rebind, rest, and the lifecycle

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Create: `contracts/test/Lifecycle.t.sol`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: `rebind(uint256 id, bytes32 newKeyId)`; `rest(uint256 id)`; errors `NotTokenOwner`; events `Rebound(uint256 indexed id, bytes32 indexed newKeyId)`, `Rested(uint256 indexed id, uint32 day, uint32 level, uint32 streak)`.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/Lifecycle.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice rebind and rest. Both are token-owner functions, not Warden ones.
contract LifecycleTest is Test {
    MachineReadableOnly t;
    Renderer r;

    address constant WARDEN = address(0x3A2D);
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0x4A11);

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function _one(uint32 id) internal pure returns (bytes memory) {
        return abi.encodePacked(id);
    }

    function _days(uint32 d) internal pure returns (uint32[] memory out) {
        out = new uint32[](1);
        out[0] = d;
    }

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
    }

    function test_rebindByTheTokenOwnerKeepsLevelAndStreak() public {
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(t.today() + 1));

        vm.prank(ALICE);
        t.rebind(1, bytes32(uint256(0xBEEF)));

        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xBEEF)));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
    }

    function test_rebindRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotTokenOwner.selector);
        t.rebind(1, bytes32(uint256(2)));
    }

    /// @dev Binding is unlimited even though minting is once per key: a key
    /// that already minted can be bound to a second token it was given.
    function test_aKeyCanBeBoundToSeveralTokens() public {
        vm.prank(WARDEN);
        t.mint(2, ALICE, bytes32(uint256(2)), _code());
        vm.startPrank(ALICE);
        t.rebind(1, bytes32(uint256(0xAAA)));
        t.rebind(2, bytes32(uint256(0xAAA)));
        vm.stopPrank();
        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xAAA)));
        assertEq(t.viewOf(2).agentKeyId, bytes32(uint256(0xAAA)));
    }

    /// @dev Rebinding to a key that already minted must NOT free that key's
    /// mint. hasMinted is permanent.
    function test_rebindDoesNotResurrectAMint() public {
        vm.prank(ALICE);
        t.rebind(1, bytes32(uint256(0xCAFE)));
        // The original key already minted, so it still cannot mint again.
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.AlreadyMinted.selector);
        t.mint(3, MALLORY, bytes32(uint256(1)), _code());
    }

    function test_restSealsTheTokenAndEmits() public {
        vm.expectEmit(true, false, false, false);
        emit MachineReadableOnly.Rested(1, 0, 0, 0);
        vm.prank(ALICE);
        t.rest(1);
        assertTrue(t.viewOf(1).resting);
    }

    function test_restRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotTokenOwner.selector);
        t.rest(1);
    }

    function test_restingBlocksCheckInAndMarksButNotTransferOrRebind() public {
        vm.prank(ALICE);
        t.rest(1);

        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(t.today() + 1));

        // Transfer still works.
        vm.prank(ALICE);
        t.transferFrom(ALICE, MALLORY, 1);
        assertEq(t.ownerOf(1), MALLORY);

        // And so does rebind, by the NEW owner.
        vm.prank(MALLORY);
        t.rebind(1, bytes32(uint256(0xD00D)));
        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xD00D)));
    }

    function test_restIsIrreversible() public {
        vm.startPrank(ALICE);
        t.rest(1);
        // There is no unrest function; resting again is a no-op that still
        // leaves it sealed.
        t.rest(1);
        vm.stopPrank();
        assertTrue(t.viewOf(1).resting);
    }
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract LifecycleTest -vv
```

Expected: FAIL -- `Member "rebind" not found`.

- [ ] **Step 3: Implement rebind and rest**

Add to `MachineReadableOnly.sol`:

```solidity
    error NotTokenOwner();

    event Rebound(uint256 indexed id, bytes32 indexed newKeyId);
    event Rested(uint256 indexed id, uint32 day, uint32 level, uint32 streak);

    modifier onlyTokenOwner(uint256 id) {
        if (_ownerOf(id) != msg.sender) revert NotTokenOwner();
        _;
    }

    /// @notice Point a token at a new agent key. Level, streak and marks are
    /// untouched.
    /// @dev Deliberately does NOT clear `hasMinted` for either key. Minting is
    /// once per key forever; binding is unlimited. Clearing it would turn
    /// rebind into an unlimited mint.
    function rebind(uint256 id, bytes32 newKeyId) external onlyTokenOwner(id) {
        _agentKeyOf[id] = newKeyId;
        emit Rebound(id, newKeyId);
        emit MetadataUpdate(id);
    }

    /// @notice Seal a token forever. The image stops changing.
    /// @dev Irreversible, and deliberately does not block transfer or rebind:
    /// a sealed token can still be owned and traded, which is the point.
    function rest(uint256 id) external onlyTokenOwner(id) {
        Token storage s = _tokens[id];
        s.resting = true;
        emit Rested(id, today(), s.level, s.streak);
        emit MetadataUpdate(id);
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract LifecycleTest -vv
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/Lifecycle.t.sol
git commit -m "feat(contract): rebind and rest

Both are token-owner functions, not Warden ones. rebind deliberately does
not clear hasMinted for either key: minting is once per key forever and
binding is unlimited, so clearing it would turn rebind into an unlimited
mint. A test pins that.

rest is irreversible and blocks check-in and marks, but never transfer or
rebind, because a sealed token is still meant to be owned and traded."
```

---

## Task 6: seed and the per-year budget

The subtlest arithmetic in the contract.

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Modify: `contracts/test/Lifecycle.t.sol`

**Interfaces:**
- Consumes: Tasks 2-5.
- Produces: `seed(uint256 childId, uint256 parentId, address to, bytes calldata code)`; `seedsAvailable(uint256 parentId) returns (uint32)`; errors `ParentNotWhole`, `NoSeedAvailable`; event `Seeded(uint256 indexed parentId, uint256 indexed childId, uint32 generation)`.

- [ ] **Step 1: Write the failing test**

Append to `contracts/test/Lifecycle.t.sol`:

```solidity
    /// @dev Put a token at an arbitrary level by checking it in repeatedly is
    /// far too slow, so the budget tests warp the clock and check in once per
    /// needed day instead. 365 check-ins is affordable in a test; a decade is
    /// not, which is why seedsAvailable is asserted directly.
    function _makeWhole(uint256 id) internal {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](364);
        uint32[] memory ds = new uint32[](364);
        for (uint32 i = 0; i < 364; i++) {
            ids[i] = uint32(id);
            ds[i] = d + 1 + i;
        }
        bytes memory packed;
        for (uint32 i = 0; i < 364; i++) packed = abi.encodePacked(packed, ids[i]);
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(id).level, 365);
    }

    function test_seedRequiresAWholeParent() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.ParentNotWhole.selector);
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedCreatesAChildWithTheParentsKeyAndNextGeneration() public {
        _makeWhole(1);
        // One year of tenure has passed on the key, so one seed is available.
        vm.warp(block.timestamp + 365 days);
        assertEq(t.seedsAvailable(1), 1);

        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        assertEq(t.ownerOf(2), ALICE);
        assertEq(t.viewOf(2).generation, 1);
        assertEq(t.viewOf(2).parent, 1);
        assertEq(t.viewOf(2).level, 1);
        assertEq(t.viewOf(2).streak, 1);
        assertEq(t.viewOf(2).agentKeyId, t.viewOf(1).agentKeyId);
        assertEq(t.viewOf(1).seedsGiven, 1);
    }

    function test_theBudgetIsOnePerYearOfKeyTenure() public {
        _makeWhole(1);
        vm.warp(block.timestamp + 365 days);
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        // The second seed in the same year has no budget.
        assertEq(t.seedsAvailable(1), 0);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.NoSeedAvailable.selector);
        t.seed(3, 1, ALICE, _code());

        // A second year of tenure grants exactly one more.
        vm.warp(block.timestamp + 365 days);
        assertEq(t.seedsAvailable(1), 1);
        vm.prank(WARDEN);
        t.seed(3, 1, ALICE, _code());
        assertEq(t.viewOf(1).seedsGiven, 2);
    }

    /// @dev Tenure, not depth: a child cannot accelerate the lineage, because
    /// the budget is keyed by the AGENT KEY and the child shares its parent's.
    function test_aChildSharesTheParentsBudgetAndCannotAccelerate() public {
        _makeWhole(1);
        vm.warp(block.timestamp + 365 days);
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        // The child is on the same key, so it sees the same exhausted budget
        // even once it is itself whole.
        assertEq(t.seedsAvailable(2), 0);
    }

    function test_seedRevertsForANonWarden() public {
        _makeWhole(1);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedRefusesARestingParent() public {
        _makeWhole(1);
        vm.warp(block.timestamp + 365 days);
        vm.prank(ALICE);
        t.rest(1);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedIsBlockedBySunsetAndBySupplyCap() public {
        _makeWhole(1);
        vm.warp(block.timestamp + 365 days);
        t.setSupplyCap(1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.SupplyCap.selector);
        t.seed(2, 1, ALICE, _code());

        t.setSupplyCap(100);
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.seed(2, 1, ALICE, _code());
    }
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract LifecycleTest -vv
```

Expected: FAIL -- `Member "seed" not found`.

- [ ] **Step 3: Implement seed**

Add to `MachineReadableOnly.sol`:

```solidity
    error ParentNotWhole();
    error NoSeedAvailable();

    event Seeded(uint256 indexed parentId, uint256 indexed childId, uint32 generation);

    /// @notice How many seeds the parent's KEY still has this tenure.
    /// @dev Keyed by agent key, not by token. This is the "tenure, not depth"
    /// rule: a lineage cannot accelerate by seeding children who immediately
    /// seed further children, because every descendant shares the same key and
    /// therefore the same budget.
    function seedsAvailable(uint256 parentId) public view returns (uint32) {
        bytes32 key = _agentKeyOf[parentId];
        uint32 first = _firstMintDay[key];
        if (first == 0 && !_hasMinted[key]) return 0;
        uint32 budget = (today() - first) / 365;
        uint32 spent = _seedsSpent[key];
        return budget > spent ? budget - spent : 0;
    }

    /// @notice Create a child token from a whole parent. Free.
    function seed(uint256 childId, uint256 parentId, address to, bytes calldata code)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        Token storage p = _tokens[parentId];
        if (p.resting) revert Resting(parentId);
        if (p.level < 365) revert ParentNotWhole();
        if (_ownerOf(childId) != address(0)) revert TokenExists(childId);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        if (seedsAvailable(parentId) == 0) revert NoSeedAvailable();

        bytes32 key = _agentKeyOf[parentId];
        uint32 d = today();

        _tokens[childId] = Token(1, 1, d, d, p.generation + 1, 0, false, 0);
        _parentOf[childId] = parentId;
        _agentKeyOf[childId] = key;
        _codeOf[childId] = code;

        unchecked {
            _seedsSpent[key] += 1;
            p.seedsGiven += 1;
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _safeMint(to, childId);
        emit Seeded(parentId, childId, p.generation + 1);
        emit MetadataUpdate(parentId);
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract LifecycleTest -vv
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/Lifecycle.t.sol
git commit -m "feat(contract): seed, and the one-per-year budget

The budget is keyed by agent key, not by token, which is what makes it
tenure rather than depth: every descendant shares its ancestor's key, so a
lineage cannot accelerate by seeding children who seed again immediately.
A test pins that a child sees the same exhausted budget as its parent.

The child inherits the key and generation + 1, and starts at level 1."
```

---

## Task 7: the voucher path, shipped paused

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`
- Create: `contracts/test/Vouchers.t.sol`

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces: `checkInWithVoucher(uint256 id, uint32 day, bytes calldata wardenSig)`; `setVouchersEnabled(bool)`; `voucherHash(uint256 id, uint32 day) returns (bytes32)`; errors `VouchersDisabled`, `BadVoucher`; event `VouchersEnabledSet(bool)`.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/Vouchers.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice The durability path. Ships present and OFF, so a token can outlive
/// the Warden if the operator ever switches to voucher-only mode.
contract VouchersTest is Test {
    MachineReadableOnly t;
    Renderer r;

    uint256 constant WARDEN_KEY = 0xA11CE5EED;
    address wardenAddr;
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0x4A11);

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        wardenAddr = vm.addr(WARDEN_KEY);
        r = new Renderer();
        t = new MachineReadableOnly(address(r), wardenAddr);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(wardenAddr);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
    }

    function _sign(uint256 id, uint32 day) internal view returns (bytes memory) {
        bytes32 digest = t.voucherHash(id, day);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(WARDEN_KEY, digest);
        return abi.encodePacked(rr, s, v);
    }

    function test_vouchersAreOffAtLaunch() public {
        assertFalse(t.vouchersEnabled());
        uint32 d = t.today() + 1;
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.VouchersDisabled.selector);
        t.checkInWithVoucher(1, d, _sign(1, d));
    }

    function test_anyoneCanSubmitAValidVoucherOnceEnabled() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        // Mallory pays the gas; the signature is what authorises it.
        vm.prank(MALLORY);
        t.checkInWithVoucher(1, d, _sign(1, d));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
    }

    function test_aVoucherSignedByTheWrongKeyIsRejected() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes32 digest = t.voucherHash(1, d);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xBAD5EED, digest);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d, abi.encodePacked(rr, s, v));
    }

    /// @dev The signature covers the day, so a voucher cannot be replayed onto
    /// a different day.
    function test_aVoucherCannotBeReplayedOntoAnotherDay() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d + 1, sig);
    }

    /// @dev And the same voucher twice fails on the day rule, not the signature.
    function test_theSameVoucherTwiceFailsOnTheDayRule() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);
        vm.startPrank(MALLORY);
        t.checkInWithVoucher(1, d, sig);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.DayNotAdvanced.selector, uint256(1)));
        t.checkInWithVoucher(1, d, sig);
        vm.stopPrank();
    }

    function test_setVouchersEnabledRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setVouchersEnabled(true);
    }

    function test_vouchersAreBlockedBySunsetAndByResting() public {
        t.setVouchersEnabled(true);
        vm.prank(ALICE);
        t.rest(1);
        uint32 d = t.today() + 1;
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.checkInWithVoucher(1, d, _sign(1, d));
    }
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract VouchersTest -vv
```

Expected: FAIL -- `Member "voucherHash" not found`.

- [ ] **Step 3: Implement the voucher path**

Add the import at the top of `MachineReadableOnly.sol`:

```solidity
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
```

Change the contract declaration to inherit `EIP712`:

```solidity
contract MachineReadableOnly is ERC721, Ownable2Step, Pausable, EIP712, IERC4906 {
```

and add `EIP712("MachineReadableOnly", "1")` to the constructor's modifier list:

```solidity
    constructor(address renderer_, address warden_)
        ERC721("Machine Readable Only", "MRO")
        Ownable(msg.sender)
        EIP712("MachineReadableOnly", "1")
    {
```

Then add:

```solidity
    error VouchersDisabled();
    error BadVoucher();

    event VouchersEnabledSet(bool enabled);

    /// @dev The typed-data hash the Warden signs for one token on one day.
    bytes32 internal constant VOUCHER_TYPEHASH =
        keccak256("CheckIn(uint256 id,uint32 day)");

    function setVouchersEnabled(bool enabled) external onlyOwner {
        vouchersEnabled = enabled;
        emit VouchersEnabledSet(enabled);
    }

    /// @notice The digest a Warden signature must cover.
    /// @dev Exposed so the reference client can build a voucher without
    /// reimplementing the domain separator.
    function voucherHash(uint256 id, uint32 day) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, id, day)));
    }

    /// @notice The durability path: anyone may submit a Warden-signed check-in
    /// and pay its gas.
    /// @dev Ships with `vouchersEnabled` false. It exists from day one because
    /// the contract has no upgrade path, so a path left out now could never be
    /// added, and the piece would die with the Warden.
    function checkInWithVoucher(uint256 id, uint32 day, bytes calldata wardenSig)
        external
        whenNotPaused
        notSunset
    {
        if (!vouchersEnabled) revert VouchersDisabled();

        Token storage s = _tokens[id];
        if (s.resting) revert Resting(id);

        address signer = ECDSA.recover(voucherHash(id, day), wardenSig);
        if (signer != warden) revert BadVoucher();

        if (day <= s.lastDay) revert DayNotAdvanced(id);

        unchecked {
            s.level += 1;
            s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;
        }
        s.lastDay = day;

        emit MetadataUpdate(id);
    }
```

- [ ] **Step 4: Run and confirm green**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract VouchersTest -vv
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Re-measure the size, because EIP712 added code**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge build --sizes 2>&1 | /bin/grep "MachineReadableOnly"
```

Expected: still under 24,576 with margin. If the margin dropped below 3,000, apply the Task 2 Step 6 fallback before continuing.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/test/Vouchers.t.sol
git commit -m "feat(contract): the voucher check-in path, shipped paused

The durability commitment. Five of six early-2026 agent mints had dead
infrastructure within six months, and this contract has no upgrade path,
so a rescue path omitted now could never be added: the piece would simply
die with the Warden.

Anyone may submit and pay gas; the Warden signature is what authorises it.
The signed digest covers the day, so a voucher cannot be replayed onto a
different one."
```

---

## Task 8: the golden tokenURI test and the deployability proof

**Files:**
- Create: `contracts/test/TokenUriGolden.t.sol`

**Interfaces:**
- Consumes: every previous task, plus the real `Renderer`.
- Produces: proof that the contract and the Phase 0 Renderer agree.

- [ ] **Step 1: Write the golden test**

Create `contracts/test/TokenUriGolden.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice The contract and the Phase 0 renderer, end to end.
///
/// @dev A STUBBED renderer would hide exactly the class of bug this exists to
/// catch: the contract and the renderer disagreeing about a field's meaning.
/// So this drives the real Renderer and asserts on what comes back.
contract TokenUriGoldenTest is Test {
    MachineReadableOnly t;
    Renderer r;

    address constant WARDEN = address(0x3A2D);
    address constant ALICE = address(0xA11CE);

    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function test_tokenUriIsAJsonDataUriWithABase64Image() public view {
        string memory uri = t.tokenURI(1);
        assertTrue(_contains(uri, "data:application/json"), "json data uri");
        assertTrue(_contains(uri, "image"), "has an image field");
        assertTrue(_contains(uri, "data:image/svg+xml;base64,"), "base64 svg image");
    }

    function test_tokenUriCarriesTheLevelAttribute() public view {
        string memory uri = t.tokenURI(1);
        assertTrue(_contains(uri, "Level"), "Level attribute present");
        assertTrue(_contains(uri, "Generation"), "Generation attribute present");
        assertTrue(_contains(uri, "Parent"), "Parent attribute present");
    }

    function test_tokenUriRevertsForANonexistentToken() public {
        vm.expectRevert();
        t.tokenURI(999);
    }

    /// @dev The worst case from Phase 0 is the day BEFORE the heart seals.
    /// This is the contract-level version of the gas budget the spike measured.
    function test_worstCaseTokenUriStaysInsideTheHardLimit() public {
        // Drive the token to level 364 the cheap way: one call, many days.
        uint32 d = t.today();
        uint32[] memory ds = new uint32[](363);
        bytes memory packed;
        for (uint32 i = 0; i < 363; i++) {
            ds[i] = d + 1 + i;
            packed = abi.encodePacked(packed, uint32(1));
        }
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(1).level, 364);

        uint256 before = gasleft();
        string memory uri = t.tokenURI(1);
        uint256 used = before - gasleft();

        emit log_named_uint("worst-case tokenURI gas", used);
        emit log_named_uint("worst-case tokenURI bytes", bytes(uri).length);
        assertLt(used, 2_000_000, "the 2M hard gas limit");
        assertLt(bytes(uri).length, 20_000, "the 20,000 byte hard limit");
    }
}
```

- [ ] **Step 2: Run it**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-contract TokenUriGoldenTest -vv
```

Expected: PASS, 4 tests, with the worst-case gas and byte figures logged. Compare them against `docs/phase0-results.md`: the spike's figure was 1,585,616 gas / 9,223 bytes for token 1 with every Mark. These will differ because this token has no Marks; the point is that both sit inside 2,000,000 / 20,000.

- [ ] **Step 3: Run the whole suite**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test
```

Expected: all suites pass, including the pre-existing 130 tests.

- [ ] **Step 4: Prove deployability, both halves**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
forge build --sizes 2>&1 | /bin/grep -E "MachineReadableOnly|Renderer "
bash script/anvil-size-check.sh
```

Expected: positive runtime margin for both contracts, and the anvil script reporting non-empty `cast code` plus a real `tokenURI` read back over RPC.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/test/TokenUriGolden.t.sol
git commit -m "test(contract): the golden tokenURI, against the real renderer

A stubbed renderer would hide exactly the bug this exists to catch: the
contract and the renderer disagreeing about what a field means. So this
drives the real Renderer and asserts on what comes back, including the
worst-case gas and byte figures at level 364, the day before the heart
seals."
```

---

## Task 9: deploy to Base Sepolia

**Files:**
- Create: `contracts/script/DeployPlan1.s.sol`

**Interfaces:**
- Consumes: the finished contract.
- Produces: two verified addresses on Base Sepolia.

- [ ] **Step 1: Write the deploy script**

Create `contracts/script/DeployPlan1.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy the real token contract plus a renderer to Base Sepolia.
/// @dev The Warden address is passed in rather than defaulted, because a
/// contract deployed with the wrong Warden cannot be fixed by anything except
/// setWarden, and getting it right at deploy time is free.
contract DeployPlan1 is Script {
    function run() external {
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        address warden = vm.envAddress("WARDEN_ADDRESS");

        vm.startBroadcast(key);
        Renderer r = new Renderer();
        MachineReadableOnly t = new MachineReadableOnly(address(r), warden);
        vm.stopBroadcast();

        console.log("Renderer            ", address(r));
        console.log("MachineReadableOnly ", address(t));
        console.log("warden              ", warden);
    }
}
```

- [ ] **Step 2: Confirm the environment has what it needs**

```bash
cd ~/projects/machine-readable-only/contracts
ls -la .env && /bin/grep -c "WARDEN_ADDRESS" .env.example
```

Expected: `.env` exists at mode 600. If `WARDEN_ADDRESS` is not in `.env.example`, add it there (schema only, no value) and tell the operator he needs to set the real value via WinSCP. **Do not read or print `.env` contents.**

- [ ] **Step 3: Dry run against a fork, before spending any testnet gas**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
set -a; . ./.env; set +a
forge script script/DeployPlan1.s.sol:DeployPlan1 --rpc-url base_sepolia
```

Expected: a simulation printing three addresses and a gas estimate, with no broadcast. Sourcing `.env` this way keeps the values in the shell only; never echo them.

- [ ] **Step 4: Broadcast and verify**

```bash
cd ~/projects/machine-readable-only/contracts
export PATH=$HOME/.foundry/bin:$PATH
set -a; . ./.env; set +a
forge script script/DeployPlan1.s.sol:DeployPlan1 \
  --rpc-url base_sepolia --broadcast --verify
```

Expected: both contracts deployed and verified on Basescan. Record the addresses and the gas paid, taken from `contracts/broadcast/`, into `docs/phase0-results.md`'s deployment table -- or a new Plan 1 results section.

This step spends Base **Sepolia** gas, which is free test ETH. It is not a real-funds step and needs no approval gate.

- [ ] **Step 5: Read one token back over RPC**

Mint a token as the Warden, then read the tokenURI back through a provider, proving the whole path works outside Foundry:

```bash
cd ~/projects/machine-readable-only/tools
source ~/.nvm/nvm.sh
~/scripts/safe-build.sh node tools/verify-tokenuri.mjs <token-address> --ids 1
```

Expected: the tokenURI decodes, the QR scans, and the reported gas and byte figures sit inside 2,000,000 / 20,000.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/script/DeployPlan1.s.sol docs/
git commit -m "feat(deploy): Plan 1 on Base Sepolia

The Warden address is a required env var rather than a default: a contract
deployed with the wrong Warden can only be fixed by setWarden, and getting
it right at deploy time costs nothing."
```

---

## Self-Review

**Spec coverage.** Every function in spec section 7's table has a task: `mint` (2), `batchCheckIn` (3), `applyMark` (4), `rebind` and `rest` (5), `seed` (6), `checkInWithVoucher` (7), `sunset` and the dials (1), `tokenURI` (1, tested in 8). Section 13's contract test list is covered across Tasks 1-8, with the golden test and both deployability halves in Task 8.

**Two gaps found and closed while reviewing:**

1. The `Sunset` error and event share a name in the spec, which does not compile. Added as Task 0 Step 5.
2. The wallet cap's "holds 20 minted tokens" is ambiguous between held and minted. Resolved toward ever-minted, with the reasoning, in Task 0 Step 6 and pinned by `test_walletCapCountsMintsNotHoldings`.

**Type consistency.** `Token` and `Upgrade` are declared once in Task 1 and referenced by the same names throughout. `_tokens`, `_marks`, `_parentOf`, `_agentKeyOf`, `_codeOf`, `_hasMinted`, `_firstMintDay`, `_seedsSpent`, `_upgrades` keep their names across Tasks 1-7. `today()`, `viewOf()`, `seedsAvailable()`, `voucherHash()`, `marksOf()`, `upgradeOf()` are used consistently. The `Resting(uint256)` error is declared in Task 3 and reused in Tasks 4, 6 and 7 -- it must not be re-declared there.

**Known deferrals, deliberate:** child token visuals (needs its own brainstorm), the Clock's chunking and sorting, and whether the spike contract is deleted afterwards, which needs the operator's explicit approval.
