# Machine Readable Only -- quality -- on-chain renderer, byte and gas budget, JS parity

**Snapshot:** 8d2a0d27e3
**Read:** `.claude/rules/{rendering,contracts}.md`; `contracts/foundry.toml`; `contracts/src/render/{Renderer,RendererUnsized,IRenderer,TokenView,DigitBand,FrameRenderer,CodeRenderer,PathWriter,MarkRenderer,EyeRenderer,Palette}.sol` (constants only of generated `FrameGeometry.sol`, `HeartMask.sol`); `contracts/src/spike/MROSpikeToken.sol`; `contracts/src/MachineReadableOnly.sol` (viewOf, dials, sunset, `_credit`, `_finish`, applyMark, rest); `contracts/test/{WorstCase,RealTokenGas.t,GasBudget.t,GasProfile.t,RenderMatrix.t,Renderer.t,DigitBand.t,DigitBandRender.t,DigitBandCost.t,TokenUriGolden.t,MROSpikeToken.t,ContractSize.t,CodeRenderer.t,FrameRenderer.t,IntrinsicSize.t,QrVersionCost.t,EyeCost.t,EyeRenderer.t,CombinationMatrix.t,PaletteNoise.t,PaletteBoundaries.t,EchoRing.t,RingCurve.t,MroTestBase}.sol`, `RunHistory.t.sol:100-349`, `MarkRenderer.t.sol:1-140`, `helpers/PathParser.sol`; `tools/{render-token,robust-solve,qart,token-bitmap,payload-length-check,heart-target,heart-mask,svg-to-png,frame-geometry,render-fixture,state-matrix,byte-gate-bitmap,echo-decode-check}.mjs`; `tools/test/{render-token,robust-solve,token-bitmap,qart,frame-geometry,echo-ring,eye-renderer,decode-strict,verify-tokenuri}.test.mjs`, `tools/test/helpers/decode.mjs`; `warden/src/solve/worker.mjs`; installed `tools/node_modules/@zxing/library/esm/core/RGBLuminanceSource.js`; plan 6 and the main spec (rest, sunset and rung sections); `out/finisher-band.png`; the slither lead file.

Nothing was run: this pass is read-only, so every gas and byte figure below is quoted from the source, not re-measured.

## Findings

Critical: none. High: none.

### [MEDIUM] [BLOCKS MAINNET] The robustness gate renders every state with a heart mask cut off at the version-5 size
**Where:** `tools/robust-solve.mjs:117` (used as the default target at `:135` and `:180`); reached in production by `warden/src/solve/worker.mjs:21`; repeated in `tools/test/robust-solve.test.mjs:121` and `:143`
**What:** `unpackModules(heartMaskBytes(), 37)` unpacks 1,369 entries of a 3,249-module mask. `renderSvg` indexes `want[p]` up to 3,248 (`tools/render-token.mjs:756`), so everything past row 24 is `undefined` and is drawn as noise. Every other caller in `tools/` passes `SIZE`; this is the only literal left from version 5.
**Why it matters:** The gate chooses the mask a token carries for life, and it is judging pictures no token will show: a heart cut off after 24 of 57 rows, with Beat's gradient stretched over that stump in five of the ten gate states. The two inks are close in weight, so the verdicts are likely close to the true ones, but that is unmeasured. Every mainnet bitmap will be solved through this path.
**Fix:**
- Use `VERSION_SIZE` at `robust-solve.mjs:117` and `SIZE` at both test lines.
- Make `renderSvg` throw when `modules.length` or `want.length` is not `size * size`.
- Re-run the gate on the ids already measured and record whether any shipped mask moves.

