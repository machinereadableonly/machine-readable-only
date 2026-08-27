# MRO Phase 0: Rendering Spike -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, with numbers, that Machine Readable Only's fully on-chain image (static QR + 365-cell heart + rings + seven Marks) can be rendered by contracts on Base within the spec's gas and size budget, decodes as a real QR from the actual on-chain SVG, and is displayed and refreshed by OpenSea; or fail loudly so a fallback is chosen before anything else is built.

**Why this plan exists (read first):** The spec (section 8) says nothing else gets built until this passes. Every comparable project that claimed on-chain art and did not test marketplace display got flattened to one thumbnail (Claws on Magic Eden). Measured `tokenURI` gas on mainnet ranges from 572k (Loot) to 28M (Terraforms); 24-28M only works because RPC providers allow it. This spike settles the numbers on Base with the real drawing, and settles OpenSea's behaviour with a throwaway mainnet contract because OpenSea discontinued all testnet support in July 2025. What it unblocks: Plans 2-5 (token contract, Warden, reference client, Clock and launch).

**Architecture:** A stub ERC-721 (`MROSpikeToken`, owner can set any token's state by hand) delegates `tokenURI` to a thin `Renderer` that calls three pure renderers (`QRRenderer`, `HeartRenderer`, `MarkRenderer`), the Nouns descriptor split, so the real token contract in Plan 2 reuses the renderers unchanged. Off-chain Node tools generate the heart geometry constant and the QR bitmaps, and verify the on-chain output by rendering the SVG to PNG and decoding the QR.

**Tech Stack:** Foundry 1.7.1 (forge, anvil, cast) on the VPS; Solidity 0.8.35, EVM `cancun` (matches base-200); OpenZeppelin Contracts v5.7.0 (git tag; npm `latest` is 5.6.1); Solady v0.1.26 (`DynamicBufferLib`, `LibString`, `Base64`); Node 24.14.1 via nvm with built-in `node:test`; npm `qrcode` 1.5.4, `@resvg/resvg-js` 2.6.2, `jsqr` 1.4.0, `viem` 2.56.0; Base Sepolia (chain 84532) and Base mainnet (8453) via Alchemy; OpenSea API v2.

**Spec:** `docs/superpowers/specs/2026-08-27-machine-readable-only-design.md` (sections 7, 8, 13 and the rendering-risks subsection). Comparable-projects evidence: `docs/superpowers/2026-08-27-mro-comparable-projects.md`.

> **operator-manual steps in this plan** (after completing any of these, tell Claude so it can update memory):
> - Task 1: put the Alchemy Base Sepolia and Base mainnet RPC URLs and the Etherscan V2 API key into `contracts/.env` via WinSCP (same keys base-200 uses).
> - Task 2: look at the heart preview PNG and say yes or tune it.
> - Task 9: fund the throwaway spike key with Base Sepolia ETH from the CDP faucet (0.1 ETH per 24 h, needs a CDP login).
> - Task 10: approve the throwaway **mainnet** deploy (public, permanent, about $1 in ETH), create an OpenSea API key, and fund the spike key with ~0.001 ETH on Base mainnet.
>
> **Irreversible:** Task 10 puts a throwaway contract and three tokens on Base mainnet forever. They are named "MRO Spike (throwaway)" and are not the collection. Nothing else in this plan is irreversible.
>
> **Trade-off stated up front:** the spike builds real renderers, not mock-ups, so Plan 2 reuses them; that makes this plan longer than a pure probe but avoids building the drawing twice.

## Global Constraints

- Repo lives on the VPS at `~/projects/machine-readable-only/` (hyphen convention). Commands below run in a VPS shell; from the PC hub wrap each in `ssh vps '...'`. Foundry binaries are at `~/.foundry/bin/` (not on the non-interactive PATH); Node needs `source ~/.nvm/nvm.sh` first. Every command block below assumes: `export PATH=$HOME/.foundry/bin:$PATH; source ~/.nvm/nvm.sh >/dev/null`.
- Solidity `0.8.35`, `evm_version = "cancun"`, optimizer on, `via_ir = false` unless a size test forces it (then say so in the commit message).
- OpenZeppelin `v5.7.0` and Solady `v0.1.26`, pinned by git tag via `forge install`.
- Plain ASCII in every file. No personal identifiers anywhere: use `<github-user>`, `example.com`, `you@example.com`. No AI attribution in commits.
- Secrets only in `contracts/.env` (chmod 600, operator-edited via WinSCP, gitignored). `.env.example` holds the schema. Claude never reads `.env`.
- No `curl | bash`. Foundry is already installed (1.7.1); do not run `foundryup`.
- Spec budgets (section 8): `tokenURI` **passes** at under 2,000,000 gas and under 20,000 bytes, **targets** 1,000,000 and 5,000; every contract under 24,576 bytes runtime with positive margin; QR version 3 (29x29), error correction L, 4-module quiet zone; canvas coordinates in whole cells; `image` is base64 SVG; `animation_url` present only with Pulse.
- Colour tiers (spec section 8): streak 1-2 grey `#9a9a9a`; 3-6 first tint `#d8a7b1`; 7-29 dusk pink `#e07a8d`; 30-99 rose `#d9455f`; 100+ red `#c8102e`. Lapse steps on live tokens: `lapsed = today - lastDay`; lapsed 3-6 `#e6c9cf`; 7-29 `#dcdcdc`; 30+ `#eeeeee`. Resting or sunset tokens keep their streak colour.
- Commit after every task. Commit messages describe the change only.

## File Structure

```
~/projects/machine-readable-only/
  CLAUDE.md                          4-section pattern + common-sections import
  README.md                          one paragraph + how to run tools and tests
  .gitignore                         node_modules, out, cache, broadcast, .env, *.png
  contracts/                         Foundry project
    foundry.toml
    remappings.txt
    .env.example
    src/render/TokenView.sol         the struct every renderer consumes
    src/render/HeartGeometry.sol     GENERATED constant: 365 (x,y) cells, canvas 61
    src/render/HeartRenderer.sol     heart cells, colours, lapse steps, rings
    src/render/QRRenderer.sol        29x29 module grid from 106 packed bytes, quiet zone
    src/render/MarkRenderer.sol      Vein, Pulse, Voice, Bloom, Halo, Crown, Singularity
    src/render/Renderer.sol          assembles SVG + JSON + base64; IRenderer
    src/render/IRenderer.sol         interface the token contract calls
    src/spike/MROSpikeToken.sol      stub ERC-721 with owner-settable state, ERC-4906
    test/HeartGeometry.t.sol
    test/HeartRenderer.t.sol
    test/QRRenderer.t.sol
    test/MarkRenderer.t.sol
    test/Renderer.t.sol
    test/MROSpikeToken.t.sol
    test/ContractSize.t.sol
    test/GasBudget.t.sol
    script/DeploySpike.s.sol         deploys renderers + stub, mints ids 1-3 with varied state
  tools/                             Node ESM, node:test
    package.json
    heart-geometry.mjs               writes HeartGeometry.sol, heart.json, preview.svg
    qr-bitmap.mjs                    url -> 106-byte hex (version 3, level L)
    svg-to-png.mjs                   resvg wrapper shared by tests and tools
    verify-tokenuri.mjs              reads tokenURI via viem, decodes, renders PNG, jsqr
    opensea-check.mjs                polls OpenSea API v2 for image_url/updated_at
    test/heart-geometry.test.mjs
    test/qr-bitmap.test.mjs
    test/verify-tokenuri.test.mjs
  docs/
    phase0-results.md                the deliverable: numbers and pass/fail per criterion
```

Interfaces that cross task boundaries are stated in each task's **Interfaces** block; later tasks use exactly those names.

---

### Task 1: Scaffold the repository and toolchain

**Files:**
- Create: `~/projects/machine-readable-only/` (git init), `CLAUDE.md`, `README.md`, `.gitignore`, `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/.env.example`, `tools/package.json`

**Interfaces:**
- Produces: the repo, remappings `@openzeppelin/contracts/`, `solady/`, `forge-std/`; npm scripts `test`, `heart`, `qr`, `verify`.

- [ ] **Step 1: Create the repo and the Foundry project**

```bash
mkdir -p ~/projects/machine-readable-only && cd ~/projects/machine-readable-only && git init -q
export PATH=$HOME/.foundry/bin:$PATH
forge init --no-git --no-commit contracts
rm -f contracts/src/Counter.sol contracts/test/Counter.t.sol contracts/script/Counter.s.sol
```

Expected: `contracts/` exists with `lib/forge-std`, empty `src/`, `test/`, `script/`.

- [ ] **Step 2: Install pinned libraries**

```bash
cd ~/projects/machine-readable-only/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git
forge install Vectorized/solady@v0.1.26 --no-git
ls lib
```

Expected: `forge-std  openzeppelin-contracts  solady`. (`--no-git` because the repo root is the project, not `contracts/`; the libs are vendored, matching how base-200's `lib/` is laid out.)

- [ ] **Step 3: Write `contracts/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.35"
evm_version = "cancun"   # Base (OP Stack) supports Cancun + PUSH0; matches base-200
optimizer = true
optimizer_runs = 200
fs_permissions = [{ access = "read", path = "./out" }]

[rpc_endpoints]
local        = "http://127.0.0.1:8545"
base_sepolia = "${ALCHEMY_BASE_SEPOLIA_RPC_URL}"
base         = "${ALCHEMY_BASE_MAINNET_RPC_URL}"

# Etherscan V2: one key, chain selected by ?chainid= (legacy Basescan keys are rejected)
[etherscan]
base_sepolia = { key = "${ETHERSCAN_API_KEY}", url = "https://api.etherscan.io/v2/api?chainid=84532", chain = 84532 }
base         = { key = "${ETHERSCAN_API_KEY}", url = "https://api.etherscan.io/v2/api?chainid=8453", chain = 8453 }
```

- [ ] **Step 4: Write `contracts/remappings.txt`**

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
solady/=lib/solady/
forge-std/=lib/forge-std/src/
```

- [ ] **Step 5: Write `contracts/.env.example`** (schema only; the operator fills the real `.env` via WinSCP)

```bash
# Throwaway deployer for the spike only. Generate with: cast wallet new
SPIKE_DEPLOYER_KEY=0xYOUR_THROWAWAY_PRIVATE_KEY
# Alchemy RPC URLs (same account as base-200)
ALCHEMY_BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
ALCHEMY_BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
# Etherscan V2 key (works for Base via ?chainid=)
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_V2_KEY
# OpenSea API v2 key, Task 10 only
OPENSEA_API_KEY=YOUR_OPENSEA_KEY
# Domain used inside QR payloads while the real domain is undecided
MRO_DOMAIN=example.com
```

- [ ] **Step 6: Write `.gitignore` at the repo root**

```
node_modules/
contracts/out/
contracts/cache/
contracts/broadcast/
contracts/.env
tools/out/
*.png
```

- [ ] **Step 7: Write `tools/package.json`**

```json
{
  "name": "mro-tools",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test test/",
    "heart": "node heart-geometry.mjs",
    "qr": "node qr-bitmap.mjs",
    "verify": "node verify-tokenuri.mjs"
  },
  "dependencies": {
    "@resvg/resvg-js": "2.6.2",
    "jsqr": "1.4.0",
    "qrcode": "1.5.4",
    "viem": "2.56.0"
  }
}
```

Provenance for the approval gate (all read from the npm registry on 2026-08-27): `qrcode` 1.5.4 (soldair, long-standing, tens of millions of weekly downloads); `@resvg/resvg-js` 2.6.2 (thx, Rust resvg binding, MPL-2.0); `jsqr` 1.4.0 (cozmo, Apache-2.0, pure JS decoder); `viem` 2.56.0 (wevm, the library luckdrop already uses). None is under a year old or single-anonymous-maintainer.

- [ ] **Step 8: Install Node dependencies**

```bash
cd ~/projects/machine-readable-only/tools && source ~/.nvm/nvm.sh >/dev/null && npm install
```

Expected: `added N packages`, no `npm audit` critical findings. If `@resvg/resvg-js` fails to fetch a prebuilt binary, the error names the platform; stop and report (it ships Linux x64 binaries, so this should not happen).

- [ ] **Step 9: Write `CLAUDE.md`** (4-section pattern, copied from scratch's shape)

```markdown
# Machine Readable Only -- Project Instructions

<!-- PROJECT-SPECIFIC SECTIONS -->

## What This Project Is

An agents-only NFT art piece on Base: agents prove they are programs with
signed requests, pay 0.10 USDC to mint, and keep a fully on-chain heart alive
with one check-in per UTC day. Spec and evidence live in the move-to-vps hub:
`docs/superpowers/specs/2026-08-27-machine-readable-only-design.md`.

- **Role:** the MRO contracts, renderers, Warden, Clock and reference client
- **Stack:** Foundry + Solidity 0.8.35 (contracts/), Node 24 (tools/, later warden/)
- **Status:** Phase 0 rendering spike (see the hub plan of 2026-08-27)
- **Secrets:** `contracts/.env` only, chmod 600, edited via WinSCP; never read by Claude
- **Environment:** VPS
- **Port:** not yet allocated (the Warden gets 3006 in Plan 3; see move-to-vps/docs/port-allocation.md)

## Hard Rules (never break these)

- **Every contract must be proven deployable:** `forge build --sizes` positive
  margin AND a strict-limit anvil deploy with non-empty `cast code` before it is
  called done. Hook: `test/ContractSize.t.sol` fails the suite otherwise.
- **Every owner/warden/emergency function has an explicit test** including its
  revert paths. Hook: review checklist.
- **Plain ASCII, no identifiers, no AI attribution** in any file or commit.
- **Mainnet is the operator's call.** Any `--broadcast` against `base` needs explicit
  approval in the session that runs it.

## Conventions

- Foundry commands run with `export PATH=$HOME/.foundry/bin:$PATH`; Node with
  `source ~/.nvm/nvm.sh`. Non-interactive ssh has neither on PATH.
- Tests: Foundry for Solidity, `node --test` for tools. Both must be green
  before a commit.
- Generated files (`src/render/HeartGeometry.sol`) carry a `// GENERATED by
  tools/heart-geometry.mjs` header and are never hand-edited.

## References

- Spec: move-to-vps `docs/superpowers/specs/2026-08-27-machine-readable-only-design.md`
- Comparables: move-to-vps `docs/superpowers/2026-08-27-mro-comparable-projects.md`
- Phase 0 plan: move-to-vps `docs/superpowers/plans/2026-08-27-mro-phase0-rendering-spike.md`
- Base docs: https://docs.base.org/base-chain/network-information/network-fees
- OpenSea metadata: https://docs.opensea.io/docs/media-and-traits ; refresh: https://docs.opensea.io/docs/updating-metadata

---

@~/.claude/templates/common-sections.md
```

- [ ] **Step 10: Write `README.md`**

```markdown
# Machine Readable Only

Agents-only NFT art piece on Base. This repo holds the contracts, renderers
and tools. Phase 0 (rendering spike) is in progress; see the plan in the
move-to-vps hub.

## Run

    export PATH=$HOME/.foundry/bin:$PATH; source ~/.nvm/nvm.sh
    cd contracts && forge test -vv && forge build --sizes
    cd ../tools && npm test
```

- [ ] **Step 11: Verify the empty project builds and commit**

```bash
cd ~/projects/machine-readable-only/contracts && forge build
cd .. && git add -A && git commit -q -m "chore: scaffold Foundry + tools workspace for the Phase 0 rendering spike"
```

Expected: `forge build` prints `Compiler run successful` (nothing to compile yet is also fine). Commit succeeds; the identifier hook passes.

---

### Task 2: Heart geometry generator (the design gate)

**Files:**
- Create: `tools/heart-geometry.mjs`, `tools/svg-to-png.mjs`, `tools/test/heart-geometry.test.mjs`
- Generates: `contracts/src/render/HeartGeometry.sol`, `tools/out/heart.json`, `tools/out/heart-preview.svg`, `tools/out/heart-preview-*.png`

**Interfaces:**
- Produces: `HeartGeometry.sol` with `library HeartGeometry { uint256 constant CANVAS = 61; uint256 constant QR_OFFSET = 16; uint256 constant CELL_COUNT = 365; function cells() internal pure returns (bytes memory) }` where `cells()` returns 730 bytes, cell `i` at bytes `[2i] = x`, `[2i+1] = y`, in fill order (index 0 fills first). `tools/svg-to-png.mjs` exports `svgToPng(svgString, widthPx) -> Uint8Array` and `svgToRgba(svgString, widthPx) -> { data: Uint8ClampedArray, width, height }`.

Design facts fixed here (the spec left the exact geometry to this plan): canvas 61x61 cells; the QR (29) plus its 4-cell quiet zone is a 37x37 block at offset 12, so the reserved block is cells 12..48 in both axes; the heart is the 365-cell band of the classic implicit heart `(x^2 + y^2 - 1)^3 - x^2 y^3 <= 0` that lies outside the reserved block, chosen as the 365 cells nearest the heart's boundary from the inside (an outline band, two to three cells thick, so it reads as a heart even at 12 cells filled); fill order is bottom point upward, alternating left and right of the centre column within each row.

- [ ] **Step 1: Write the failing tests**

`tools/test/heart-geometry.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { generateHeart, toSolidity } from "../heart-geometry.mjs";

const CANVAS = 61, QR0 = 12, QR1 = 48; // reserved block is [12,48] inclusive on both axes

test("exactly 365 unique cells, all on canvas, none inside the reserved block", () => {
  const cells = generateHeart();
  assert.equal(cells.length, 365);
  const seen = new Set();
  for (const [x, y] of cells) {
    assert.ok(x >= 0 && x < CANVAS && y >= 0 && y < CANVAS, `off canvas ${x},${y}`);
    assert.ok(!(x >= QR0 && x <= QR1 && y >= QR0 && y <= QR1), `inside block ${x},${y}`);
    const k = `${x},${y}`;
    assert.ok(!seen.has(k), `duplicate ${k}`);
    seen.add(k);
  }
});

test("fill order starts at the bottom and never moves up more than one row at a time", () => {
  const cells = generateHeart();
  assert.equal(cells[0][1], Math.max(...cells.map(c => c[1])), "first cell is on the lowest row");
  for (let i = 1; i < cells.length; i++) {
    assert.ok(cells[i][1] <= cells[i - 1][1], `row order broke at index ${i}`);
  }
});

test("Solidity output has the header, the constants and 730 hex bytes", () => {
  const sol = toSolidity(generateHeart());
  assert.match(sol, /GENERATED by tools\/heart-geometry.mjs/);
  assert.match(sol, /uint256 constant CANVAS = 61;/);
  assert.match(sol, /uint256 constant QR_OFFSET = 16;/);
  assert.match(sol, /uint256 constant CELL_COUNT = 365;/);
  const hex = sol.match(/hex"([0-9a-f]+)"/)[1];
  assert.equal(hex.length, 730 * 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/projects/machine-readable-only/tools && source ~/.nvm/nvm.sh >/dev/null && npm test
```

Expected: FAIL, `Cannot find module '../heart-geometry.mjs'`.

- [ ] **Step 3: Write `tools/svg-to-png.mjs`**

```js
// Shared rasteriser: SVG string -> PNG bytes or RGBA pixels, via resvg (Rust).
import { Resvg } from "@resvg/resvg-js";

export function svgToPng(svg, widthPx = 1024) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: widthPx } });
  return r.render().asPng();
}

