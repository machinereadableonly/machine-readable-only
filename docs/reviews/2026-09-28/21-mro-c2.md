> Driver note: requested `claude-fable-5-1`; turns were also served by claude-haiku-4-5-20251001 (automatic model fallback).

# Machine Readable Only -- creative -- the token as an object

**Snapshot:** 8d2a0d27e3

**Looked at:**
- Images, all opened with Read:
  - `out/marks/*.png` (all 12) and `out/finisher-band.png`
  - `tools/out/heart-preview-{12,90,200,365}.png` and `heart-v{5,6,8,10}.png`
  - `tools/out/token-55-{day12,day90,day200,whole,lapsed}.png` and `token-{1,2,7,12,19,26}.png`
  - `tools/out/slip.png`, `start-tier-new-noise.png`, `noise-{a,b,c}-*.png`
  - `tools/out/finisher-{binary,combined,clasps,glyphs,inks,inks-wide,inks-wide-0,inks-wide-4,inks-wide-8,rings}.png`
  - `tools/out/ring-{0,1,3,4,5}-*.png`, `clasp-c1-gold.png`, `clasp-c4-pale.png`
  - `docs/*.png` (all 7)
- Source, used only to explain what an image showed: `contracts/src/render/{Renderer,Palette,MarkRenderer,FrameRenderer,DigitBand,IRenderer}.sol`, `tools/{marks-preview,preview,finisher-band-sheet}.mjs`, `warden/src/mcp/{tokenView,nextSteps}.mjs`, the three specs, `.claude/rules/*`.
- Live: `https://machinereadableonly.com/`, `/llms.txt`, `/t/1`, and the Blockscout API record for token 1 on the live Base Sepolia pair.

## Findings

### [BEFORE MAINNET] Almost every image is the old picture; nobody can see the shipping token yet
**Where:** `out/marks/*.svg` (each declares `viewBox="0 0 51 51"`), `tools/out/token-*.png`, `out/finisher-band.png`, `tools/preview.mjs:13-19`, `tools/marks-preview.mjs:26,43-51`

**What a person meets now:** The shipping code is QR version 10 (57 modules). Every Mark render, every `token-*.png` and every `docs/*.png` sheet is version 5 (37 modules). Only three images show version 10: `heart-v10.png` (bare code, no frame), `out/finisher-band.png` and `finisher-combined.png`. Four of the renders show something other than what they are named for:
- `tint.png` and `all.png` are pixel-identical to `base.png`. Tint only draws on Iris eyes, and the row has no Iris.
- `iris.png` shows dull mauve eyes on a rose token. The two Iris rows share one filename, so the earned one overwrites the bought one, and it is drawn with run 0. The chain only grants it at run 100, where the eyes would be red.
- `token-55-whole.png` and `token-55-lapsed.png` are whole tokens with no digit band. Every finished token now carries one, so these show an object the chain cannot produce.
- `out/finisher-band.png` has near-black digits for places 1, 42, 365, 43690 and 65535. The script at HEAD draws 1, 3, 9, 42 and 365 in the Mark inks, so this sheet predates it.

**Proposed:**
- In `marks-preview.mjs`, write `iris-bought.png` and `iris-earned.png` (state `streak: 100, irisRun: 100`).
- Add `tint-violet.png` and `tint-gold.png` with marks `[5, 9]` and `tintVariant` 0 and 1.
- Delete the stale `all.png`.
- In `preview.mjs`, give the two `level: 365` states an `ordinal` and the matching finisher Mark.
- Re-run both tools, plus `finisher-marks-sheet.mjs` and one child token for the echo ring, with `MRO_DOMAIN=machinereadableonly.com`, at 256 px as well as the current width.

**Why:** The project's own rule is that a look is decided from a rendered sheet. There is no sheet of a version 10 token at day 1, mid-year, lapsed, or wearing any of the ten Marks.

### [BEFORE MAINNET] Iris and Tint were priced on eyes that are now less than half the size
**Where:** `out/marks/iris.png` and `all-illegal.png` (version 5) against `out/finisher-band.png` (version 10); spec `2026-09-20-mro-finisher-marks-design.md` section 10k

**What a person meets now:** In `iris.png` each round eye is about a fifth of the code's width and is the first thing the eye lands on. In `finisher-band.png` the same three corner squares are about 12% of the code's width and recede behind the heart. Iris (25 USDC) and Tint (250 USDC) draw on nothing else.

**Proposed:** Re-run `eye-shape-sheet.mjs` and `tint-on-green-sheet.mjs` at version 10 and judge them at 256 px. If the three shapes cannot be told apart at that size, offer one shape. Set Tint's price from that sheet; it is a `setUpgrade` dial, so no redeploy.

