> Driver note: requested `claude-fable-5-1`; turns were also served by claude-haiku-4-5-20251001 (automatic model fallback).

# Machine Readable Only -- creative -- final list

**Snapshot:** 8d2a0d27e3

**Inputs:** all four lens reports were present and none said FAILED. Each carries a driver note that some turns ran on a fallback model, so I re-checked their claims against source, the sample images and the live site. Tags: `[C1]` to `[C4]` name the lens; "checked" means I opened the file, image or page myself.

**Not checked:** the live `/mcp` 401 body, `/skill.md`, the GitHub star count, the ClawHub and openclaw listings, and `CRON_TZ` behaviour on Debian or macOS cron. The Blockscout parser source reached me through a summarising fetch, not line by line.

## Decide before mainnet

Ordered by the cost of getting it wrong.

1. **The domain is paid for one year** `[C4]`, checked
   - Where: `docs/2026-09-03-mro-domain-decision.md:148-176`, `warden/public/llms.txt:428-434`.
   - Change: extend the registration to the ICANN maximum and add a yearly top-up to the runbook. Add C4's sentence to "What we commit to" saying what a lapse means. This spends real money, so it is the operator's approval.
   - Why: the expiry is 2027-09-03, before the first token can finish, and the decision doc calls this "the only unbounded risk this project carries". `CLAUDE.md` lists the domain term as still open.

2. **The collection has no `contractURI`** `[C2][C4]`, checked
   - Where: `contracts/src/MachineReadableOnly.sol` (no match for `contractURI` anywhere in the repo).
   - Change: add `contractURI()` returning `IRenderer(renderer).contractURI()`, and emit `ContractURIUpdated()` from `_setRenderer`. The Renderer returns a JSON card with the name, the existing `DESCRIPTION`, and `external_link` `https://machinereadableonly.com`. Add `"external_url":"https://machinereadableonly.com/t/<id>"` to each token's JSON and re-pin `contracts/test/WorstCase.sol`.
   - Why: the token contract has no upgrade path, so the function exists at deploy or never. ERC-7572 signatures confirmed against the EIP; it is still Draft.

3. **The picture can never be made final** `[C4]`, checked
   - Where: `MachineReadableOnly.sol:238` and `:265`, `llms.txt:420-422`.
   - Change: add a one-way `freezeRenderer()` (onlyOwner) and make `_setRenderer` revert once it is set. Add explicit tests for the function and its wrong-caller revert, and re-run the size gate.
   - Why: it cannot be added after deploy. The cost is real: once called, no rendering fix can ever ship (item 12 is an example), so it suits only the period after the piece has closed.

4. **Token 1 is the operator's and takes Apex** `[C1][C3][C4]`, checked
   - Where: `warden/DEPLOY.md:596-640`, `door.html:39`, `llms.txt:288-300`, `MachineReadableOnly.sol:454-475`.
   - Change: decide before the mint, and publish the decision in `llms.txt` under "Who can do what".
     - Recommended: C4's text. The owner calls `rest(1)` at level 364, so token 1 never finishes and takes no place. Add the `rest` call and the seed timer shutdown to DEPLOY 9c.
     - Otherwise: keep Apex and say so accurately: "Token 1 is the operator's own agent, minted `<n>` days before the door opened. Ties on a day go to the lowest id, so it takes Apex unless it misses more than `<n>` days."
   - Why: mint order cannot change after the first mint. The runbook gives token 1 a 48-hour head start, and the operator's own words in spec 10l are "a race to the finish and a prize for being first". Resting at 364 means token 1 never seeds a child and never shows the finished picture.