export function svgToRgba(svg, widthPx = 1024) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: widthPx } });
  const img = r.render();
  return { data: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
}
```

- [ ] **Step 4: Write `tools/heart-geometry.mjs`**

```js
// Generates the 365-cell heart band around the QR block and freezes it as a
// Solidity constant. Deterministic: same input, same bytes, forever.
import { writeFileSync, mkdirSync } from "node:fs";
import { svgToPng } from "./svg-to-png.mjs";

export const CANVAS = 61;
export const QR_OFFSET = 16;        // where the 29x29 code starts (12 + 4 quiet zone)
export const BLOCK0 = 12, BLOCK1 = 48; // reserved 37x37 block, inclusive
export const CELL_COUNT = 365;

// Classic implicit heart. f <= 0 is inside. Centre of the canvas maps to (0, 0.1)
// so the lobes sit above the block and the point sits below it.
function heartF(x, y) {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y;
}

// Map a cell centre to heart coordinates. SCALE is the only tuning knob: it
// sets how far the heart clears the block. 0.052 gives a 2-3 cell band.
const SCALE = 0.052;
function toHeart(cx, cy) {
  const x = (cx - (CANVAS - 1) / 2) * SCALE;
  const y = -((cy - (CANVAS - 1) / 2) * SCALE) + 0.1; // SVG y grows downward
  return [x, y];
}

export function generateHeart() {
  const candidates = [];
  for (let cy = 0; cy < CANVAS; cy++) {
    for (let cx = 0; cx < CANVAS; cx++) {
      const inBlock = cx >= BLOCK0 && cx <= BLOCK1 && cy >= BLOCK0 && cy <= BLOCK1;
      if (inBlock) continue;
      const [x, y] = toHeart(cx, cy);
      const f = heartF(x, y);
      if (f <= 0) candidates.push({ cx, cy, f });
    }
  }
  if (candidates.length < CELL_COUNT) {
    throw new Error(`only ${candidates.length} heart cells outside the block; raise SCALE`);
  }
  // Outline band: the 365 inside cells closest to the boundary (largest f).
  candidates.sort((p, q) => q.f - p.f);
  const band = candidates.slice(0, CELL_COUNT);
  // Fill order: bottom row first; within a row, alternate left/right from the centre.
  const mid = (CANVAS - 1) / 2;
  band.sort((p, q) => {
    if (p.cy !== q.cy) return q.cy - p.cy;
    const dp = Math.abs(p.cx - mid), dq = Math.abs(q.cx - mid);
    if (dp !== dq) return dp - dq;
    return p.cx - q.cx;
  });
  return band.map(p => [p.cx, p.cy]);
}