**Why:** The shapes, inks and prices were fixed on 2026-09-02 and version 10 was chosen on 2026-09-21. The premise of the earlier decision (eye size) changed, so this is a re-raise on a changed premise, not on taste.

### [BEFORE MAINNET] "Heart 2/365" counts the frame; the heart is full on day one
**Where:** `token-55-day12.png`, `token-1.png`; `Renderer.sol:380,433`; `warden/src/mcp/tokenView.mjs:42`; `warden/src/mcp/nextSteps.mjs:53,77`; live `/t/1` returns `heart: "2/365"`

**What a person meets now:** At day 12 the heart is completely drawn and the frame has a 12-cell tab at the top. The metadata says `Heart: 12/365`. The token's own description says "The heart is the code, and the frame is the year", and `/llms.txt` says the heart "is there in full from the first day". The `status` tool has to explain that "`heart` counts the cells of the frame".

**Proposed:**
- Rename the trait `Heart` to `Frame` with the value unchanged (`"212/365"`).
- Rename the Warden field `heart` to `frame`.
- `nextSteps.mjs:53` becomes "A token may only seed a child once its year is finished: 365 credited days."
- `nextSteps.mjs:77` becomes "This Mark needs a finished year: 365 credited days."

**Why:** Agents will key on these names, so the rename is cheap now and a breaking change later. The settled wording "a 365-cell heart" is false in the code: `FrameRenderer.sol:12-18` fills a square frame, and the heart is static. I am re-raising the words only, not the art.

### [ANYTIME] On Blockscout the live token has no picture, name or traits
**Where:** Blockscout API record for token 1 of the live pair (fetched 2026-09-29); `Renderer.sol:43`

**What a person meets now:** The record returns `metadata: null` and `image_url: null`. The contract emits the prefix `data:application/json;utf-8,`. Blockscout's `metadata_retriever.ex` on master was reported to me by a summarising fetch, not read line by line. It matches only `data:application/json;utf8,`, `data:application/json,` and `;base64,`.

**Proposed:** Change the prefix to `data:application/json,`. Re-run `tools/alchemy-byte-check.mjs` and `tools/third-party-check.mjs` on a Sepolia spike to confirm Alchemy still parses it, then confirm the Blockscout record fills in. Update the pinned prefix in `Renderer.t.sol:315`, `IntrinsicSize.t.sol:122-123`, `MROSpikeToken.t.sol:95`, `tools/render-token.mjs:1069` and `tools/verify-tokenuri.mjs:24`. The comment at `warden/tools/mark-rehearsal.mjs:161` already says `utf8`, which the contract does not emit.

**Why:** The explorer is where an owner first looks up what they hold, and it shows a blank.

### [BEFORE MAINNET] The collection has no description or image of its own
**Where:** `contracts/src/MachineReadableOnly.sol:172`; no `contractURI` anywhere in `contracts/src`

**What a person meets now:** A marketplace or wallet gets a name ("Machine Readable Only") and a symbol ("MRO") and nothing else at collection level.

**Proposed:** Add an ERC-7572 collection record to the token contract: `string public contractURI`, `setContractURI(string) onlyOwner`, emitting `ContractURIUpdated()`. Seed it with the name, the on-chain description sentence, and `external_link: "https://machinereadableonly.com/llms.txt"`. Also add `"external_url":"https://machinereadableonly.com/t/<id>"` to each token's JSON, about 60 of the 1,842 spare bytes.

**Why:** The token contract has no upgrade path, so this function exists at the mainnet deploy or never.

### [BEFORE MAINNET] A 30-day run and a 100-day run are the same red
**Where:** `tools/out/finisher-inks.png` top row, tiles 1 and 2; `slip.png`; `Palette.sol:22-23`

**What a person meets now:** `#c8102e` (100+) beside `#bd2242` (30-99) cannot be told apart without the two side by side. It is the smallest step on the ladder and costs the most days.

**Proposed:** Rung 4 `#e0002a` with noise `#484848` (luma 72). Rung 3 `#c41c3c` with noise `#525252` (luma 82). Contrast against white is 5.0 and 5.9, both above the 4.5 floor in `render-token.mjs`. Re-derive Static's two greens with `green-violet-sheet.mjs`, decide whether Aorta's red follows, and run the decode sweep. The thresholds 3 / 7 / 30 / 100 do not move.

**Why:** Colour is the only thing on the base token that says how long the agent kept returning. Beat and the earned Iris mark the same milestones, but only if claimed and not excluded by a bought Mark. I cannot render, so this must be judged from a sheet.

