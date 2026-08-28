# MRO Phase 0 Rendering Spike -- Plan Revision 2 (Tasks 3-11)

Supersedes Tasks 3-11 of `docs/plans/2026-08-27-mro-phase0-rendering-spike.md`.
Tasks 1 and 2 of that plan are done and stay done, though Task 2 was rebuilt
around a different design; see commits `a321c6f` and `eb0d1fc`.

## Why this revision exists

The original plan drew a small static QR with 365 heart cells arranged around
it. Built and reviewed on 2026-08-27, that composition was rejected: the code
plus its mandatory quiet zone claimed 61% of the canvas before the heart got
anything, so the heart could only ever be a thin outline strangling a square.

The design now is the inversion. The heart IS the code, drawn by QArt module
reshuffling, with a two-ring frame outside it that fills one cell per credited
day. That changes what the contracts must draw, so Tasks 3 through 11 no longer
describe the work.

**What this unblocks:** the same thing as before. Phase 0 answers one question
with numbers -- can the image be rendered by contracts on Base inside the gas
and size budget, does it decode from the real on-chain SVG, and does OpenSea
display and refresh it. Plans 2-5 (token contract, Warden, client, Clock) stay
blocked until it passes.

## What is already proven

Measured on 2026-08-27, all under `tools/` with 25 passing tests:

- The QArt heart works at QR version 5, level L: 70.9% of modules land on the
  target at a fixed mask, 72.4% averaged when all eight masks are searched.
- Per-token variance is narrow (1.6 points across twelve token ids), so no
  collector draws a visibly worse heart.
- Emitting same-colour runs as grouped `<path>` elements instead of one `<rect>`
  per cell cuts the SVG from 70,298 to about 5,000 bytes -- roughly 9,200 bytes
  of `tokenURI` against a 20,000 limit. **This is the single technique that puts
  the design inside budget** and the Solidity renderer must reproduce it.
- The spec's streak palette cannot colour a scannable code; four of five tiers
  fail the 4.5:1 contrast a scanner needs. A darkened palette clears every tier.

**Still unmeasured, and the real risk: gas.** Every number above is bytes. The
2,000,000 gas half of the budget has not been touched, and string building in
Solidity is where gas goes.

## Architecture

The Nouns-style descriptor split survives, but the pieces change. The heart is
no longer drawn from geometry -- it arrives as a per-token bitmap -- so
`HeartRenderer` is replaced by `CodeRenderer`, and the frame gets its own
renderer.

```
contracts/src/render/
  TokenView.sol       the struct every renderer consumes
  HeartMask.sol       GENERATED: the 37x37 heart target, 172 bytes, SHARED
  FrameGeometry.sol   GENERATED: 376 day-frame cells (done, eb0d1fc)
  Palette.sol         streak tiers, noise tone, ghost tone, contrast-checked
  CodeRenderer.sol    the code block as two paths, heart modules and noise
  FrameRenderer.sol   day frame, ghost cells, year rings
  MarkRenderer.sol    the seven Marks
  Renderer.sol        assembles SVG + JSON + base64; IRenderer
  IRenderer.sol
  spike/MROSpikeToken.sol   stub ERC-721, owner-settable state, ERC-4906
```

**One decision worth stating plainly:** the heart target is identical for every
token -- only the noise differs -- so `HeartMask.sol` stores it **once as a
shared constant**, not per token. Storing it per token would add 172 bytes to
every mint for no information. This is what makes duotone affordable.

## Global constraints

- Everything from the original plan's Global Constraints still holds: Solidity
  0.8.35, EVM `cancun`, OpenZeppelin v5.7.0, Solady v0.1.26, plain ASCII, no
  identifiers, no AI attribution, secrets only in the contracts env file, builds
  through `~/scripts/safe-build.sh`, `/bin/grep` never bare `grep`.
- Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`.
- **Budgets (unchanged):** `tokenURI` passes under 2,000,000 gas and 20,000
  bytes, targets 1,000,000 and 5,000. Every contract under 24,576 bytes runtime
  with positive margin.
- **Geometry (new):** QR version 5, level L, 37x37 modules, 4-cell quiet zone,
  45-cell code block. Day frame is two rings immediately outside the block, 376
  cells on a 49x49 local grid, 365 for days and 11 that light only at wholeness.
  Canvas is `45 + 2*(2 + 1 + years)`, so 51 at year zero.
- **Palette (new, contrast-checked against white):** streak 1-2 `#6f6f6f` 5.02,
  3-6 `#8e5566` 5.77, 7-29 `#a83a55` 6.17, 30-99 `#bd2242` 6.05, 100+ `#c8102e`
  5.88. Noise modules `#767676` 4.54. Ghost frame cells `#f4eef0`. Every one of
  these is a test assertion, not a comment.