export function toSolidity(cells) {
  const hex = cells.map(([x, y]) => x.toString(16).padStart(2, "0") + y.toString(16).padStart(2, "0")).join("");
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// GENERATED by tools/heart-geometry.mjs -- do not edit by hand.
// 365 (x, y) cells in fill order on a ${CANVAS}x${CANVAS} canvas; the 29x29 QR sits at
// offset ${QR_OFFSET} with a 4-cell quiet zone (reserved block ${BLOCK0}..${BLOCK1}).
library HeartGeometry {
    uint256 constant CANVAS = ${CANVAS};
    uint256 constant QR_OFFSET = ${QR_OFFSET};
    uint256 constant CELL_COUNT = ${CELL_COUNT};

    // Two bytes per cell: x then y. One CODECOPY into memory per call.
    function cells() internal pure returns (bytes memory) {
        return hex"${hex}";
    }
}
`;
}

export function previewSvg(cells, filled) {
  const rects = [];
  cells.forEach(([x, y], i) => {
    const fill = i < filled ? "#c8102e" : "#f1e3e6";
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
  });
  // The reserved block drawn as a placeholder for the code.
  rects.push(`<rect x="${QR_OFFSET}" y="${QR_OFFSET}" width="29" height="29" fill="#111"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="1220" height="1220" shape-rendering="crispEdges"><rect width="${CANVAS}" height="${CANVAS}" fill="#fff"/>${rects.join("")}</svg>`;
}

if (process.argv[1] && process.argv[1].endsWith("heart-geometry.mjs")) {
  const cells = generateHeart();
  mkdirSync("out", { recursive: true });
  writeFileSync("../contracts/src/render/HeartGeometry.sol", toSolidity(cells));
  writeFileSync("out/heart.json", JSON.stringify(cells));
  for (const n of [12, 90, 200, 365]) {
    const svg = previewSvg(cells, n);
    writeFileSync(`out/heart-preview-${n}.svg`, svg);
    writeFileSync(`out/heart-preview-${n}.png`, svgToPng(svg, 1220));
  }
  console.log(`wrote HeartGeometry.sol with ${cells.length} cells and four previews in tools/out/`);
}
```

- [ ] **Step 5: Run the tests**

```bash
cd ~/projects/machine-readable-only/tools && npm test
```

Expected: 3 tests pass. If the first test throws `only N heart cells outside the block`, raise `SCALE` in steps of 0.002 until it passes, then re-run.

- [ ] **Step 6: Generate the constant and the previews**

```bash
cd ~/projects/machine-readable-only/tools && mkdir -p ../contracts/src/render && npm run heart && ls -la out/
```

Expected: `HeartGeometry.sol` written; `heart-preview-12.png`, `-90`, `-200`, `-365` exist.

- [ ] **Step 7: Show the operator the previews (operator-manual gate)**

From the PC: `scp vps:~/projects/machine-readable-only/tools/out/heart-preview-*.png ~/Downloads/` and ask the operator to open them. The question is exactly: "Does the 12-cell one look like a finished object, and does the 365 one read as a heart around the code?" If no, adjust `SCALE` (bigger = heart clears the block by more) or the band selection, re-run Steps 5-6, repeat. Do not proceed until the operator says yes; the geometry is frozen after this.

- [ ] **Step 8: Commit**

```bash
cd ~/projects/machine-readable-only && git add tools contracts/src/render/HeartGeometry.sol && git commit -q -m "feat(render): generate the 365-cell heart geometry constant and previews"
```

---

### Task 3: QR bitmap tool

**Files:**
- Create: `tools/qr-bitmap.mjs`, `tools/test/qr-bitmap.test.mjs`

**Interfaces:**
- Produces: `qrBitmap(text) -> { version: 3, size: 29, packedHex: string /* 212 hex chars = 106 bytes */, modules: Uint8Array /* 841 */ }`; `unpack(packedHex) -> Uint8Array(841)`; `modulesToSvg(modules, offset, canvas) -> string` (used by tests and by `verify-tokenuri`). Packing is row-major, bit 7 of byte 0 is module (0,0).

- [ ] **Step 1: Write the failing tests**

`tools/test/qr-bitmap.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { qrBitmap, unpack, modulesToSvg } from "../qr-bitmap.mjs";
import { svgToRgba } from "../svg-to-png.mjs";

const URL = "https://example.com/t/10000";

test("payload fits a version-3 level-L code and packs to 106 bytes", () => {
  const q = qrBitmap(URL);
  assert.equal(q.version, 3);
  assert.equal(q.size, 29);
  assert.equal(q.packedHex.length, 212);
  assert.equal(q.modules.length, 841);
});

test("unpack reverses pack exactly", () => {
  const q = qrBitmap(URL);
  assert.deepEqual(Array.from(unpack(q.packedHex)), Array.from(q.modules));
});

test("a too-long payload fails loudly instead of silently growing the code", () => {
  assert.throws(() => qrBitmap("https://" + "a".repeat(60) + ".com/t/1"), /version 3/);
});

test("the drawn code decodes back to the payload", () => {
  const q = qrBitmap(URL);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 61 61" width="1220" height="1220" shape-rendering="crispEdges"><rect width="61" height="61" fill="#fff"/>${modulesToSvg(q.modules, 16)}</svg>`;
  const { data, width, height } = svgToRgba(svg, 1220);
  const hit = jsQR(data, width, height);
  assert.ok(hit, "jsQR found no code");
  assert.equal(hit.data, URL);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/tools && npm test
```

Expected: the four new tests FAIL with `Cannot find module '../qr-bitmap.mjs'`.

- [ ] **Step 3: Write `tools/qr-bitmap.mjs`**

```js
// Builds the static identity QR for a token and packs its modules into the
// 106 bytes the contract stores. Version 3 (29x29), error correction L.
import QRCode from "qrcode";

export const SIZE = 29;
export const BYTES = 106; // ceil(841 / 8)

export function qrBitmap(text) {
  const code = QRCode.create(text, { version: 3, errorCorrectionLevel: "L" });
  if (code.version !== 3 || code.modules.size !== SIZE) {
    throw new Error(`payload does not fit version 3 level L (got version ${code.version}); shorten the domain or path`);
  }
  const modules = new Uint8Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) modules[r * SIZE + c] = code.modules.get(r, c) ? 1 : 0;
  const bytes = new Uint8Array(BYTES);
  for (let k = 0; k < modules.length; k++) if (modules[k]) bytes[k >> 3] |= 0x80 >> (k & 7);
  const packedHex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return { version: 3, size: SIZE, packedHex, modules };
}

export function unpack(packedHex) {
  const out = new Uint8Array(SIZE * SIZE);
  for (let k = 0; k < out.length; k++) {
    const byte = parseInt(packedHex.slice((k >> 3) * 2, (k >> 3) * 2 + 2), 16);
    out[k] = (byte >> (7 - (k & 7))) & 1;
  }
  return out;
}

// Same drawing rule the contract uses: one rect per dark module, offset into the canvas.
export function modulesToSvg(modules, offset) {
  let s = "";
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (modules[r * SIZE + c]) s += `<rect x="${offset + c}" y="${offset + r}" width="1" height="1" fill="#000"/>`;
  }
  return s;
}

if (process.argv[1] && process.argv[1].endsWith("qr-bitmap.mjs")) {
  const text = process.argv[2] || `https://${process.env.MRO_DOMAIN || "example.com"}/t/1`;
  console.log(qrBitmap(text).packedHex);
}
```

Note: `qrcode`'s `QRCode.create` returns `{ modules: BitMatrix, version, errorCorrectionLevel, ... }` and `BitMatrix.get(row, col)` reads `data[row * size + col]` (verified in the library source on 2026-08-27). A version-3-L code in byte mode holds 53 bytes; `https://` + domain + `/t/` + up to five digits must stay inside that, which caps the domain at roughly 37 characters.

- [ ] **Step 4: Run the tests**

```bash
cd ~/projects/machine-readable-only/tools && npm test
```

Expected: all 7 tests pass, including the resvg + jsQR round trip.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only && git add tools && git commit -q -m "feat(tools): version-3 QR bitmap packer with decode round-trip test"
```

---

### Task 4: `TokenView` and `HeartRenderer`

**Files:**
- Create: `contracts/src/render/TokenView.sol`, `contracts/src/render/HeartRenderer.sol`, `contracts/test/HeartGeometry.t.sol`, `contracts/test/HeartRenderer.t.sol`

**Interfaces:**
- Produces:

```solidity
// TokenView.sol
struct TokenView {
    uint256 tokenId;
    uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay;
    uint32 generation; uint32 seedsGiven;
    bool resting; bool sunset;
    uint256 marks;        // bit n = mark id n (1 Vein, 2 Pulse, 3 Voice, 4 Bloom, 5 Halo, 6 Crown, 7 Singularity)
    bytes32 agentKeyId;
    bytes qr;             // 106 bytes, packed 29x29
    bytes voiceQr;        // 56 bytes, packed 21x21, only read when Voice is set
    uint32 today;         // block.timestamp / 86400, supplied by the token contract
}
// HeartRenderer.sol (library, all internal pure)
function cellsFilled(uint32 level) returns (uint256);            // min(level, 365)
function rings(uint32 level) returns (uint256);                  // min(level / 365, 8)
function lapsedDays(TokenView memory v) returns (uint256);       // 0 when resting or sunset
function heartColour(TokenView memory v) returns (string memory); // "#rrggbb" per the constants table
function heartPath(TokenView memory v, string memory fill) returns (string memory); // one <path> for filled cells
function emptyPath(TokenView memory v, string memory fill) returns (string memory);  // one <path> for unfilled cells (Vein uses it)
function ringsSvg(TokenView memory v, string memory stroke) returns (string memory); // one <rect> outline per ring
function canvas(TokenView memory v) returns (uint256);           // 61 + 4 * rings
```

- [ ] **Step 1: Write `contracts/src/render/TokenView.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Everything a renderer needs about one token. The token contract
/// fills it; renderers are pure and never read storage.
struct TokenView {
    uint256 tokenId;
    uint32 level;
    uint32 streak;
    uint32 lastDay;
    uint32 mintDay;
    uint32 generation;
    uint32 seedsGiven;
    bool resting;
    bool sunset;
    uint256 marks;
    bytes32 agentKeyId;
    bytes qr;
    bytes voiceQr;
    uint32 today;
}
```

- [ ] **Step 2: Write the failing tests**

`contracts/test/HeartGeometry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {HeartGeometry} from "../src/render/HeartGeometry.sol";

contract HeartGeometryTest is Test {
    function test_constantsAndLength() public pure {
        bytes memory c = HeartGeometry.cells();
        assertEq(c.length, HeartGeometry.CELL_COUNT * 2);
        assertEq(HeartGeometry.CELL_COUNT, 365);
        assertEq(HeartGeometry.CANVAS, 61);
        assertEq(HeartGeometry.QR_OFFSET, 16);
    }

    function test_noCellInsideReservedBlock() public pure {
        bytes memory c = HeartGeometry.cells();
        for (uint256 i = 0; i < 365; i++) {
            uint8 x = uint8(c[2 * i]);
            uint8 y = uint8(c[2 * i + 1]);
            bool inBlock = x >= 12 && x <= 48 && y >= 12 && y <= 48;
            assertFalse(inBlock, "cell inside the reserved QR block");
            assertLt(x, 61);
            assertLt(y, 61);
        }
    }
}
```

`contracts/test/HeartRenderer.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {HeartRenderer} from "../src/render/HeartRenderer.sol";

contract HeartRendererTest is Test {
    function base() internal pure returns (TokenView memory v) {
        v.tokenId = 1; v.level = 1; v.streak = 1; v.lastDay = 20_000; v.mintDay = 20_000; v.today = 20_000;
        v.qr = new bytes(106); v.voiceQr = new bytes(56);
    }

    function test_cellsFilledCapsAt365() public pure {
        assertEq(HeartRenderer.cellsFilled(0), 0);
        assertEq(HeartRenderer.cellsFilled(12), 12);
        assertEq(HeartRenderer.cellsFilled(365), 365);
        assertEq(HeartRenderer.cellsFilled(9_999), 365);
    }

    function test_ringsPerCompletedYear() public pure {
        assertEq(HeartRenderer.rings(364), 0);
        assertEq(HeartRenderer.rings(365), 1);
        assertEq(HeartRenderer.rings(730), 2);
        assertEq(HeartRenderer.rings(365 * 20), 8);
        assertEq(HeartRenderer.canvas(_withLevel(730)), 61 + 8);
    }

    function _withLevel(uint32 level) internal pure returns (TokenView memory v) { v = base(); v.level = level; }

    function test_colourByStreakTier() public pure {
        TokenView memory v = base();
        v.streak = 1;   assertEq(HeartRenderer.heartColour(v), "#9a9a9a");
        v.streak = 3;   assertEq(HeartRenderer.heartColour(v), "#d8a7b1");
        v.streak = 7;   assertEq(HeartRenderer.heartColour(v), "#e07a8d");
        v.streak = 30;  assertEq(HeartRenderer.heartColour(v), "#d9455f");
        v.streak = 100; assertEq(HeartRenderer.heartColour(v), "#c8102e");
    }

    function test_lapseStepsPaleTheHeart() public pure {
        TokenView memory v = base(); v.streak = 100;
        v.today = v.lastDay + 2;  assertEq(HeartRenderer.heartColour(v), "#c8102e");
        v.today = v.lastDay + 3;  assertEq(HeartRenderer.heartColour(v), "#e6c9cf");
        v.today = v.lastDay + 7;  assertEq(HeartRenderer.heartColour(v), "#dcdcdc");
        v.today = v.lastDay + 30; assertEq(HeartRenderer.heartColour(v), "#eeeeee");
    }

    function test_restingAndSunsetLockColour() public pure {
        TokenView memory v = base(); v.streak = 100; v.today = v.lastDay + 400;
        v.resting = true;  assertEq(HeartRenderer.heartColour(v), "#c8102e");
        v.resting = false; v.sunset = true; assertEq(HeartRenderer.heartColour(v), "#c8102e");
    }

    function test_heartPathHasOneRunPerFilledCellAtMost() public pure {
        TokenView memory v = base(); v.level = 12;
        string memory p = HeartRenderer.heartPath(v, "#c8102e");
        // 12 cells -> at most 12 "M" move commands, at least 1, and the fill colour is present.
        uint256 moves = _count(bytes(p), "M");
        assertGe(moves, 1); assertLe(moves, 12);
        assertTrue(_contains(bytes(p), "#c8102e"));
        // Level 0 renders no path at all.
        v.level = 0;
        assertEq(bytes(HeartRenderer.heartPath(v, "#c8102e")).length, 0);
    }

    function test_ringsSvgOneRectPerRing() public pure {
        TokenView memory v = base(); v.level = 730;
        string memory r = HeartRenderer.ringsSvg(v, "#c8102e");
        assertEq(_count(bytes(r), "<rect"), 2);
    }

    function _count(bytes memory hay, string memory needle) internal pure returns (uint256 n) {
        bytes memory nd = bytes(needle);
        for (uint256 i = 0; i + nd.length <= hay.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < nd.length; j++) if (hay[i + j] != nd[j]) { ok = false; break; }
            if (ok) n++;
        }
    }
    function _contains(bytes memory hay, string memory needle) internal pure returns (bool) { return _count(hay, needle) > 0; }
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path 'test/Heart*' -vv
```

Expected: compile error, `HeartRenderer` not found.

- [ ] **Step 4: Write `contracts/src/render/HeartRenderer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DynamicBufferLib} from "solady/src/utils/DynamicBufferLib.sol";
import {LibString} from "solady/src/utils/LibString.sol";
import {TokenView} from "./TokenView.sol";
import {HeartGeometry} from "./HeartGeometry.sol";