5. **An unknown payment outcome is reported as "nothing was minted"** `[C3]`, checked
   - Where: `warden/src/pay/x402.mjs:508-528`, `client/src/cli.mjs:227-233`, `client/src/messages.mjs:88-95`, `warden/src/mcp/tokenView.mjs:70`.
   - Change: as C3 wrote it. Return `payRefusal({ ok: false, reason: "payment-unresolved" })` from the unresolved branch, add the `NEXT` sentence, add `payment: "awaiting" | "unresolved"` to `tokenView`, and amend `lostResponseMessage`.
   - Why: the gateway holds the reservation correctly, but the client prints that it was released. It is the one place an agent can tell its operator the wrong thing about money.
   - Seen while checking, for the code review: `mint.mjs:27` answers `already-minted` before the expired-reservation sweep at `:50` runs.

6. **The skill's join command skips the checks the skill lists** `[C3]`, checked
   - Where: `skills/machine-readable-only/SKILL.md:64-74` and `:111-114`.
   - Change: add an `asset` row, fix the count ("four values" introduces five rows), and make Step 1 pass `--expect-chain`, `--expect-contract`, `--expect-asset` and `--expect-network`.
   - Why: an agent copies the command, not the table. `client/README.md:56-57` says that without the last two flags the authorisation "may name any ERC-20 on any chain".

7. **The opening-day door and llms.txt are not written** `[C4]`, checked
   - Where: `door.html:41-43` and `:53-54`, `llms.txt:59-97`, `DEPLOY.md:504-505`, `adopt-deployment.sh:154-158`.
   - Change: C4's replacement paragraph, mainnet explorer links, and a replacement section for "This is a testnet preview". Cold-read it before serving.
   - Why: the script rewrites addresses only, so the door would link a mainnet address to `sepolia.basescan.org`. Deleting one sentence leaves "The piece is not open yet" on the open door.

8. **Token 1 is minted before the published client exists** `[C4]`, checked
   - Where: `DEPLOY.md:596-610`, spec `:1078-1087`. Live npm holds `mro-agent@0.0.1`, 3 files, no attestations.
   - Change: C4's inserted step. Fill the placeholders, publish 0.1.0 with provenance, prove it from a clean machine, then mint token 1 with the published package.
   - Why: place follows mint order, so the race starts at token 1.

9. **The printed cron line drops `--directory`, `--key` and `--endpoint`** `[C3]`, checked
   - Where: `client/src/cli.mjs:101-108`, `client/src/messages.mjs:130-150`.
   - Change: pass all three through `cronLine` and add the test C3 names.
   - Why: a self-hosted key is refused `unknown-key` every day into a redirected log, and a missed day cannot be re-lived.

10. **One attempt a day, and a harmless refusal exits like a failure** `[C3]`, checked
    - Where: `messages.mjs:130-150`, `cli.mjs:329-334`.
    - Change: print two lines twelve hours apart. `beat` exits 0 for `already-credited-today`, 3 for `year-complete`, 2 for every other refusal.
    - Why: two runs twelve hours apart land in every UTC day without relying on `CRON_TZ`. Exit 0 reverses part of decision 5.M6 at `cli.mjs:268-277`, and is still correct: that refusal means the day is credited.
    - Question carried from C3: does the target cron honour `CRON_TZ`?

11. **The first command creates and registers a key before the operator decides** `[C3]`, checked
    - Where: `SKILL.md:109-148`, `cli.mjs:132` and `:158-170`, `messages.mjs:167-168`.
    - Change: add `mro-agent look` (unsigned, no key) and `mro-agent register`. Reorder the skill to look, ask, join, come back.
    - Why: the offer says the decision is the operator's.
    - Found while checking: `SKILL.md:131` says registration is permanent; `llms.txt:170` says an unused key is forgotten after 30 days. Make them agree.

12. **`Heart` counts the frame, and `Years` promises a second year** `[C1][C2]`, checked
    - Where: `Renderer.sol:380-381` and `:433`, `tokenView.mjs:42`, `checkin.mjs:26` and `:273`, `status.mjs:17`, `nextSteps.mjs:53` and `:77`. Live `/t/1` returns `heart: "2/365"`.
    - Change: rename the trait to `Frame` and the field to `frame`, delete the `Years` trait, and replace "whole heart" with "finished year" in the refusal strings.
    - Why: the token's own description says "The heart is the code, and the frame is the year". Names are cheap to change now and a breaking change later.
    - Question: C2's date-typed `Minted` and `Last Return` traits would make the chain say unix seconds while `/t/<id>` says a day index.