- **Marks:** the ladder in `docs/2026-08-27-mro-mark-surfaces.md`. Voice is
  redefined (quiet-zone tint plus receipts in attributes), so the old
  `voiceQr` second code is gone.

> **operator-manual steps in this plan.** After completing any of these, tell Claude
> so it can update memory immediately.
> - **Task 3:** scan `docs/scan-test.png` with a phone and report failures.
>   This is the last unverified assumption in the whole design.
> - **Task 9:** put the RPC URLs, Etherscan key and spike private key into the
>   contracts env file via WinSCP, and fund the spike key with Base Sepolia ETH
>   from the CDP faucet.
> - **Task 10:** approve the throwaway Base **mainnet** deploy, create an
>   OpenSea API key, and fund the spike key with about 0.001 ETH on mainnet.
>
> **Irreversible:** Task 10 puts a throwaway contract and three tokens on Base
> mainnet permanently. Named "MRO Spike (throwaway)", not the collection.
> Nothing else here is irreversible.
>
> **Trade-off stated up front:** this plan builds real renderers, not mock-ups,
> so Plan 2 reuses them unchanged. That makes it longer than a pure probe but
> avoids drawing the artwork twice.

---

## Task 3: Bitmap CLI, shared heart mask, and the phone scan gate

**Why:** the contracts need two byte strings -- a per-token code bitmap and the
one shared heart mask -- and nothing downstream can be tested without them.
This task also closes the last unverified assumption in the design.

**Files:**
- Create: `tools/heart-mask.mjs`, `tools/token-bitmap.mjs`,
  `tools/test/token-bitmap.test.mjs`
- Generates: `contracts/src/render/HeartMask.sol`

**Interfaces produced:**
- `tokenBitmap(domain, tokenId) -> { hex, mask, match, size: 37, bytes: 172 }`,
  packing row-major, bit 7 of byte 0 is module (0,0) -- the same packing
  `qart.packModules` already produces.
- `HeartMask.sol`: `library HeartMask { uint256 constant SIZE = 37; function bits() internal pure returns (bytes memory); }` returning 172 bytes.
- CLI: `node token-bitmap.mjs <id>` prints the hex, for the deploy script.

**Steps:**

1. Write `tools/test/token-bitmap.test.mjs` first: the CLI's hex round-trips
   through `unpackModules` to the same modules `bestOfAllMasks` produced; the
   hex is exactly 344 characters; two ids give different hex; the heart mask is
   identical regardless of token id.
2. Run the tests, confirm they fail for the right reason (missing module, not a
   runner error -- `node --test test/` with a trailing slash fails spuriously on
   Node 24; the script is bare `node --test`).
3. Write `tools/heart-mask.mjs`, generating `HeartMask.sol` from
   `heart-target.mjs` with a `// GENERATED` header.
4. Write `tools/token-bitmap.mjs` wrapping `bestOfAllMasks` and `packModules`.
5. Run the tests to green, generate `HeartMask.sol`, and confirm it compiles
   with `forge build --sizes`.
6. **operator-manual gate:** the operator scans `docs/scan-test.png` at 100% zoom and reports
   which tiles fail. Expected: all pass; the marginal ones are tile 3 (base at
   120px) and tile 10 (inverted at 180px). **If tiles 6 or 7 fail, stop** -- that
   is the low-streak grey state, and it would mean new tokens do not scan, which
   changes the palette rather than the code.
7. Commit.

## Task 4: `TokenView` and `Palette`

**Why:** every renderer consumes one struct and one colour table. Fixing them
first stops the later tasks disagreeing about field names.

**Files:**
- Create: `contracts/src/render/TokenView.sol`,
  `contracts/src/render/Palette.sol`, `contracts/test/Palette.t.sol`

**Interfaces produced:**

```solidity
struct TokenView {
    uint256 tokenId;
    uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay;
    uint32 generation; uint32 seedsGiven;
    bool resting; bool sunset;
    uint256 marks;      // bit n = mark id n (1 Vein .. 7 Singularity)
    bytes32 agentKeyId;
    bytes code;         // 172 bytes, packed 37x37, written once at mint
    uint32 today;       // block.timestamp / 86400, supplied by the token contract
}
library Palette {
    function tier(uint32 streak) internal pure returns (string memory);
    function lapsed(uint32 streak, uint32 lastDay, uint32 today) internal pure returns (string memory);
    function noise() internal pure returns (string memory);   // "#767676"
    function ghost() internal pure returns (string memory);   // "#f4eef0"
}
```