### [MEDIUM] [BLOCKS MAINNET] Resting a lapsed token restores its full colour, and both seals drop the fallen-run colour
**Where:** `contracts/src/render/Renderer.sol:117`, `:135`, `:145`; `tools/render-token.mjs:289`, `:304`, `:307`; `contracts/src/MachineReadableOnly.sol:805-810`
**What:** The resting branch returns `tierIndex(v.streak)` and an absence of 0, and `rest()` stores no day. A token at streak 400 that was silent for two years (start colour, cold page) returns to the top colour and a white page the moment its owner rests it. Both the resting and sunset branches also skip `fellRun`, so a token that slipped and came back drops from rung 3 to rung 0 at the seal, while one that simply stopped keeps its colour.
**Why it matters:**
- The spec says the chain shows which heart was rested on an unbroken run and which merely stopped (`docs/specs/2026-08-27-machine-readable-only-design.md:804-806`). The renderer draws them identically.
- Plan 6 called the same behaviour a defect for sunset ("Today a sunset un-pales a two-year-old lapse", `docs/plans/2026-09-05-mro-plan6-permanent-decisions.md:125`).
- The seal reverses Plan 6's own rule that coming back must not look worse than stopping. `RunHistory.t.sol:124` asserts that rule for live tokens only.
- The two renderers agree with each other, so no differential test can see it.

**Fix:**
- Sunset is renderer-only: apply the fallen-run rule with the clock stopped at `sunsetDay`, in both renderers and in `RunHistory.t.sol:334`.
- Rest needs the rest day stored on chain. The `Rested` event carries it and storage does not, and the token contract cannot be changed after deploy, which is why this blocks mainnet.
- If today's behaviour is intended, correct `Renderer.sol:133-135`: "the stored run IS that moment" is false for a lapsed token.

### [MEDIUM] The byte budget is proven on one bitmap, and nothing checks a token's own bitmap when it is solved
**Where:** `contracts/test/WorstCase.sol:27-28`; `contracts/test/RealTokenGas.t.sol:238-259` (parent and child both use `MroTestBase.sol:25`); `tools/robust-solve.mjs:135-167`
**What:** The pin is exact for the `example.com` token-1 bitmap and leaves 1,842 bytes of headroom. `.claude/rules/contracts.md:79-82` records a 554-byte difference between just two bitmaps. The gate checks that a code decodes, never how long its tokenURI is.
**Why it matters:** A code with more runs lands over 24,000 with nothing reporting it, permanently. "The largest token the shipping contract can produce" describes the fixture, not the collection.
**Fix:**
- In `gateSolve`, compute `tokenUri(...).length` for the banded finished child in the maximal Mark set and reject a mask over budget. The JS renderer is byte-identical to Solidity, so this costs one render.
- Sweep a batch of ids to learn the spread.
- Reword `WorstCase.sol` to say which bitmap it pins.

### [LOW] `GasProfile.t.sol` breaks down a different token from the one whose total it quotes
**Where:** `contracts/test/GasProfile.t.sol:17-20`, `:90-108`, `:145`
**What:** The header and constants cite `WorstCase` (the finished, banded child). `_dearest()` builds the day-364 unbanded child with the default Iris shape, and its comment says this is the token "as RealTokenGas.t.sol defines it".
**Why it matters:** This is one figure quoted against another. The digit band, the largest component added (871,911 gas, `GasBudget.t.sol:69`), appears nowhere in the breakdown meant to guide headroom decisions.
**Fix:** Profile level 365 with an echo, an ordinal and `MAX_MARKS` in leaf shape, and add a `DigitBand` harness line.

### [LOW] Gas assertions with no coverage-profile guard
**Where:** `contracts/test/RealTokenGas.t.sol:179`, `:258`, `:314`; `GasBudget.t.sol:681`; `TokenUriGolden.t.sol:124`; `RingCurve.t.sol:84`
**What:** `GasBudget.t.sol:445` and `Renderer.t.sol:448` skip gas ceilings under the coverage profile, because that build costs about two and a half times as much. These six assertions do not, and the exact-equality pin at `RealTokenGas.t.sol:258` cannot hold in an unoptimised build.
**Why it matters:** By the file's own arithmetic `forge coverage` reports failures, and the project rule is that coverage tooling must actually run.
**Fix:** Move `_gasIsMeaningful()` into a shared base and guard all six.

### [LOW] The luminance rule is asserted in a weighting the decoder does not use
**Where:** `contracts/test/PaletteNoise.t.sol:25-35`; `tools/test/render-token.test.mjs:41-46`
**What:** Both say BT.601 is "the weighting ZXing's RGBLuminanceSource uses". The installed source computes `(r + 2g + b) / 4` (`RGBLuminanceSource.js:57-61`). Under that weighting `#c8102e` reads 69 against its noise `#4a4a4a` at 74, and Beat's violet `#2000ff` reads 72 where BT.601 gives 39.
**Why it matters:** The "gap of at most 1" test can stay green while the gap the decoder sees grows, most of all for blue-heavy inks. Today's palette is still proven by the decode tests.
**Fix:** Correct both comments, and assert the gap under both weightings with thresholds taken from measurement.