13. **Blockscout shows token 1 with no picture, name or traits** `[C2]`, checked live
    - Where: `Renderer.sol:43`; the Blockscout record returns `metadata: null`.
    - Change: emit `data:application/json,` and prove Alchemy still parses it on a Sepolia spike. Update the pinned prefix in the five files C2 lists.
    - Why: the door links to Blockscout. The parser accepts `;utf8,` and the bare form, not the hyphenated one. Moved from ANYTIME because the spike is cheapest before the redeploy.

14. **No sheet shows the shipping token** `[C1][C2][C3][C4]`, checked
    - Where: `out/marks/*`, `tools/out/token-*.png`, `out/finisher-band.png`, `tools/marks-preview.mjs`, `tools/preview.mjs`.
    - Change: C2's list. Re-run with `MRO_DOMAIN=machinereadableonly.com` at 256 px too, write `iris-bought` and `iris-earned` separately, render Tint with an Iris, give finished states an `ordinal`. Then re-run `eye-shape-sheet.mjs` and `tint-on-green-sheet.mjs` at version 10.
    - Why: every Mark sample is QR version 5. The eyes fall from 7 of 37 modules to 7 of 57, and the variant count is fixed in the contract at `MachineReadableOnly.sol:654-658`.
    - Question: are three Iris shapes still distinguishable at 256 px?

15. **The accelerated year has produced no report** `[C4]`, checked
    - Where: `docs/specs/2026-09-26-mro-accelerated-year-design.md:3`, `warden/tools/year/`.
    - Change: make a `report.html` with zero checker FAILs a named gate in DEPLOY 10 step 0. Add decoded tiles for place 15 and place 65.
    - Why: finishing, place ties and the heartbeat have only passed unit tests, and twelve agents never reach Chamber or Aorta.

16. **The piece opens with a cap of 10,000** `[C4]`, checked
    - Where: `MachineReadableOnly.sol:178`, `DeployPlan5.s.sol:29-33`, `llms.txt:254-255`.
    - Change: add `t.setSupplyCap(1024)` to the deploy script and use C4's sentence.
    - Why: the cap bounds what a leaked Clock key can mint. It is an owner dial, so a wrong number is correctable.

17. **Rehearsal and mainnet tokens share QR urls** `[C4]`, inferred from `DEPLOY.md:503`, not decoded
    - Change: add the `llms.txt` line saying `/t/<id>` answers for chain 8453 only. Calling `sunset()` on the Sepolia pair is the operator's choice, because it ends that pair as a staging environment.

## Cheap forever

Ordered by value per effort. All checked unless noted.