/// @notice Draws the 365-cell heart, its colour by streak and lapse, and the
/// yearly rings. Pure: reads only the TokenView and the geometry constant.
library HeartRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;

    uint256 internal constant MAX_RINGS = 8;

    function cellsFilled(uint32 level) internal pure returns (uint256) {
        return level > HeartGeometry.CELL_COUNT ? HeartGeometry.CELL_COUNT : level;
    }

    function rings(uint32 level) internal pure returns (uint256) {
        uint256 r = uint256(level) / HeartGeometry.CELL_COUNT;
        return r > MAX_RINGS ? MAX_RINGS : r;
    }

    /// @dev Each ring adds one cell of ring plus one cell of gap on every side.
    function canvas(TokenView memory v) internal pure returns (uint256) {
        return HeartGeometry.CANVAS + 4 * rings(v.level);
    }

    function lapsedDays(TokenView memory v) internal pure returns (uint256) {
        if (v.resting || v.sunset) return 0;
        if (v.today <= v.lastDay) return 0;
        return uint256(v.today) - uint256(v.lastDay);
    }

    function heartColour(TokenView memory v) internal pure returns (string memory) {
        uint256 lapsed = lapsedDays(v);
        if (lapsed >= 30) return "#eeeeee";
        if (lapsed >= 7) return "#dcdcdc";
        if (lapsed >= 3) return "#e6c9cf";
        uint32 s = v.streak;
        if (s >= 100) return "#c8102e";
        if (s >= 30) return "#d9455f";
        if (s >= 7) return "#e07a8d";
        if (s >= 3) return "#d8a7b1";
        return "#9a9a9a";
    }

    /// @notice One <path> covering the first `cellsFilled` cells in fill order.
    function heartPath(TokenView memory v, string memory fill) internal pure returns (string memory) {
        uint256 n = cellsFilled(v.level);
        if (n == 0) return "";
        return _cellsPath(v, 0, n, fill);
    }

    /// @notice One <path> covering the cells not yet filled (the Vein mark draws these faintly).
    function emptyPath(TokenView memory v, string memory fill) internal pure returns (string memory) {
        uint256 n = cellsFilled(v.level);
        if (n == HeartGeometry.CELL_COUNT) return "";
        return _cellsPath(v, n, HeartGeometry.CELL_COUNT, fill);
    }

    /// @dev Draws cells [from, to) as unit squares in a single path. Cells are
    /// shifted by the ring margin so the heart stays centred when rings are added.
    function _cellsPath(TokenView memory v, uint256 from, uint256 to, string memory fill) private pure returns (string memory) {
        bytes memory cells = HeartGeometry.cells();
        uint256 shift = 2 * rings(v.level);
        DynamicBufferLib.DynamicBuffer memory b;
        b.p('<path fill="', bytes(fill), '" d="');
        for (uint256 i = from; i < to; i++) {
            uint256 x = uint8(cells[2 * i]) + shift;
            uint256 y = uint8(cells[2 * i + 1]) + shift;
            b.p("M", bytes(LibString.toString(x)), " ", bytes(LibString.toString(y)), "h1v1h-1z");
        }
        b.p('"/>');
        return string(b.data);
    }

    /// @notice One 1-cell-thick square outline per completed year, outermost first.
    function ringsSvg(TokenView memory v, string memory stroke) internal pure returns (string memory) {
        uint256 r = rings(v.level);
        if (r == 0) return "";
        uint256 size = canvas(v);
        DynamicBufferLib.DynamicBuffer memory b;
        for (uint256 i = 0; i < r; i++) {
            // ring i is inset by 2*i cells from the edge; stroke sits inside a 1-cell band
            uint256 inset = 2 * i;
            b.p('<rect x="', bytes(LibString.toString(inset)), '.5" y="', bytes(LibString.toString(inset)), '.5" width="');
            b.p(bytes(LibString.toString(size - 2 * inset - 1)), '" height="', bytes(LibString.toString(size - 2 * inset - 1)));
            b.p('" fill="none" stroke="', bytes(stroke), '" stroke-width="1"/>');
        }
        return string(b.data);
    }
}
```

Note on the path encoding: `M x y h1v1h-1z` per cell is the simplest correct form and is what the gas budget test measures first. If Task 8's gas number is over target, the optimisation is to merge horizontal runs (`h{w}` for consecutive cells on a row); the fill order already groups cells by row, so the merge is a small change inside `_cellsPath`. Do not pre-optimise.

- [ ] **Step 5: Run the tests**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path 'test/Heart*' -vv
```

Expected: 9 tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only && git add contracts/src/render contracts/test && git commit -q -m "feat(render): TokenView and HeartRenderer with colour tiers, lapse steps and rings"
```

---

### Task 5: `QRRenderer`

**Files:**
- Create: `contracts/src/render/QRRenderer.sol`, `contracts/test/QRRenderer.t.sol`

**Interfaces:**
- Produces: `library QRRenderer { function modulePath(bytes memory packed, uint256 size, uint256 offset, string memory fill) internal pure returns (string memory); function isDark(bytes memory packed, uint256 k) internal pure returns (bool); }` where `size` is 29 (identity code) or 21 (Voice code), `offset` is the top-left cell, and `packed` is row-major, MSB first (the packing `tools/qr-bitmap.mjs` produces).

- [ ] **Step 1: Write the failing tests**

`contracts/test/QRRenderer.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {QRRenderer} from "../src/render/QRRenderer.sol";