### [LOW] Tests that no longer test what their names say
**Where and what:**
- `contracts/test/CodeRenderer.t.sol:394-407` -- the "full row" sets 37 of 57 modules and asserts `h37`.
- `contracts/test/QrVersionCost.t.sol:107-112` -- the "at 37" control passes size 57 and a 172-byte code to both sides, so both read past the buffer and agree only through identical memory layout.
- `contracts/test/RealTokenGas.t.sol:304-315` -- named as a comparison with the spike; it never measures the spike.
- `contracts/test/RealTokenGas.t.sol:213` -- `v` is read before the Marks are applied, so the assertion holds with no Marks at all.
- `contracts/test/Renderer.t.sol:374-381` and `tools/state-matrix.mjs:221` -- sunset with `sunsetDay` 0, a state the chain cannot produce, passing through the backwards-clock guard.
- `contracts/test/Renderer.t.sol:390` and `tools/test/render-token.test.mjs:355-366` -- "the worst case" with no digit band; the JS one also wears Static and Beat together.
- `tools/test/render-token.test.mjs:173-180` -- asserts the old 20,000 limit with an estimate that base64-encodes the JSON, which ships as plain utf-8.

**Why it matters:** Each reads as coverage that is not there.
**Fix:** Derive from `SIZE`, give sunset cases a real `sunsetDay`, add the band to the worst-case tests, and delete or rewrite the rest.

### [LOW] The spike never hands `sunsetDay` to the renderer
**Where:** `contracts/src/spike/MROSpikeToken.sol:113-130` (comment at `:110`)
**What:** `viewOf` sets `v.sunset` and leaves `v.sunsetDay` at 0, so a sunset spike token renders with its lapse undone. The comment says the value is read from `sunsetDay`. `setEcho` (`:187`) also has no happy-path or wrong-caller test, although `MROSpikeToken.t.sol:14` says every owner function has one.
**Why it matters:** Soak and third-party checks run on the spike, and they see a sunset picture the real contract never draws.
**Fix:** Set `v.sunsetDay = sunsetDay`, and add the two `setEcho` tests.

### [LOW] Comments that contradict the code or each other, in a public repo
**Where and what:**
- `contracts/src/render/TokenView.sol:25-36` -- calls itself the authority on the packing and lists bits 1-10, omitting the finisher Marks at 11-15.
- `contracts/test/GasBudget.t.sol:41-43` -- "20,000 stands", beside `BYTE_LIMIT = 24_000` at `:110`.
- `contracts/test/GasBudget.t.sol:102-106` -- "UNTESTED ... MUST be run", against "TESTED AND CLOSED" in `.claude/rules/contracts.md:59`.
- `.claude/rules/contracts.md:101-107` -- says the byte limit did not move and the two worst cases are different tokens, against `:85-92` of the same file.
- `contracts/test/Renderer.t.sol:414` and `TokenUriGolden.t.sol:120` -- "3M" beside `4_000_000`.
- `contracts/test/Renderer.t.sol:421-427` -- the `_gasIsMeaningful` NatSpec sits on the Years test.
- `contracts/test/DigitBandCost.t.sol:14` -- 906,968 / 4,800 for the shipped band, against 871,911 / 4,636 at `GasBudget.t.sol:69`.
- `contracts/test/GasBudget.t.sol:98-100` and `:152` -- hand copies of the `WorstCase` figures.
- Stale counts: `MROSpikeToken.t.sol:25` and `tools/heart-mask.mjs:2` (172 bytes), `tools/token-bitmap.mjs:17-18` (eight states), `RunHistory.t.sol:323` (64 states).

**Why it matters:** The project treats a comment that contradicts the code as a bug, and `WorstCase.sol` exists because copied numbers go stale.
**Fix:** Correct or delete each. Move the dated history into commit messages and docs, as `code-comments.md` requires.