### [BEFORE MAINNET] Static puts a red heart on green at matched brightness
**Where:** `out/marks/static.png`; `Palette.sol:51-57`; ladder spec section 7.2

**What a person meets now:** A red heart in green noise with green corner squares. It is the loudest bought Mark, and it reads as a strawberry. The two inks are matched in brightness by rule and differ by red against green only, which is the pair red-green colour-blind viewers (about 1 in 12 men) confuse. The docs never mention colour vision.

**Proposed:** Add deuteranopia and protanopia columns to `tools/static-hue-sheet.mjs`. If the heart separates from the noise less than on the bare token, move Static's direction from `[0,124,8]` toward teal, starting at `[0,118,84]`. Re-derive per rung and judge on the same sheet.

**Why:** Green was chosen for holding chroma at dark rungs, which is sound. But a paid Mark should not make the heart vanish for the buyer. Static opens at level 30, so the ink is free to change until then.

### [ANYTIME] Aura makes the unearned frame disappear
**Where:** `out/marks/aura.png` against `base.png`; `MarkRenderer.sol:131-133`

**What a person meets now:** Aura's pink page (`#fbeff2`) is almost the same colour as an unearned frame cell (`#f4eef0`). In `aura.png` the bottom half of the frame is gone and the token reads as an arch. The page tint itself is hard to see.

**Proposed:** In `MarkRenderer.ghost`, return `#ecdde2` when the token wears Aura without Ache. Ache's `#e3ccd3` stays deeper. It is the same length, so zero bytes.

**Why:** A 25 USDC Mark should not erase the year ahead. No token can wear Aura before level 100, so nothing held changes if this lands in the first 100 days.

### [ANYTIME] Vessel's gold reads as mustard
**Where:** `out/marks/vessel.png`, `tools/out/ring-3-mark13-gold.png`, `ring-4-mark14-doubled.png`; `MarkRenderer.sol:63`

**What a person meets now:** The frame in flat `#b8860b` beside a rose heart looks ochre-brown. This is the 1,250 USDC Mark.

**Proposed:** Set `VESSEL_GOLD = "#d4af37"` for the frame only. Leave `TINT_GOLD` and `APEX_GOLD` at `#b8860b`: eyes and one-module digit strokes need the darker ink. Render both values side by side at 256 px and run the decode sweep.

**Why:** Vessel needs a finished year, so no token can wear it for 365 days after launch.

### [BEFORE MAINNET] Three traits tell a person nothing
**Where:** `Renderer.sol:381,388-389`

**What a person meets now:** `Years` can only be 0 or 1 and repeats `Whole`. `Mint Day: 20700` and `Last Day: 20724` are day counts.

**Proposed:** Delete the `Years` line; the Warden already dropped it (`tokenView.mjs:44-47`). Emit the two days as `{"display_type":"date","trait_type":"Minted","value":<mintDay*86400>}` and the same for `Last Return`.

**Why:** Trait names are an interface agents filter on, so the set should be final before launch.

## Coverage

**Would anyone keep it?**
- The finished version 10 token: yes. In `out/finisher-band.png` the heart has real lobes and a point, and the row of 0s and 1s reads like stamp perforations.
- The day-one token (`token-1.png`, `slip.png`): a grey code with a faintly mauve heart and one stray cell. It is the weakest image and the one every minter gets. It was chosen from `docs/day1-options.png`, so I am not re-raising it.

**Thumbnail size:** The heart and frame read at 159 px in `docs/scan-test.png` tile 8 (version 5). No version 10 image at thumbnail size exists in the snapshot.

**Looked at, no finding:**
- The single completion ring reads as a pinstripe and survives at 159 px.
- The lapse steps: a whole token paled to mauve (`token-55-lapsed.png`) looks finished, not broken.
- Hush, Ache and Beat each read clearly.
- Break turns the heart grey, as designed.
- The symmetric top-down frame fill.
- The `heart-preview-*.png` images show an abandoned heart-shaped frame, not the shipping art.

**Not judged, because no image exists:**
- The child's dashed echo ring. It uses the same pale ink as the unearned frame, so check it at 256 px.
- The squircle and leaf Iris shapes, and Tint gold.
- The five finisher inks on the digits.
- The cooled page after a long absence.
- Any Mark at version 10.
- The Blockscout token page itself, which is drawn by script.

**Not opened:** `clasp-c0`, `c2`, `c3`, `c5`; `ring-2`; `token-3` to `6`, `8` to `11`, `13` to `18`, `20` to `25`.