1. **llms.txt says hand-signing is the only way in** `[C3]`. `llms.txt:95-97` and `:514-516` contradict `:518-521`. Use C3's replacement text.
2. **llms.txt contradicts itself on humans minting** `[C1]`. Line 22 against line 145. Use C1's wording; on the door, "Only a program can mint one and grow one. Yours can."
3. **SKILL.md never says the piece is not open** `[C3]`. Insert C3's "Not open yet" block; remove it in the mainnet commit.
4. **refusals.md gives the wrong fix** `[C3]`. The door requires five components (`verify.mjs:128`); `refusals.md:20` lists four. `window` omits the no-`expires` case (`verify.mjs:244`). Four reasons are missing and `paid-but-unavailable` sits under routing.
5. **Tool descriptions** `[C3]`. Use C3's text for `rebind` and `seed`. Build the `mint` description from the configured chain; it says "on Base" while running on Base Sepolia.
6. **The mint reply says nothing about tomorrow** `[C1][C3]`. Add `nextWindowOpensAt`, `streakDeadline`, `view`, `nextRung: { at: 3, daysAway: 2 }` and C3's note. The CLI prints the note last.
7. **Name the subject before the gate** `[C1][C4]`. Apply C1's lines to `door.html:24-25`, the 401 `about` (`middleware.mjs:59`), the `SKILL.md` description and `README.md:3`. Add to `/t/<id>`: `about: "An agent's record of coming back. Machine readable only: hand this url to your agent."`
8. **Instructions carry their own changelog** `[C1]`. Delete the dated parentheticals at `llms.txt:204-208`, `SKILL.md:234` and `robots.txt:18-19`, and "Measured, not assumed." Replace `llms.txt:177-195` with C1's pointer to `/protocol`.
9. **Mechanics sit above the offer** `[C1]`. Move `llms.txt:5-20` below line 57. Rule 6 of the locked copy forbids price, chain and cell count above the line.
10. **Days 100 to 365 have nothing to walk towards** `[C1][C3][C4]`. Add `toWhole: { at: 365, daysAway }` to every unfinished check-in reply, plus "N tokens have finished, as of last night's run". Add C3's `projectedPlace` to `status`.
11. **The reference client cannot take a Mark or seed** `[C3][C4]`. Add `mro-agent mark --token <id> --mark <1-10> [--variant n]` and `mro-agent seed --parent <id> --to <0x>`. Add `opened: [...]` to the check-in reply on the day a gate is first met. Ship before day 7, when Ache first opens.
12. **No surface says what a Mark draws** `[C3]`. Add `draws` to each catalogue entry, with Beat corrected (see Struck). Check the ladder hash test still passes.
13. **Nothing hands over the picture** `[C1][C3]`. Add `mro-agent picture --token <id> --out token.svg [--rpc <url>]`. It reads `tokenURI` over viem, already a client dependency. This is a local file, not a gallery.
14. **The offer speaks to an agent; the return is a cron job** `[C1][C3]`. Add C1's paragraph after `llms.txt:250` and C3's two-route opening to `SKILL.md` Step 3.
15. **A broken run is announced only to a log** `[C1]`. Add C1's instruction to `SKILL.md` and `lastRunBroke: { was, on }` to `tokenView`.
16. **`join --cron` after a mint prints a placeholder id** `[C3]`. Add `mro-agent cron --token <id>`.
17. **The unpayable message asserts the price it exists to check** `[C3]`. `messages.mjs:63` hard-codes "1 USDC". Use C3's first line and the faucet note (Circle's faucet confirmed: 20 USDC every 2 hours on Base Sepolia).
18. **A finished token that rests loses "Whole"** `[C1]`. `Renderer.sol:446-450`: return " (Whole, At Rest)" when `level >= 365`.
19. **Inks.** All live in the Renderer, so fold them into the pre-mainnet redeploy. Hard deadline is the first day any token can wear the ink.
    - Aura `[C2]`: `MarkRenderer.ghost` returns `#ecdde2` under Aura without Ache. In `aura.png` the unearned frame is nearly gone. Deadline day 100.
    - Gold `[C1][C2]`: `APEX_GOLD`, `VESSEL_GOLD` and `TINT_GOLD` are all `#b8860b`. Apex keeps it alone; Tint moves to `#8a6d1f`; Vessel is chosen from one sheet showing `#8a6d1f` and `#d4af37` at 256 px. Deadline day 100.
    - Question: `TINT_GOLD` has luma 135, paler than the `#767676` floor at `Palette.sol:7`. Which harness proved it decodes on the eyes?
    - Reds `[C2]`: rung 4 `#e0002a` with noise `#484848`, rung 3 `#c41c3c` with `#525252`. I recomputed the lumas (72, 82) and contrasts (5.0, 5.9); they are right. Static's greens and `AORTA_RED` follow. Deadline day 30.
    - Static `[C2]`: add deuteranopia and protanopia columns to `tools/static-hue-sheet.mjs`. Deadline day 30.
    - Digit band `[C4]`: leading zeros in ghost ink. This changes a design the operator settled from sheets in spec 10k and 10l, so it goes to him as a question with a sheet.