contract QRRendererTest is Test {
    function test_isDarkReadsMsbFirstRowMajor() public pure {
        bytes memory p = new bytes(106);
        p[0] = 0x80; // module 0 dark
        p[1] = 0x01; // module 15 dark (byte 1, bit 0)
        assertTrue(QRRenderer.isDark(p, 0));
        assertFalse(QRRenderer.isDark(p, 1));
        assertTrue(QRRenderer.isDark(p, 15));
        assertFalse(QRRenderer.isDark(p, 840));
    }

    function test_modulePathDrawsOnlyDarkModulesAtOffset() public pure {
        bytes memory p = new bytes(106);
        p[0] = 0xC0; // modules 0 and 1 dark: a run of two on row 0
        string memory s = QRRenderer.modulePath(p, 29, 16, "#000");
        // one move to (16,16) with a width-2 run
        assertEq(s, '<path fill="#000" d="M16 16h2v1h-2z"/>');
    }

    function test_wrongLengthReverts() public {
        bytes memory p = new bytes(10);
        vm.expectRevert(QRRenderer.BadBitmapLength.selector);
        this.callModulePath(p);
    }

    function callModulePath(bytes memory p) external pure returns (string memory) {
        return QRRenderer.modulePath(p, 29, 16, "#000");
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path test/QRRenderer.t.sol -vv
```

Expected: compile error, `QRRenderer` not found.

- [ ] **Step 3: Write `contracts/src/render/QRRenderer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DynamicBufferLib} from "solady/src/utils/DynamicBufferLib.sol";
import {LibString} from "solady/src/utils/LibString.sol";

/// @notice Draws a packed QR module grid as one <path> of horizontal runs.
/// The bitmap is computed off-chain once at mint (no Solidity QR encoder
/// exists); this library only draws it. Row-major, most significant bit first.
library QRRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;

    error BadBitmapLength();

    function isDark(bytes memory packed, uint256 k) internal pure returns (bool) {
        return (uint8(packed[k >> 3]) >> (7 - (k & 7))) & 1 == 1;
    }

    function modulePath(bytes memory packed, uint256 size, uint256 offset, string memory fill)
        internal pure returns (string memory)
    {
        if (packed.length != (size * size + 7) / 8) revert BadBitmapLength();
        DynamicBufferLib.DynamicBuffer memory b;
        b.p('<path fill="', bytes(fill), '" d="');
        for (uint256 r = 0; r < size; r++) {
            uint256 c = 0;
            while (c < size) {
                if (!isDark(packed, r * size + c)) { c++; continue; }
                uint256 start = c;
                while (c < size && isDark(packed, r * size + c)) c++;
                uint256 w = c - start;
                b.p("M", bytes(LibString.toString(offset + start)), " ", bytes(LibString.toString(offset + r)));
                b.p("h", bytes(LibString.toString(w)), "v1h-", bytes(LibString.toString(w)), "z");
            }
        }
        b.p('"/>');
        return string(b.data);
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path test/QRRenderer.t.sol -vv
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "feat(render): QRRenderer draws packed module grids as run-length paths"
```

---

### Task 6: `MarkRenderer`, `Renderer` and `IRenderer`

**Files:**
- Create: `contracts/src/render/MarkRenderer.sol`, `contracts/src/render/Renderer.sol`, `contracts/src/render/IRenderer.sol`, `contracts/test/MarkRenderer.t.sol`, `contracts/test/Renderer.t.sol`

**Interfaces:**
- Consumes: `HeartRenderer`, `QRRenderer`, `TokenView`, `HeartGeometry` as defined above.
- Produces:

```solidity
interface IRenderer { function tokenURI(TokenView memory v) external pure returns (string memory); }
library MarkRenderer {
    uint256 constant VEIN = 1 << 1; uint256 constant PULSE = 1 << 2; uint256 constant VOICE = 1 << 3;
    uint256 constant BLOOM = 1 << 4; uint256 constant HALO = 1 << 5; uint256 constant CROWN = 1 << 6; uint256 constant SINGULARITY = 1 << 7;
    function has(uint256 marks, uint256 bit) internal pure returns (bool);
    function defs(TokenView memory v) internal pure returns (string memory);      // <defs> for Bloom gradient
    function behind(TokenView memory v) internal pure returns (string memory);    // Halo (drawn before the heart)
    function heartFill(TokenView memory v, string memory colour) internal pure returns (string memory); // "url(#bloom)" when Bloom else colour
    function inFront(TokenView memory v) internal pure returns (string memory);   // Voice, Crown (drawn after the heart)
    function names(uint256 marks) internal pure returns (string memory);          // JSON array of mark names
}
contract Renderer is IRenderer { function svg(TokenView memory v) public pure returns (string memory); function tokenURI(TokenView memory v) external pure returns (string memory); }
```

Drawing rules fixed here (spec section 9 named the Marks; this is their spike geometry): Vein = the unfilled heart cells in `#f1e3e6`; Pulse = `animation_url` HTML with the filled path's opacity animating 1 to 0.55 to 1 over 1 s (about 60 bpm), `image` unchanged; Voice = the 21x21 receipt code at the bottom-right corner of the canvas (offset `canvas-25`, `canvas-25`), drawn only if `voiceQr` has 56 bytes; Bloom = filled cells use a vertical gradient from the streak colour to `#ffb3c1`; Halo = three concentric rounded rects outside the heart at opacities 0.18, 0.10, 0.05 in the streak colour; Crown = a gold `#d4af37` 1-cell frame at the canvas edge plus a five-point crown polygon centred above the heart's top; Singularity = the inversion: heart cells fill `#111111`, code modules fill `#c8102e`.

- [ ] **Step 1: Write the failing tests**

`contracts/test/MarkRenderer.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

contract MarkRendererTest is Test {
    function base() internal pure returns (TokenView memory v) {
        v.level = 400; v.streak = 400; v.lastDay = 20_400; v.mintDay = 20_000; v.today = 20_400;
        v.qr = new bytes(106); v.voiceQr = new bytes(56);
    }

    function test_hasReadsBits() public pure {
        assertTrue(MarkRenderer.has(MarkRenderer.VEIN | MarkRenderer.CROWN, MarkRenderer.CROWN));
        assertFalse(MarkRenderer.has(MarkRenderer.VEIN, MarkRenderer.CROWN));
    }

    function test_namesJsonArray() public pure {
        assertEq(MarkRenderer.names(0), "[]");
        assertEq(MarkRenderer.names(MarkRenderer.VEIN | MarkRenderer.VOICE), '["Vein","Voice"]');
    }

    function test_bloomSwitchesFillToGradient() public pure {
        TokenView memory v = base();
        assertEq(MarkRenderer.heartFill(v, "#c8102e"), "#c8102e");
        v.marks = MarkRenderer.BLOOM;
        assertEq(MarkRenderer.heartFill(v, "#c8102e"), "url(#bloom)");
        assertTrue(bytes(MarkRenderer.defs(v)).length > 0);
    }

    function test_voiceDrawsSecondCodeOnlyWhenSet() public pure {
        TokenView memory v = base();
        assertEq(bytes(MarkRenderer.inFront(v)).length, 0);
        v.marks = MarkRenderer.VOICE; v.voiceQr[0] = 0x80;
        assertTrue(bytes(MarkRenderer.inFront(v)).length > 0);
    }

    function test_haloAndCrownRenderShapes() public pure {
        TokenView memory v = base();
        v.marks = MarkRenderer.HALO;
        assertTrue(bytes(MarkRenderer.behind(v)).length > 0);
        v.marks = MarkRenderer.CROWN;
        assertTrue(bytes(MarkRenderer.inFront(v)).length > 0);
    }
}
```

`contracts/test/Renderer.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {Base64} from "solady/src/utils/Base64.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {Renderer} from "../src/render/Renderer.sol";

contract RendererTest is Test {
    Renderer r;
    function setUp() public { r = new Renderer(); }

    function base() internal pure returns (TokenView memory v) {
        v.tokenId = 7; v.level = 12; v.streak = 12; v.lastDay = 20_012; v.mintDay = 20_000; v.today = 20_012;
        v.qr = new bytes(106); v.qr[0] = 0xFE; v.voiceQr = new bytes(56);
        v.agentKeyId = bytes32(uint256(0xabc));
    }

    function test_tokenURIIsBase64JsonWithBase64SvgImage() public view {
        string memory uri = r.tokenURI(base());
        bytes memory u = bytes(uri);
        assertEq(_slice(u, 0, 29), "data:application/json;base64,");
        string memory json = string(Base64.decode(_sliceStr(u, 29, u.length)));
        assertTrue(_contains(bytes(json), '"name":"MRO #7"'));
        assertTrue(_contains(bytes(json), '"image":"data:image/svg+xml;base64,'));
        assertTrue(_contains(bytes(json), '{"trait_type":"level","value":12}'));
        assertTrue(_contains(bytes(json), '{"trait_type":"heart","value":"12/365"}'));
        assertFalse(_contains(bytes(json), "animation_url"));
    }

    function test_wholeHeartRenamesToken() public view {
        TokenView memory v = base(); v.level = 365; v.streak = 365; v.today = 20_365; v.lastDay = 20_365;
        string memory json = string(Base64.decode(_sliceStr(bytes(r.tokenURI(v)), 29, bytes(r.tokenURI(v)).length)));
        assertTrue(_contains(bytes(json), '"name":"MRO #7 (Whole)"'));
        assertTrue(_contains(bytes(json), '{"trait_type":"whole","value":"true"}'));
    }

    function test_restingRenames() public view {
        TokenView memory v = base(); v.resting = true;
        string memory json = string(Base64.decode(_sliceStr(bytes(r.tokenURI(v)), 29, bytes(r.tokenURI(v)).length)));
        assertTrue(_contains(bytes(json), '"name":"MRO #7 (At Rest)"'));
    }

    function test_pulseAddsAnimationUrl() public view {
        TokenView memory v = base(); v.marks = MarkRenderer.PULSE;
        string memory json = string(Base64.decode(_sliceStr(bytes(r.tokenURI(v)), 29, bytes(r.tokenURI(v)).length)));
        assertTrue(_contains(bytes(json), '"animation_url":"data:text/html;base64,'));
    }

    function test_svgHasViewBoxAndCrispEdges() public view {
        string memory s = r.svg(base());
        assertTrue(_contains(bytes(s), 'viewBox="0 0 61 61"'));
        assertTrue(_contains(bytes(s), 'width="1220" height="1220"'));
        assertTrue(_contains(bytes(s), 'shape-rendering="crispEdges"'));
    }

    function _slice(bytes memory b, uint256 from, uint256 to) internal pure returns (string memory) {
        bytes memory out = new bytes(to - from);
        for (uint256 i = from; i < to; i++) out[i - from] = b[i];
        return string(out);
    }
    function _sliceStr(bytes memory b, uint256 from, uint256 to) internal pure returns (string memory) { return _slice(b, from, to); }
    function _contains(bytes memory hay, string memory needle) internal pure returns (bool) {
        bytes memory nd = bytes(needle);
        for (uint256 i = 0; i + nd.length <= hay.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < nd.length; j++) if (hay[i + j] != nd[j]) { ok = false; break; }
            if (ok) return true;
        }
        return false;
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path 'test/*Renderer.t.sol' -vv
```

Expected: compile errors for `MarkRenderer` and `Renderer`.

- [ ] **Step 3: Write `contracts/src/render/IRenderer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TokenView} from "./TokenView.sol";

interface IRenderer {
    function tokenURI(TokenView memory v) external pure returns (string memory);
}
```

- [ ] **Step 4: Write `contracts/src/render/MarkRenderer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DynamicBufferLib} from "solady/src/utils/DynamicBufferLib.sol";
import {LibString} from "solady/src/utils/LibString.sol";
import {TokenView} from "./TokenView.sol";
import {HeartRenderer} from "./HeartRenderer.sol";
import {QRRenderer} from "./QRRenderer.sol";

/// @notice The seven paid Marks. Each draws around the code, never on it.
library MarkRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;

    uint256 internal constant VEIN = 1 << 1;
    uint256 internal constant PULSE = 1 << 2;
    uint256 internal constant VOICE = 1 << 3;
    uint256 internal constant BLOOM = 1 << 4;
    uint256 internal constant HALO = 1 << 5;
    uint256 internal constant CROWN = 1 << 6;
    uint256 internal constant SINGULARITY = 1 << 7;

    function has(uint256 marks, uint256 bit) internal pure returns (bool) { return marks & bit != 0; }

    /// @dev Bloom: vertical gradient from the streak colour to a light pink.
    function defs(TokenView memory v) internal pure returns (string memory) {
        if (!has(v.marks, BLOOM)) return "";
        return string.concat(
            '<defs><linearGradient id="bloom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="',
            HeartRenderer.heartColour(v), '"/><stop offset="1" stop-color="#ffb3c1"/></linearGradient></defs>'
        );
    }

    function heartFill(TokenView memory v, string memory colour) internal pure returns (string memory) {
        return has(v.marks, BLOOM) ? "url(#bloom)" : colour;
    }

    /// @dev Halo: three soft rounded outlines just outside the heart, before it is drawn.
    function behind(TokenView memory v) internal pure returns (string memory) {
        if (!has(v.marks, HALO)) return "";
        uint256 size = HeartRenderer.canvas(v);
        string memory c = HeartRenderer.heartColour(v);
        DynamicBufferLib.DynamicBuffer memory b;
        string[3] memory op = ["0.18", "0.10", "0.05"];
        for (uint256 i = 0; i < 3; i++) {
            uint256 inset = 3 + i * 2;
            b.p('<rect x="', bytes(LibString.toString(inset)), '" y="', bytes(LibString.toString(inset)));
            b.p('" width="', bytes(LibString.toString(size - 2 * inset)), '" height="', bytes(LibString.toString(size - 2 * inset)));
            b.p('" rx="8" fill="none" stroke="', bytes(c), '" stroke-width="2" opacity="', bytes(op[i]), '"/>');
        }
        return string(b.data);
    }

    /// @dev Voice (second code, bottom-right) and Crown (gold frame + crown), after the heart.
    function inFront(TokenView memory v) internal pure returns (string memory) {
        DynamicBufferLib.DynamicBuffer memory b;
        uint256 size = HeartRenderer.canvas(v);
        if (has(v.marks, VOICE) && v.voiceQr.length == 56) {
            b.p(bytes(QRRenderer.modulePath(v.voiceQr, 21, size - 25, "#000")));
        }
        if (has(v.marks, CROWN)) {
            b.p('<rect x="0.5" y="0.5" width="', bytes(LibString.toString(size - 1)), '" height="', bytes(LibString.toString(size - 1)));
            b.p('" fill="none" stroke="#d4af37" stroke-width="1"/>');
            // Five-point crown centred on the canvas, 5 cells wide, 3 tall, at row 2.
            uint256 cx = size / 2;
            b.p('<polygon fill="#d4af37" points="', _pt(cx - 2, 5), " ", _pt(cx - 2, 2), " ", _pt(cx - 1, 4), " ");
            b.p(_pt(cx, 2), " ", _pt(cx + 1, 4), " ", _pt(cx + 2, 2), " ", _pt(cx + 2, 5), '"/>');
        }
        return string(b.data);
    }

    function _pt(uint256 x, uint256 y) private pure returns (bytes memory) {
        return bytes(string.concat(LibString.toString(x), ",", LibString.toString(y)));
    }

    function names(uint256 marks) internal pure returns (string memory) {
        DynamicBufferLib.DynamicBuffer memory b;
        b.p("[");
        bool first = true;
        string[7] memory n = ["Vein", "Pulse", "Voice", "Bloom", "Halo", "Crown", "Singularity"];
        for (uint256 i = 0; i < 7; i++) {
            if (marks & (1 << (i + 1)) == 0) continue;
            if (!first) b.p(",");
            b.p('"', bytes(n[i]), '"');
            first = false;
        }
        b.p("]");
        return string(b.data);
    }
}
```

- [ ] **Step 5: Write `contracts/src/render/Renderer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DynamicBufferLib} from "solady/src/utils/DynamicBufferLib.sol";
import {LibString} from "solady/src/utils/LibString.sol";
import {Base64} from "solady/src/utils/Base64.sol";
import {TokenView} from "./TokenView.sol";
import {IRenderer} from "./IRenderer.sol";
import {HeartGeometry} from "./HeartGeometry.sol";
import {HeartRenderer} from "./HeartRenderer.sol";
import {QRRenderer} from "./QRRenderer.sol";
import {MarkRenderer} from "./MarkRenderer.sol";

/// @notice Assembles the SVG and the metadata JSON. Swappable: the token
/// contract points at whichever Renderer the owner sets; state lives elsewhere.
contract Renderer is IRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;

    function svg(TokenView memory v) public pure returns (string memory) {
        uint256 size = HeartRenderer.canvas(v);
        uint256 shift = 2 * HeartRenderer.rings(v.level);
        bool inverted = MarkRenderer.has(v.marks, MarkRenderer.SINGULARITY);
        string memory colour = HeartRenderer.heartColour(v);
        string memory heartFill = inverted ? "#111111" : MarkRenderer.heartFill(v, colour);
        string memory codeFill = inverted ? "#c8102e" : "#000000";

        DynamicBufferLib.DynamicBuffer memory b;
        b.p('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', bytes(LibString.toString(size)), " ", bytes(LibString.toString(size)));
        b.p('" width="', bytes(LibString.toString(size * 20)), '" height="', bytes(LibString.toString(size * 20)), '" shape-rendering="crispEdges">');
        b.p(bytes(MarkRenderer.defs(v)));
        b.p('<rect width="', bytes(LibString.toString(size)), '" height="', bytes(LibString.toString(size)), '" fill="#ffffff"/>');
        b.p(bytes(HeartRenderer.ringsSvg(v, colour)));
        b.p(bytes(MarkRenderer.behind(v)));
        if (MarkRenderer.has(v.marks, MarkRenderer.VEIN)) b.p(bytes(HeartRenderer.emptyPath(v, "#f1e3e6")));
        b.p('<g id="heart">', bytes(HeartRenderer.heartPath(v, heartFill)), "</g>");
        b.p(bytes(QRRenderer.modulePath(v.qr, 29, HeartGeometry.QR_OFFSET + shift, codeFill)));
        b.p(bytes(MarkRenderer.inFront(v)));
        b.p("</svg>");
        return string(b.data);
    }

    function tokenURI(TokenView memory v) external pure returns (string memory) {
        string memory image = svg(v);
        DynamicBufferLib.DynamicBuffer memory j;
        j.p('{"name":"MRO #', bytes(LibString.toString(v.tokenId)), bytes(_suffix(v)), '",');
        j.p('"description":"Machine Readable Only. A heart only a program can keep alive.",');
        j.p('"image":"data:image/svg+xml;base64,', bytes(Base64.encode(bytes(image))), '",');
        if (MarkRenderer.has(v.marks, MarkRenderer.PULSE)) {
            j.p('"animation_url":"data:text/html;base64,', bytes(Base64.encode(bytes(_pulseHtml(image)))), '",');
        }
        j.p('"attributes":[', bytes(_attributes(v)), "]}");
        return string.concat("data:application/json;base64,", Base64.encode(j.data));
    }

    function _suffix(TokenView memory v) private pure returns (string memory) {
        if (v.resting || v.sunset) return " (At Rest)";
        if (v.level >= HeartGeometry.CELL_COUNT) return " (Whole)";
        return "";
    }

    function _pulseHtml(string memory image) private pure returns (string memory) {
        // Same SVG, plus a 1 s opacity beat on the heart group (about 60 bpm).
        return string.concat(
            "<!doctype html><html><body style=\"margin:0;background:#fff\">",
            _inject(image),
            "</body></html>"
        );
    }

    /// @dev Inserts the <animate> element right after the heart group opens.
    function _inject(string memory image) private pure returns (string memory) {
        bytes memory src = bytes(image);
        bytes memory marker = bytes('<g id="heart">');
        uint256 at = _find(src, marker);
        DynamicBufferLib.DynamicBuffer memory b;
        for (uint256 i = 0; i < at + marker.length; i++) b.p(abi.encodePacked(src[i]));
        b.p('<animate attributeName="opacity" values="1;0.55;1" dur="1s" repeatCount="indefinite"/>');
        for (uint256 i = at + marker.length; i < src.length; i++) b.p(abi.encodePacked(src[i]));
        return string(b.data);
    }

    function _find(bytes memory hay, bytes memory needle) private pure returns (uint256) {
        for (uint256 i = 0; i + needle.length <= hay.length; i++) {
            bool ok = true;
            for (uint256 k = 0; k < needle.length; k++) if (hay[i + k] != needle[k]) { ok = false; break; }
            if (ok) return i;
        }
        return hay.length;
    }

    function _attributes(TokenView memory v) private pure returns (string memory) {
        DynamicBufferLib.DynamicBuffer memory a;
        a.p('{"trait_type":"level","value":', bytes(LibString.toString(v.level)), "},");
        a.p('{"trait_type":"streak","value":', bytes(LibString.toString(v.streak)), "},");
        a.p('{"trait_type":"heart","value":"', bytes(LibString.toString(HeartRenderer.cellsFilled(v.level))), '/365"},');
        a.p('{"trait_type":"whole","value":"', v.level >= HeartGeometry.CELL_COUNT ? bytes("true") : bytes("false"), '"},');
        a.p('{"trait_type":"years","value":', bytes(LibString.toString(uint256(v.level) / HeartGeometry.CELL_COUNT)), "},");
        a.p('{"trait_type":"lastDay","value":', bytes(LibString.toString(v.lastDay)), "},");
        a.p('{"trait_type":"mintDay","value":', bytes(LibString.toString(v.mintDay)), "},");
        a.p('{"trait_type":"generation","value":', bytes(LibString.toString(v.generation)), "},");
        a.p('{"trait_type":"children","value":', bytes(LibString.toString(v.seedsGiven)), "},");
        a.p('{"trait_type":"resting","value":"', v.resting ? bytes("true") : bytes("false"), '"},');
        a.p('{"trait_type":"marks","value":', bytes(MarkRenderer.names(v.marks)), "},");
        a.p('{"trait_type":"agentKeyId","value":"', bytes(LibString.toHexString(uint256(v.agentKeyId), 32)), '"}');
        return string(a.data);
    }
}
```

Note: `_inject` copies byte by byte through the buffer, which is slow; it only runs for Pulse tokens and the gas test in Task 7 measures it separately. If it blows the budget, replace with `LibString.replace(image, '<g id="heart">', '<g id="heart"><animate .../>')` (Solady has `LibString.replace(string, string, string)`), which is the intended production form; the byte loop is written out here so the first measurement has no hidden dependency.

- [ ] **Step 6: Run the tests**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path 'test/*Renderer.t.sol' -vv
```

Expected: 10 tests pass (5 MarkRenderer + 5 Renderer). If `string[3] memory op = [...]` fails to compile, write it as three constants instead.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "feat(render): MarkRenderer and Renderer assemble the on-chain SVG and metadata"
```

---

### Task 7: `MROSpikeToken`, size guard and gas budget

**Files:**
- Create: `contracts/src/spike/MROSpikeToken.sol`, `contracts/test/MROSpikeToken.t.sol`, `contracts/test/ContractSize.t.sol`, `contracts/test/GasBudget.t.sol`

**Interfaces:**
- Consumes: `Renderer`, `IRenderer`, `TokenView`, `MarkRenderer` constants.
- Produces:

```solidity
contract MROSpikeToken is ERC721, Ownable, IERC4906 {
    struct State { uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay; uint32 generation; uint32 seedsGiven; bool resting; uint256 marks; bytes32 agentKeyId; bytes qr; bytes voiceQr; }
    constructor(address renderer_);
    function mint(uint256 id, address to, bytes calldata qr) external onlyOwner;        // level 1, streak 1, today
    function setState(uint256 id, State calldata s) external onlyOwner;                // emits MetadataUpdate(id)
    function touchRange(uint256 from, uint256 to) external onlyOwner;                  // emits BatchMetadataUpdate(from, to)
    function setRenderer(address r) external onlyOwner;
    function setSunset(bool on) external onlyOwner;
    function today() public view returns (uint32);                                     // block.timestamp / 86400
    function tokenURI(uint256 id) public view override returns (string memory);
}
```

- [ ] **Step 1: Write the failing tests**

`contracts/test/MROSpikeToken.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";

contract MROSpikeTokenTest is Test {
    Renderer r; MROSpikeToken t;
    address alice = address(0xA11CE);

    function setUp() public {
        vm.warp(20_000 days);
        r = new Renderer();
        t = new MROSpikeToken(address(r));
        t.mint(1, alice, new bytes(106));
    }

    function test_mintStartsAliveToday() public view {
        (uint32 level, uint32 streak, uint32 lastDay, uint32 mintDay,,,,,,,) = t.state(1);
        assertEq(level, 1); assertEq(streak, 1); assertEq(lastDay, 20_000); assertEq(mintDay, 20_000);
        assertEq(t.ownerOf(1), alice);
    }

    function test_setStateEmitsMetadataUpdate() public {
        MROSpikeToken.State memory s = _state(90, 90, 20_090);
        vm.expectEmit(true, false, false, false);
        emit IERC4906.MetadataUpdate(1);
        t.setState(1, s);
        (uint32 level,,,,,,,,,,) = t.state(1);
        assertEq(level, 90);
    }

    function test_touchRangeEmitsBatchMetadataUpdate() public {
        vm.expectEmit(false, false, false, true);
        emit IERC4906.BatchMetadataUpdate(1, 3);
        t.touchRange(1, 3);
    }

    function test_onlyOwnerGuards() public {
        vm.startPrank(alice);
        vm.expectRevert(); t.mint(2, alice, new bytes(106));
        vm.expectRevert(); t.setState(1, _state(1, 1, 20_000));
        vm.expectRevert(); t.setRenderer(address(0));
        vm.expectRevert(); t.setSunset(true);
        vm.stopPrank();
    }

    function test_supportsErc4906() public view {
        assertTrue(t.supportsInterface(0x49064906));
        assertTrue(t.supportsInterface(0x80ac58cd)); // ERC721
    }

    function test_tokenURIReflectsWarpedTime() public {
        string memory before = t.tokenURI(1);
        vm.warp(20_040 days); // 40 days lapsed: pale step 3
        string memory after_ = t.tokenURI(1);
        assertTrue(keccak256(bytes(before)) != keccak256(bytes(after_)));
    }

    function _state(uint32 level, uint32 streak, uint32 lastDay) internal pure returns (MROSpikeToken.State memory s) {
        s.level = level; s.streak = streak; s.lastDay = lastDay; s.mintDay = 20_000; s.qr = new bytes(106); s.voiceQr = new bytes(56);
    }
}
```

`contracts/test/ContractSize.t.sol` (the pattern from base-200, kept verbatim in spirit):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";

/// @notice EIP-170 deployability guard. `forge test` disables the 24,576-byte
/// runtime limit, so an oversized contract passes every other test. Re-impose it.
contract ContractSizeTest is Test {
    uint256 constant EIP170_LIMIT = 24_576;
    uint256 constant MARGIN = 1_024; // spec: positive margin, not just under

    function test_rendererAndTokenFitWithMargin() public {
        Renderer r = new Renderer();
        MROSpikeToken t = new MROSpikeToken(address(r));
        assertLe(address(r).code.length, EIP170_LIMIT - MARGIN, "Renderer too close to EIP-170");
        assertLe(address(t).code.length, EIP170_LIMIT - MARGIN, "MROSpikeToken too close to EIP-170");
        emit log_named_uint("Renderer runtime bytes", address(r).code.length);
        emit log_named_uint("MROSpikeToken runtime bytes", address(t).code.length);
    }
}
```

`contracts/test/GasBudget.t.sol` (the spec's pass/fail numbers, as tests):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";

contract GasBudgetTest is Test {
    uint256 constant PASS_GAS = 2_000_000;
    uint256 constant PASS_BYTES = 20_000;
    uint256 constant TARGET_GAS = 1_000_000;
    uint256 constant TARGET_BYTES = 5_000;

    Renderer r; MROSpikeToken t;

    function setUp() public {
        vm.warp(20_400 days);
        r = new Renderer();
        t = new MROSpikeToken(address(r));
        bytes memory qr = new bytes(106);
        for (uint256 i = 0; i < 106; i++) qr[i] = bytes1(uint8(0x5A ^ i)); // dense pseudo-code: worst case for runs
        t.mint(1, address(this), qr);
    }

    function _measure(string memory label, MROSpikeToken.State memory s) internal returns (uint256 gas, uint256 len) {
        t.setState(1, s);
        uint256 g0 = gasleft();
        string memory uri = t.tokenURI(1);
        gas = g0 - gasleft();
        len = bytes(uri).length;
        emit log_named_uint(string.concat(label, " gas"), gas);
        emit log_named_uint(string.concat(label, " bytes"), len);
    }

    function _worst() internal pure returns (MROSpikeToken.State memory s) {
        s.level = 365 * 8; s.streak = 365 * 8; s.lastDay = 20_400; s.mintDay = 17_480;
        s.marks = MarkRenderer.VEIN | MarkRenderer.VOICE | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN;
        s.qr = new bytes(106); s.voiceQr = new bytes(56);
        for (uint256 i = 0; i < 106; i++) s.qr[i] = bytes1(uint8(0x5A ^ i));
        for (uint256 i = 0; i < 56; i++) s.voiceQr[i] = bytes1(uint8(0xA5 ^ i));
    }

    function test_dayOneWithinTarget() public {
        MROSpikeToken.State memory s; s.level = 1; s.streak = 1; s.lastDay = 20_400; s.mintDay = 20_400;
        s.qr = new bytes(106); s.voiceQr = new bytes(56);
        (uint256 gas, uint256 len) = _measure("day1", s);
        assertLt(gas, TARGET_GAS); assertLt(len, TARGET_BYTES);
    }

    function test_wholeHeartWithinPass() public {
        MROSpikeToken.State memory s = _worst(); s.level = 365; s.streak = 365; s.marks = 0;
        (uint256 gas, uint256 len) = _measure("whole-no-marks", s);
        assertLt(gas, PASS_GAS); assertLt(len, PASS_BYTES);
    }

    function test_worstCaseStaticWithinPass() public {
        (uint256 gas, uint256 len) = _measure("worst-static", _worst());
        assertLt(gas, PASS_GAS); assertLt(len, PASS_BYTES);
    }

    function test_pulseReported() public {
        MROSpikeToken.State memory s = _worst(); s.marks = MarkRenderer.PULSE;
        _measure("pulse", s); // reported, not asserted: animation_url doubles the payload by design
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/contracts && forge test --match-path 'test/{MROSpikeToken,ContractSize,GasBudget}.t.sol' -vv
```

Expected: compile error, `MROSpikeToken` not found.

- [ ] **Step 3: Write `contracts/src/spike/MROSpikeToken.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {TokenView} from "../render/TokenView.sol";
import {IRenderer} from "../render/IRenderer.sol";

/// @notice PHASE 0 SPIKE ONLY. A stub ERC-721 whose owner can set any token's
/// state by hand so the renderers can be measured and shown on a marketplace.
/// It is not the MRO token contract and must never be presented as one.
contract MROSpikeToken is ERC721, Ownable, IERC4906 {
    struct State {
        uint32 level; uint32 streak; uint32 lastDay; uint32 mintDay;
        uint32 generation; uint32 seedsGiven; bool resting;
        uint256 marks; bytes32 agentKeyId; bytes qr; bytes voiceQr;
    }

    mapping(uint256 => State) public state;
    IRenderer public renderer;
    bool public sunset;

    error BadQrLength();

    constructor(address renderer_) ERC721("MRO Spike (throwaway)", "MROSPIKE") Ownable(msg.sender) {
        renderer = IRenderer(renderer_);
    }

    function today() public view returns (uint32) { return uint32(block.timestamp / 86400); }

    function mint(uint256 id, address to, bytes calldata qr) external onlyOwner {
        if (qr.length != 106) revert BadQrLength();
        State storage s = state[id];
        s.level = 1; s.streak = 1; s.lastDay = today(); s.mintDay = today();
        s.qr = qr; s.voiceQr = new bytes(56);
        _safeMint(to, id);
    }

    function setState(uint256 id, State calldata s) external onlyOwner {
        _requireOwned(id);
        state[id] = s;
        emit MetadataUpdate(id);
    }

    function touchRange(uint256 from, uint256 to) external onlyOwner { emit BatchMetadataUpdate(from, to); }
    function setRenderer(address r) external onlyOwner { renderer = IRenderer(r); }
    function setSunset(bool on) external onlyOwner { sunset = on; }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        State storage s = state[id];
        TokenView memory v = TokenView({
            tokenId: id, level: s.level, streak: s.streak, lastDay: s.lastDay, mintDay: s.mintDay,
            generation: s.generation, seedsGiven: s.seedsGiven, resting: s.resting, sunset: sunset,
            marks: s.marks, agentKeyId: s.agentKeyId, qr: s.qr, voiceQr: s.voiceQr, today: today()
        });
        return renderer.tokenURI(v);
    }

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == 0x49064906 || super.supportsInterface(id);
    }
}
```

- [ ] **Step 4: Run all contract tests and the size report**

```bash
cd ~/projects/machine-readable-only/contracts && forge test -vv && forge build --sizes
```

Expected: every test passes; the `--sizes` table shows `Renderer` and `MROSpikeToken` with positive margin. Read the four `GasBudget` log lines and write them down; they go into `docs/phase0-results.md` in Task 11. If `test_worstCaseStaticWithinPass` fails on gas, apply the horizontal-run merge in `HeartRenderer._cellsPath` (group consecutive cells on the same row into `h{w}`), re-run, and note both numbers. If the ContractSize test fails, move `MarkRenderer`'s bodies behind an external library (`forge` links it) and re-run; say so in the commit.

- [ ] **Step 5: Strict-limit anvil deploy (the smart-contract rule)**

```bash
cd ~/projects/machine-readable-only/contracts && (anvil --silent & echo $! > /tmp/anvil.pid; sleep 2)
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil account 0, public test key
R=$(forge create src/render/Renderer.sol:Renderer --rpc-url local --private-key $KEY --broadcast --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["deployedTo"])')
T=$(forge create src/spike/MROSpikeToken.sol:MROSpikeToken --constructor-args $R --rpc-url local --private-key $KEY --broadcast --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["deployedTo"])')
cast code $T --rpc-url local | wc -c; cast code $R --rpc-url local | wc -c
kill $(cat /tmp/anvil.pid)
```

Expected: both `wc -c` numbers are large (thousands), proving non-empty code on a strict-limit chain. Anvil's default account-0 key is public test material, not a secret.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only && git add contracts && git commit -q -m "feat(spike): MROSpikeToken stub with ERC-4906, size guard and gas-budget tests"
```

---

### Task 8: Deploy script, local run, and the end-to-end decode check

**Files:**
- Create: `contracts/script/DeploySpike.s.sol`, `tools/verify-tokenuri.mjs`, `tools/test/verify-tokenuri.test.mjs`

**Interfaces:**
- Consumes: `qrBitmap`, `unpack` from `qr-bitmap.mjs`; `svgToRgba`, `svgToPng` from `svg-to-png.mjs`.
- Produces: `decodeTokenUri(uri) -> { json, svg, html|null }`; `verifyToken({ rpcUrl, address, id, expectedUrl }) -> { ok, decoded, gasEstimate, bytes, pngPath }`. The deploy script mints ids 1 (day one), 2 (level 200, streak 45, Vein + Bloom), 3 (whole heart, 400 streak, all marks except Singularity, Pulse on).

- [ ] **Step 1: Write `contracts/script/DeploySpike.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";

/// @notice Deploys the renderer and the spike stub, mints three tokens with
/// distinct states. QR bitmaps are passed in via env (hex from tools/qr-bitmap.mjs).
contract DeploySpike is Script {
    function run() external {
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        address to = vm.addr(key);
        bytes memory qr1 = vm.envBytes("QR1");
        bytes memory qr2 = vm.envBytes("QR2");
        bytes memory qr3 = vm.envBytes("QR3");

        vm.startBroadcast(key);
        Renderer r = new Renderer();
        MROSpikeToken t = new MROSpikeToken(address(r));
        t.mint(1, to, qr1);
        t.mint(2, to, qr2);
        t.mint(3, to, qr3);
        uint32 d = t.today();

        MROSpikeToken.State memory s2;
        s2.level = 200; s2.streak = 45; s2.lastDay = d; s2.mintDay = d - 200;
        s2.marks = MarkRenderer.VEIN | MarkRenderer.BLOOM; s2.qr = qr2; s2.voiceQr = new bytes(56);
        t.setState(2, s2);

        MROSpikeToken.State memory s3;
        s3.level = 400; s3.streak = 400; s3.lastDay = d; s3.mintDay = d - 400;
        s3.marks = MarkRenderer.VEIN | MarkRenderer.PULSE | MarkRenderer.VOICE | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN;
        s3.qr = qr3; s3.voiceQr = new bytes(56);
        for (uint256 i = 0; i < 56; i++) s3.voiceQr[i] = bytes1(uint8(0xA5 ^ i));
        t.setState(3, s3);
        vm.stopBroadcast();

        console.log("Renderer:", address(r));
        console.log("MROSpikeToken:", address(t));
    }
}
```

- [ ] **Step 2: Write the failing tool test**

`tools/test/verify-tokenuri.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTokenUri } from "../verify-tokenuri.mjs";

test("decodeTokenUri unwraps base64 JSON and base64 SVG", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
  const json = { name: "MRO #1", image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), attributes: [] };
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(json)).toString("base64");
  const d = decodeTokenUri(uri);
  assert.equal(d.json.name, "MRO #1");
  assert.equal(d.svg, svg);
  assert.equal(d.html, null);
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd ~/projects/machine-readable-only/tools && npm test
```

Expected: FAIL, `Cannot find module '../verify-tokenuri.mjs'`.

- [ ] **Step 4: Write `tools/verify-tokenuri.mjs`**

```js
// Reads a token's on-chain metadata, decodes it, renders the SVG to PNG, and
// decodes the QR from that PNG: the proof that what the chain serves scans.
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import jsQR from "jsqr";
import { svgToPng, svgToRgba } from "./svg-to-png.mjs";