**Steps:**

1. Write `Palette.t.sol` first, asserting each tier boundary (0, 2, 3, 6, 7, 29,
   30, 99, 100) returns the exact hex string, and that the lapse steps behave.
2. Confirm the tests fail.
3. Write `TokenView.sol` and `Palette.sol`.
4. Green, `forge build --sizes`, commit.

**Note on lapse.** The spec pales the heart in steps at 3, 7 and 30 days lapsed.
Those pale tones will fail the contrast bar exactly as the original streak
palette did. **Compute the lapsed tones and assert their contrast in the test**;
if any falls under 4.5:1, the lapse must be carried by the frame alone and the
code holds its last scannable tier. Decide this in Task 4, not later.

## Task 5: `CodeRenderer`

**Why:** the code block is most of the image and most of the gas. Getting its
path emission right is what makes or breaks the budget.

**Files:**
- Create: `contracts/src/render/CodeRenderer.sol`,
  `contracts/test/CodeRenderer.t.sol`

**Interfaces produced:**

```solidity
library CodeRenderer {
    // Emits two <path> elements: heart modules in `heartFill`, the rest in `noiseFill`.
    // Same-colour horizontal runs are merged, which is what keeps the SVG near 5 KB.
    function paths(bytes memory code, bytes memory mask, uint256 offset,
                   string memory heartFill, string memory noiseFill)
        internal pure returns (string memory);
    function isDark(bytes memory packed, uint256 k) internal pure returns (bool);
}
```

**Steps:**

1. Write `CodeRenderer.t.sol` first. Assert: `isDark` matches the known packing
   for a fixture bitmap; a single isolated module emits `M{x} {y}h1v1h-1z`; a
   run of five emits `h5`; output contains exactly two `<path` elements; the
   heart path and noise path never cover the same cell.
2. Confirm failure.
3. Implement using Solady `DynamicBufferLib` for concatenation and `LibString`
   for number formatting. Run-merge per row.
4. Green. Record `forge test --gas-report` for `paths` -- this is the first real
   gas number in the whole spike and belongs in the results file.
5. Commit.

## Task 6: `FrameRenderer`

**Why:** the frame carries the accumulation, which is the piece's subject.

**Files:**
- Create: `contracts/src/render/FrameRenderer.sol`,
  `contracts/test/FrameGeometry.t.sol`, `contracts/test/FrameRenderer.t.sol`

**Interfaces produced:**

```solidity
library FrameRenderer {
    function canvas(uint32 years) internal pure returns (uint256);   // 45 + 2*(3 + years)
    function paths(TokenView memory v, string memory colour, string memory ghostFill)
        internal pure returns (string memory);   // day frame, ghost cells, year rings
}
```

**Steps:**

1. Write `FrameGeometry.t.sol` first, mirroring the Node tests: 376 cells, all in
   the two rings, none inside the block, first cell on the top row, the last 11
   low on the grid.
2. Write `FrameRenderer.t.sol`: cells lit equals `min(level, 365)` below
   wholeness; at `level >= 365` all 376 light and no ghost cells remain; canvas
   grows two per completed year; year rings never overlap the frame.
3. Confirm failure, implement, green.
4. `forge build --sizes`, commit.

## Task 7: `MarkRenderer`, `Renderer`, `IRenderer`

**Why:** this assembles the image and the JSON, and is where the size budget is
finally decided.

**Files:**
- Create: `contracts/src/render/MarkRenderer.sol`,
  `contracts/src/render/Renderer.sol`, `contracts/src/render/IRenderer.sol`,
  `contracts/test/MarkRenderer.t.sol`, `contracts/test/Renderer.t.sol`

**Interfaces produced:**