### [LOW] One fixture bitmap pasted into ten test files; superseded probes still in the suite
**Where:** `_bitmap()` / `_code()` in `Renderer.t.sol:19`, `RenderMatrix.t.sol:27`, `CombinationMatrix.t.sol:37`, `GasBudget.t.sol:218`, `GasProfile.t.sol:125`, `IntrinsicSize.t.sol:26`, `DigitBandRender.t.sol:29`, `CodeRenderer.t.sol:52`, `MROSpikeToken.t.sol:27`, `MroTestBase.sol:25`; `DigitBandCost.t.sol`; `EyeCost.t.sol`
**What:** `MroTestBase.sol:10-12` says the bitmap is shared rather than copied; the renderer tests each carry their own copy. `DigitBandCost` prices a design that was not built, and `EyeCost` duplicates what `EyeRenderer` now ships and asserts against a headroom figure from Phase 0.
**Why it matters:** The mainnet re-solve regenerates every fixture, and a missed paste fails as a confusing hash mismatch.
**Fix:** Generate one `TestBitmap.sol` from `tools/` and import it; delete the two probes. A whole-tree search found no code importing them, only docs naming them.

### [INFO] The two renderers differ on inputs the chain cannot produce
**Where:** `tools/render-token.mjs:846` against `MarkRenderer.sol:202`; `render-token.mjs:457` against `DigitBand.sol:155`; `CodeRenderer.sol:72-77` against `render-token.mjs:780-781`; `CodeRenderer.sol:88-96`
**What:**
- A Tint variant of 2 or more draws violet in JS and gold in Solidity.
- An ordinal above 65,535 shows its top 16 bits in JS and its low 16 in Solidity.
- An empty heart or noise set emits an empty `<path>` in Solidity and nothing in JS.
- `CodeRenderer.paths` checks no lengths and reads past a short code.

**Why it matters:** All are unreachable today: `applyMark` bounds the variant, `setSupplyCap` stops at 65,535 (`MachineReadableOnly.sol:246-248`), and `mint` enforces 407 bytes. `render-token.mjs:1013-1020` says this class of drift matters, and a swapped renderer inherits it.
**Fix:** Align the fallbacks and add a length `require`.

## Questions

1. `Renderer._intrinsic` (`Renderer.sol:336-343`) declares 919px for a 747-unit banded canvas, so a module is 11.07px. The banded canvas is a whole number of modules (83 or 89). Was declaring a whole number of pixels per module measured against the current rule?
2. `tools/test/robust-solve.test.mjs:92` is a `todo`: at version 10 no token is pinned where the gate rejects the best-matching mask. Has `fragile-sweep.mjs` been run since, so the gate is shown to change an outcome?
3. Has `FOUNDRY_PROFILE=coverage forge coverage` run since `WorstCase.sol` was pinned on 2026-09-26?

## Out of scope

- The Warden's mint-time solver (`warden/src/solve/worker.mjs`) inherits the heart-mask defect in the first finding.

## Coverage

Read in full: every hand-written file in `contracts/src/render/`, the spike token, both gas harnesses, `WorstCase.sol`, the render, digit-band, echo-ring, frame and code tests, and the JS renderer with its solver, gate, bitmap and geometry modules and their tests.

Not reached:
- `Palette.t.sol`, `FrameGeometry.t.sol`, `TokenView.t.sol`, and `MarkRenderer.t.sol` past line 140.
- The bodies of generated fixtures and their generators, other than `render-fixture.mjs`.
- `tools/verify-tokenuri.mjs` itself; the ladder, skill-doc, plugin-manifest, prepublish and rendered-docs tests.
- The exploratory sheet scripts. One sample image was opened; the rest were not.

Not measured: the coverage-profile failures and the size of the gate defect's effect on mask choice are reasoned from the source.

Confirmed sound: `WorstCase.sol` does pin exactly what `RealTokenGas.t.sol` measures. `GasBudget.t.sol` labels its figures as the spike's. The digit-band geometry (band 29 or 30 units, 83 or 89 modules, pad 10 or 13, buffer bound 384 runs) checks out by hand. The two renderers agree on every lapse, slip, finish, rest and sunset branch.