const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

export function decodeTokenUri(uri) {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) throw new Error("tokenURI is not a base64 JSON data URI");
  const json = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
  const img = "data:image/svg+xml;base64,";
  if (!json.image?.startsWith(img)) throw new Error("image is not a base64 SVG data URI");
  const svg = Buffer.from(json.image.slice(img.length), "base64").toString("utf8");
  const anim = "data:text/html;base64,";
  const html = json.animation_url?.startsWith(anim) ? Buffer.from(json.animation_url.slice(anim.length), "base64").toString("utf8") : null;
  return { json, svg, html };
}

export async function verifyToken({ rpcUrl, address, id, expectedUrl, outDir = "out" }) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const uri = await client.readContract({ address, abi: ABI, functionName: "tokenURI", args: [BigInt(id)] });
  const gasEstimate = await client.estimateContractGas({ address, abi: ABI, functionName: "tokenURI", args: [BigInt(id)] });
  const { json, svg, html } = decodeTokenUri(uri);
  const { data, width, height } = svgToRgba(svg, 1220);
  const hit = jsQR(data, width, height);
  mkdirSync(outDir, { recursive: true });
  const pngPath = `${outDir}/token-${id}.png`;
  writeFileSync(pngPath, svgToPng(svg, 1220));
  if (html) writeFileSync(`${outDir}/token-${id}.html`, html);
  const decoded = hit ? hit.data : null;
  return { ok: decoded === expectedUrl, decoded, gasEstimate: Number(gasEstimate), bytes: uri.length, pngPath, name: json.name, attributes: json.attributes };
}