```solidity
interface IRenderer { function tokenURI(TokenView memory v) external view returns (string memory); }
library MarkRenderer {
    uint256 constant VEIN = 1<<1; uint256 constant PULSE = 1<<2; uint256 constant VOICE = 1<<3;
    uint256 constant BLOOM = 1<<4; uint256 constant HALO = 1<<5; uint256 constant CROWN = 1<<6;
    uint256 constant SINGULARITY = 1<<7;
    function has(uint256 marks, uint256 bit) internal pure returns (bool);
    function field(uint256 marks) internal pure returns (string memory);      // Halo tint or white
    function ghost(uint256 marks) internal pure returns (string memory);      // Vein darkens the ghost
    function frameFill(uint256 marks, string memory colour) internal pure returns (string memory); // Crown gold
    function heartFill(uint256 marks, string memory colour) internal pure returns (string memory); // Bloom gradient
    function quietTint(uint256 marks) internal pure returns (string memory);  // Voice
    function defs(uint256 marks) internal pure returns (string memory);       // Bloom gradient defs
    function names(uint256 marks) internal pure returns (string memory);      // JSON array
}
```

**Steps:**

1. Write `MarkRenderer.t.sol` first: each Mark changes the output; no two Marks
   write the same attribute; `names()` matches the ladder order; a Bloom gradient
   stop never falls below 4.5:1 contrast.
2. Write `Renderer.t.sol` including the **differential test** described below.
3. Confirm failure, implement, green.
4. Commit.

**The differential test is the important part of this task.**
`tools/render-token.mjs` is the reference renderer. Have Node write fixtures to
`tools/out/fixtures.json` -- an array of `{ state, svg }` for the six life
stages and each Mark -- then have `Renderer.t.sol` read that file through
Foundry's `vm.readFile` and assert `keccak256(actual) == keccak256(expected)`.
Add `tools/out` to `fs_permissions` in `foundry.toml` for this.

Two renderers that must agree, checked byte for byte, is far stronger than
asserting substrings, and it means a change to the Node reference can never
silently diverge from the contract.

## Task 8: `MROSpikeToken`, size guard and gas budget

**Why:** this is the task that produces the spike's headline numbers.

**Files:**
- Create: `contracts/src/spike/MROSpikeToken.sol`,
  `contracts/test/MROSpikeToken.t.sol`, `contracts/test/ContractSize.t.sol`,
  `contracts/test/GasBudget.t.sol`

**Interfaces produced:**

```solidity
contract MROSpikeToken is ERC721, Ownable, IERC4906 {
    struct State { uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay;
                   uint32 generation; uint32 seedsGiven; bool resting; bool sunset;
                   uint256 marks; bytes32 agentKeyId; bytes code; }
    constructor(address renderer_);
    function mint(uint256 id, address to, bytes calldata code) external onlyOwner;
    function setState(uint256 id, State calldata s) external onlyOwner;   // emits MetadataUpdate
    function touchRange(uint256 from, uint256 to) external onlyOwner;     // emits BatchMetadataUpdate
    function setRenderer(address r) external onlyOwner;
    function setSunset(bool on) external onlyOwner;
    function today() public view returns (uint32);
    function tokenURI(uint256 id) public view override returns (string memory);
}
```

**Steps:**

1. Write the tests first. Per the global smart-contract rules, **every owner
   function gets an explicit test and every access-control revert gets a test**:
   `mint`, `setState`, `touchRange`, `setRenderer`, `setSunset` each from a
   non-owner must revert, plus the Ownable2Step transfer flow.
2. `ContractSize.t.sol`: every contract under 24,576 bytes with positive margin,
   asserted, plus a strict-limit anvil deploy with non-empty `cast code`.
3. `GasBudget.t.sol`: `tokenURI` gas and byte length at six states -- day 1,
   day 200, whole, whole and lapsed, three years, and all Marks set. Assert
   under 2,000,000 gas and 20,000 bytes; log the numbers whether or not they
   pass so the results table can be filled either way.
4. Implement, green, `forge build --sizes`, commit.

**If the gas budget fails here, stop and re-plan.** The fallback ladder from the
original plan still applies: (a) further path compression, (b) rings and Bloom
become flat fills, (c) off-chain renderer with on-chain SVG as a permanent
fallback -- and (c) is a spec change needing the operator's approval, not a fix.

## Task 9: Deploy script, local run, end-to-end decode

**Why:** a rendered SVG that a decoder cannot read is a failed spike, and only
the real on-chain output settles that.

**Files:**
- Create: `contracts/script/DeploySpike.s.sol`, `tools/verify-tokenuri.mjs`,
  `tools/test/verify-tokenuri.test.mjs`

**Interfaces produced:**
- `decodeTokenUri(uri) -> { json, svg }`
- `verifyToken({ rpcUrl, address, id, expectedUrl }) -> { ok, decoded, gasEstimate, bytes, pngPath }`

**Steps:**