20. **The image's encoding is unpublished** `[C4]`. Add "Reading a token with no server" to `llms.txt` and `mro-agent read <svg>`.
21. **No launch plan** `[C4]`, external claims not checked. Write `docs/launch-plan.md` with C4's four dated rows and remove the early-access line at spec `:1080-1082`.
22. **The locked copy's part two contradicts the live page** `[C1]`. Add the SUPERSEDED note under "Part two". The doc is operator-locked, so this is his edit.
23. **`docs/year-rings.png` shows 0 to 10 rings** `[C1]`. Retitle it "SUPERSEDED: one ring only, spec 10f".

## Contradictions resolved

- **Token 1: disclose (C1, C3) or abstain (C4).** C4 is right on the facts. Both disclosure texts assume a same-day start, and the runbook gives token 1 two days.
- **`contractURI`: stored string (C2) or through the Renderer (C4).** C4. `MachineReadableOnly.sol:17-19` puts every drawing decision behind `IRenderer`, and C4's form adds no owner power.
- **`external_link`: `/llms.txt` (C2) or the root (C4).** The root. Collection pages are read by people, and the door is the page written for them.
- **Gold: darker (C1) or brighter (C2).** Neither alone. Only C1 frees Apex from sharing with Tint, and only a darker ink is safe inside the code block. Vessel is frame-only, so both values go on one sheet.
- **Aura: deepen the page (C1) or deepen the ghost cells (C2).** C2. Applied together the two cancel: `#ecdde2` on `#f6dfe5` is as faint as today. C1's alternative ring would draw dark ink beside the finder patterns.
- **Timing of ink changes.** C1 and C2 tagged several BEFORE MAINNET, while C2 tagged Vessel and Aura ANYTIME because no token can wear them yet. The same reasoning applies to all of them, so all moved to Cheap forever with deadlines.
- **Stale samples: BEFORE MAINNET (C2) or ANYTIME (C1, C4).** Before mainnet. Item 14's Iris question depends on the sheet.
- **`all.png`: "check what `all` is passed" (C1) or "delete the stale file" (C2).** C2. The script writes `all-illegal`; `all.svg` has the same fills as `base.svg`.
- **Days 100 to 365: overload `nextRung` (C1) or a separate field (C4).** Separate. `nextRung` counts the run and 365 counts level. C4's name `whole` clashes with the boolean at `tokenView.mjs:43`, so use `toWhole`.
- **Mint reply wording.** C3's "paid for and reserved". The row is a reservation until 00:05 UTC.
- **Command and flag names.** `picture`, because `door.html:39` already calls it "the picture". `--mark`, because `--id` beside `--token <id>` is ambiguous.
- **`/t/<id>` sentence.** C4's. Its reader arrived from a QR scan and is looking at JSON, not at a heart.

## Struck

**Settled-decision conflicts: 0 struck.** Four re-raises were examined and allowed because each showed a changed premise in the code:
- The "365-cell heart" wording: `FrameRenderer.sol:12-18` fills a frame.
- Iris and Tint eye size: `CODE_BYTES = 407`.
- Sepolia tokens "stay as they are": `DEPLOY.md:503` shows they now carry the real domain.
- The domain term: open per `CLAUDE.md`.

**Adjective-only: 0 findings struck whole, 3 clauses struck.**
- C2, "Set Tint's price from that sheet": no figure proposed, and the ladder prices are locked.
- C2, Static "reads as a strawberry": taste. The colour-vision measurement survives.
- C2, Vessel "reads as mustard": taste. The hex proposal survives.

**Factually false: 4.**
- C1's disclosure sentence "If it misses one, Apex goes to the lowest id that did not": false under the 48-hour head start at `DEPLOY.md:638-640`.
- C3's alternative "token 1 skips one day in its first week": it would still finish a day before anyone else.
- C3's `draws` for Beat, "crimson at the top to blue at the point": the near stop is the token's own run colour and the far stop is violet (`MarkRenderer.sol:58-60`, `:245-252`).
- C1's "Check what `all` is passed": nothing passes it; the file is a leftover.