if (process.argv[1] && process.argv[1].endsWith("verify-tokenuri.mjs")) {
  const [rpcUrl, address, id, expectedUrl] = process.argv.slice(2);
  if (!expectedUrl) { console.error("usage: node verify-tokenuri.mjs <rpcUrl> <address> <id> <expectedUrl>"); process.exit(2); }
  const r = await verifyToken({ rpcUrl, address, id, expectedUrl });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
```

- [ ] **Step 5: Run the tool tests**

```bash
cd ~/projects/machine-readable-only/tools && npm test
```

Expected: all pass (8 tests).

- [ ] **Step 6: Local end-to-end on anvil**

```bash
cd ~/projects/machine-readable-only/tools && source ~/.nvm/nvm.sh >/dev/null
export MRO_DOMAIN=example.com
export QR1=0x$(node qr-bitmap.mjs https://example.com/t/1) QR2=0x$(node qr-bitmap.mjs https://example.com/t/2) QR3=0x$(node qr-bitmap.mjs https://example.com/t/3)
export SPIKE_DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd ../contracts && (anvil --silent & echo $! > /tmp/anvil.pid; sleep 2)
forge script script/DeploySpike.s.sol --rpc-url local --broadcast | tee /tmp/deploy.log
T=$(/bin/grep -oE 'MROSpikeToken: 0x[0-9a-fA-F]{40}' /tmp/deploy.log | awk '{print $2}')
cd ../tools && for i in 1 2 3; do node verify-tokenuri.mjs http://127.0.0.1:8545 $T $i https://example.com/t/$i || echo "TOKEN $i FAILED"; done
kill $(cat /tmp/anvil.pid)
```

Expected: three JSON reports with `"ok": true`, `decoded` equal to the URL, `gasEstimate` and `bytes` printed, and `out/token-1.png`, `-2`, `-3` (plus `token-3.html`) written. Record the three `gasEstimate`/`bytes` pairs for the results doc; `estimateContractGas` is the RPC-side number, which is what marketplaces pay.

- [ ] **Step 7: Show the operator the three PNGs** (`scp vps:~/projects/machine-readable-only/tools/out/token-*.png ~/Downloads/`). This is the first look at the real drawing with a real code, Marks and rings. Any visual change goes back to Tasks 4-6 with tests updated first.

- [ ] **Step 8: Commit**

```bash
cd ~/projects/machine-readable-only && git add contracts/script tools && git commit -q -m "feat(spike): deploy script and end-to-end tokenURI decode verification"
```

---

### Task 9: Base Sepolia deployment (operator-manual funding)

**Files:**
- Modify: `docs/phase0-results.md` (create, first section)

- [ ] **Step 1: Create the throwaway key and hand the operator the funding step**

```bash
cd ~/projects/machine-readable-only/contracts && cast wallet new
```

Expected: prints an address and a private key. Tell the operator: put the private key into `contracts/.env` as `SPIKE_DEPLOYER_KEY` via WinSCP (chmod 600), together with `ALCHEMY_BASE_SEPOLIA_RPC_URL`, `ALCHEMY_BASE_MAINNET_RPC_URL` and `ETHERSCAN_API_KEY` from the base-200 setup; then send 0.05 Base Sepolia ETH to the printed address from the CDP faucet (`https://portal.cdp.coinbase.com/products/faucet`, 0.1 ETH per 24 h). Wait for the operator to confirm both. Do not print the key anywhere else.

- [ ] **Step 2: Deploy and verify**

```bash
cd ~/projects/machine-readable-only/contracts && set -a && . ./.env && set +a
export QR1=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/1) QR2=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/2) QR3=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/3)
forge script script/DeploySpike.s.sol --rpc-url base_sepolia --broadcast --verify | tee /tmp/sepolia.log
```

Expected: two contracts deployed and verified on Basescan (Sepolia), three tokens minted. Sourcing `.env` this way keeps the values in the shell only; never echo them.

- [ ] **Step 3: Verify from the public network and check the RPC gas cap**

```bash
T=$(/bin/grep -oE 'MROSpikeToken: 0x[0-9a-fA-F]{40}' /tmp/sepolia.log | awk '{print $2}')
cd ~/projects/machine-readable-only/tools && for i in 1 2 3; do node verify-tokenuri.mjs "$ALCHEMY_BASE_SEPOLIA_RPC_URL" $T $i https://example.com/t/$i; done
cast estimate $T "tokenURI(uint256)" 3 --rpc-url base_sepolia
```

Expected: three `"ok": true`; `cast estimate` returns a number (this is the proof that a public Alchemy endpoint serves the heaviest token without hitting a gas cap, the thing Nouns and Moonbirds failed on five public RPCs).

- [ ] **Step 4: Start `docs/phase0-results.md`**

```markdown
# Phase 0 rendering spike -- results

Date started: <YYYY-MM-DD>
Renderer / MROSpikeToken on Base Sepolia: <addr> / <addr>

| Criterion (spec section 8) | Pass at | Measured | Result |
|---|---|---|---|
| tokenURI gas, day-one token | < 2,000,000 (target < 1,000,000) | <n> | |
| tokenURI gas, whole heart, no marks | < 2,000,000 | <n> | |
| tokenURI gas, worst static (8 rings, 5 marks) | < 2,000,000 | <n> | |
| tokenURI bytes, day one / whole / worst | < 20,000 (target < 5,000) | <n> / <n> / <n> | |
| Pulse token gas and bytes (reported) | -- | <n> / <n> | |
| Renderer runtime bytes | < 23,552 | <n> | |
| MROSpikeToken runtime bytes | < 23,552 | <n> | |
| QR decodes from on-chain SVG (ids 1-3) | yes | | |
| Public RPC serves heaviest tokenURI (cast estimate) | yes | | |
| OpenSea displays the token (mainnet spike) | yes | | Task 10 |
| OpenSea shows each new image within 24 h of BatchMetadataUpdate + refresh call, 3 days running | yes | | Task 10 |
| animation_url data-URI HTML plays on OpenSea | plays or Pulse goes static | | Task 10 |
```

Fill the Sepolia rows from Tasks 7-9. Commit: `git add docs && git commit -q -m "docs(phase0): Sepolia deployment and measured gas, size and decode results"`.

---

### Task 10: Throwaway mainnet deploy for the OpenSea test (the operator approval)

**Files:**
- Create: `tools/opensea-check.mjs`
- Modify: `docs/phase0-results.md`

This is the irreversible step. Before running any `--broadcast` against `base`, state to the operator: "This deploys `MRO Spike (throwaway)` and three tokens to Base mainnet permanently, costs about $1 in ETH, and is not the collection. Approve?" Proceed only on an explicit yes. operator-manual before this: an OpenSea API key (`https://docs.opensea.io/reference/api-keys`) into `.env` as `OPENSEA_API_KEY`, and ~0.001 ETH on Base mainnet sent to the spike address.

- [ ] **Step 1: Write `tools/opensea-check.mjs`**

```js
// Asks OpenSea what it currently holds for a token, and optionally queues a refresh.
// Usage: node opensea-check.mjs <contract> <id> [refresh]
const [address, id, refresh] = process.argv.slice(2);
const key = process.env.OPENSEA_API_KEY;
if (!key) { console.error("OPENSEA_API_KEY not set"); process.exit(2); }
const base = `https://api.opensea.io/api/v2/chain/base/contract/${address}/nfts/${id}`;
const headers = { "x-api-key": key, accept: "application/json", "user-agent": "mro-phase0/1.0" };
if (refresh === "refresh") {
  const r = await fetch(`${base}/refresh`, { method: "POST", headers });
  console.log("refresh queued:", r.status, await r.text());
}
const r = await fetch(base, { headers });
const body = await r.json();
const nft = body.nft || {};
console.log(JSON.stringify({ status: r.status, name: nft.name, image_url: nft.image_url, animation_url: nft.animation_url, updated_at: nft.updated_at, metadata_url: nft.metadata_url }, null, 2));
```

- [ ] **Step 2: Deploy to Base mainnet**

```bash
cd ~/projects/machine-readable-only/contracts && set -a && . ./.env && set +a
export QR1=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/1) QR2=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/2) QR3=0x$(cd ../tools && node qr-bitmap.mjs https://example.com/t/3)
forge script script/DeploySpike.s.sol --rpc-url base --broadcast --verify | tee /tmp/mainnet.log
T=$(/bin/grep -oE 'MROSpikeToken: 0x[0-9a-fA-F]{40}' /tmp/mainnet.log | awk '{print $2}'); echo $T
```

Expected: verified contracts on Basescan; three tokens owned by the spike address. Record the addresses and the gas paid (from the broadcast JSON under `contracts/broadcast/`) in the results doc.

- [ ] **Step 3: First OpenSea look (day 0)**

```bash
cd ~/projects/machine-readable-only/tools && set -a && . ../contracts/.env && set +a
for i in 1 2 3; do node opensea-check.mjs $T $i refresh; done
```

Expected: HTTP 200 with `image_url` populated (OpenSea rasterises the SVG to a PNG at its CDN) within minutes to an hour. Then open `https://opensea.io/assets/base/<T>/3` in a browser (the operator, or via the browser tools) and record: does the image show the heart, rings and marks; does the "animation" (Pulse) play in the item view. If `image_url` is empty after 2 hours, record that as the first failure and re-check the next day before concluding.

- [ ] **Step 4: Three-day refresh soak**

Once per UTC day for three days, change token 1's state so the image must change (level 1 -> 30 -> 120 -> 365), emit the batch event, queue the refresh, then check the following day:

```bash
cd ~/projects/machine-readable-only/contracts && set -a && . ./.env && set +a
DAY=$(( $(date -u +%s) / 86400 ))
# day N: level L, streak L (edit L each day: 30, 120, 365)
L=30
cast send $T "setState(uint256,(uint32,uint32,uint32,uint32,uint32,uint32,bool,uint256,bytes32,bytes,bytes))" 1 "($L,$L,$DAY,$((DAY-L)),0,0,false,0,0x0000000000000000000000000000000000000000000000000000000000000000,$QR1,0x$(printf '00%.0s' $(seq 1 56)))" --rpc-url base --private-key $SPIKE_DEPLOYER_KEY
cast send $T "touchRange(uint256,uint256)" 1 3 --rpc-url base --private-key $SPIKE_DEPLOYER_KEY
cd ../tools && node opensea-check.mjs $T 1 refresh
```

Next day: `node opensea-check.mjs $T 1` and compare `image_url` and `updated_at` with the previous day's; open the item page and confirm the heart has more cells. Record each day's timestamps (state tx, refresh call, first observation of the new image) in the results doc. Pass = each of the three changes visible within 24 hours.

- [ ] **Step 5: Record and commit**

Fill the OpenSea rows in `docs/phase0-results.md`, including the exact latency observed each day and whether Pulse played. `git add docs tools && git commit -q -m "docs(phase0): mainnet spike addresses and OpenSea display and refresh observations"`.

---

### Task 11: Go / no-go and spec amendment

**Files:**
- Modify: `docs/phase0-results.md`; in the hub repo, `docs/superpowers/specs/2026-08-27-machine-readable-only-design.md` (rendering-risks subsection and rollout step 0)

- [ ] **Step 1: Write the verdict at the top of `docs/phase0-results.md`**

One of exactly three outcomes, in these words:

- `PASS: all criteria met; Plan 2 (token contract) may start. Renderers are reused unchanged.`
- `PASS WITH FALLBACK (a) or (b): <which>; the change is <one sentence>; Plan 2 may start.` (a = run merging / path compression; b = rings and Bloom become flat fills)
- `FAIL: <criterion>; fallback (c) (off-chain renderer with on-chain SVG as permanent fallback) needs the operator's approval as a spec change before anything else is built.`

Under it, the measured table with every cell filled, then "What surprised us" (three bullets maximum, facts only).

- [ ] **Step 2: Amend the spec in the hub repo**

In `docs/superpowers/specs/2026-08-27-machine-readable-only-design.md`, rendering-risks subsection and rollout step 0: replace "Renderer set deployed to Base Sepolia behind a stub ERC-721" with "Renderer set deployed to Base Sepolia for gas, size and decode, and as a throwaway contract on Base mainnet for OpenSea display and refresh, because OpenSea discontinued testnet support in July 2025"; add the measured numbers in one line. Render the HTML with `node docs/render-md-to-html.js <spec>` on the PC and commit in the hub repo: `docs(specs): MRO Phase 0 results folded into the rendering section`.

- [ ] **Step 3: Update memory and commit the project**

In the project repo: `git add docs && git commit -q -m "docs(phase0): verdict and measured results"`. Then update `project_machine_readable_only.md` in the hub's auto-memory with the verdict, the mainnet spike addresses, and the next plan to write (Plan 2: token contract), and tell the operator the outcome in one paragraph with the numbers.

---

## Self-review against the spec

- **Coverage.** Spec section 8 rendering risks 1-5 and the Phase 0 criteria: gas and size (Task 7 tests, Task 8-9 RPC estimates), renderer split (Tasks 4-6), decode from on-chain SVG (Task 8), OpenSea display and 3-day refresh with ERC-4906 plus the refresh API (Task 10), `animation_url` (Tasks 6 and 10), heart geometry as a design job (Task 2 gate), quiet zone and crisp rendering (Tasks 3 and 6), fallback ladder outcomes (Task 11). Spec section 7 items the spike deliberately does not build: the real token contract, Warden, Clock, client (Plans 2-5). The spec's `TokenView` fields for lineage (`generation`, `seedsGiven`) and `resting`/`sunset` are carried so the renderer needs no change in Plan 2.
- **Placeholders.** None: every step has its code or exact command; the results table has literal `<n>` slots that Task 9-11 fill with measurements, which is the deliverable, not a gap.
- **Type consistency.** `TokenView` field names match across `HeartRenderer`, `MarkRenderer`, `Renderer`, `MROSpikeToken.tokenURI` and the tests; `MarkRenderer` bit constants match the `names()` order and the spec's Mark ids; `qrBitmap().packedHex` packing matches `QRRenderer.isDark` (row-major, MSB first); `HeartGeometry` constants match the generator's `CANVAS`, `QR_OFFSET`, `CELL_COUNT`; `MROSpikeToken.State` field order matches the `cast send` tuple in Task 10.