1. Write `DeploySpike.s.sol`, minting three tokens: id 1 at day one, id 2 at
   level 200 with streak 45 and Vein plus Bloom, id 3 whole with streak 400,
   one year, and every Mark except Singularity.
2. Write `verify-tokenuri.mjs`: read `tokenURI` over RPC with viem, split the
   data URI, base64-decode, rasterise the SVG with resvg, decode with jsqr,
   assert the payload matches, and report gas and byte length.
3. Run against a local anvil end to end.
4. Green, commit.

## Task 10: Base Sepolia deployment (operator-manual funding)

**Why:** a public RPC applies caps a local anvil does not, and a `tokenURI` that
only works locally is not proven.

**Files:** create `docs/phase0-results.md`, first section.

**Steps:**

1. `cast wallet new`, then **operator-manual:** put the private key into the contracts
   env file as `SPIKE_DEPLOYER_KEY` via WinSCP alongside the RPC URLs and
   Etherscan key, and fund the address from the CDP faucet. Do not print the key
   anywhere else. Wait for the operator to confirm both.
2. Deploy and verify with `forge script ... --rpc-url base_sepolia --broadcast --verify`.
3. Read `tokenURI` back from the public RPC, confirm it does not hit the
   provider's `eth_call` gas cap, and run `verify-tokenuri.mjs` against it.
4. Record every number in `docs/phase0-results.md`.

## Task 11: Throwaway mainnet deploy for the OpenSea test (the operator approval)

**Why:** OpenSea discontinued all testnet support in July 2025, so display and
refresh behaviour can only be checked on mainnet.

**This is the irreversible step.** Before any `--broadcast` against `base`, state
to the operator: "This deploys `MRO Spike (throwaway)` and three tokens to Base mainnet
permanently, costs about $1 in ETH, and is not the collection. Approve?" Proceed
only on an explicit yes.

**Files:** create `tools/opensea-check.mjs`; modify `docs/phase0-results.md`.

**Steps:**

1. **operator-manual:** OpenSea API key into the env file, about 0.001 ETH on Base
   mainnet to the spike address.
2. Write `opensea-check.mjs` (GET the token, optionally POST a refresh).
3. Deploy on explicit approval.
4. Confirm OpenSea renders the image, flattens the SVG to PNG, and that the
   flattened PNG still decodes -- **rasterise their PNG and run it through jsqr**,
   do not eyeball it.
5. Change a token's state, emit ERC-4906 with the exact range **after** the
   write, call the refresh endpoint, and time how long the new image takes to
   appear. Record it.

## Task 12: Go / no-go and spec amendment

**Files:** modify `docs/phase0-results.md`,
`docs/specs/2026-08-27-machine-readable-only-design.md`.

**Steps:**

1. Write the verdict as one of exactly three outcomes: `PASS`,
   `PASS WITH FALLBACK (a) or (b)`, or `FAIL` with the failing criterion. Under
   it, the measured table with every cell filled, then "What surprised us", three
   bullets maximum, facts only.
2. **Amend the spec.** This revision needs more than the original plan expected.
   Section 8 (what is drawn) is rewritten around the code-heart; the Marks table
   is replaced by the ladder in `docs/2026-08-27-mro-mark-surfaces.md`; the
   streak palette is replaced with the contrast-checked one; the canvas, QR
   version and quiet-zone numbers change; the `voiceQr` second code is removed.
   Render the HTML alongside the markdown.
3. Update memory and commit.

## What this plan deliberately does not build

The real token contract, the Warden, the Clock and the reference client. Those
are Plans 2-5 and stay blocked until the verdict in Task 12 is `PASS`.

## Self-review

- **Coverage.** Gas and size (Tasks 5, 8), renderer split (Tasks 5-7), decode
  from real on-chain SVG (Tasks 9-10), OpenSea display and refresh (Task 11),
  contract sizes and access control (Task 8), the phone scan gate (Task 3),
  fallback ladder (Task 8), spec amendment (Task 12).
- **Carried forward unchanged from the original plan:** the fallback ladder, the
  budgets, the mainnet-only OpenSea reasoning, the TokenView lineage fields
  (`generation`, `seedsGiven`, `resting`, `sunset`) so Plan 2 needs no renderer
  change.
- **Known gaps, stated rather than hidden.** Gas is entirely unmeasured until
  Task 5. The lapse palette may fail contrast and Task 4 forces that decision
  early rather than discovering it in Task 7. The phone scan test is the last
  unverified assumption and gates Task 3.
