> Driver note: requested `claude-fable-5-1`; turns were also served by claude-haiku-4-5-20251001 (automatic model fallback).

# Machine Readable Only -- creative -- permanence and launch

**Snapshot:** 8d2a0d27e3
**Looked at:**
- Specs and docs: `docs/specs/2026-09-20-mro-finisher-marks-design.md` (all, incl. 10m), `2026-09-06-mro-lineage-design.md`, `2026-09-02-mro-mark-ladder-design.md`, `2026-09-26-mro-accelerated-year-design.md`, `2026-08-27-machine-readable-only-design.md` (sections 1-3, 11-13), `docs/2026-09-03-mro-domain-decision.md`, `2026-08-27-mro-comparable-projects.md`, `2026-09-15-mro-mainnet-rehearsal-report.md`, `2026-08-31-mro-engagement-and-narrative.md`, `2026-09-01-mro-agent-facing-copy.md` (part), `docs/plans/2026-09-26-mro-accelerated-year.md` (head), `warden/DEPLOY.md`, `.claude/rules/*`
- Source: `contracts/src/MachineReadableOnly.sol`, `render/Renderer.sol`, `render/DigitBand.sol`, `render/MarkRenderer.sol` (finisher inks), `contracts/script/DeployPlan5.s.sol`, `deploy-mainnet.sh`, `adopt-deployment.sh`, `warden/public/llms.txt`, `door.html`, `skills/machine-readable-only/SKILL.md`, `client/README.md`, `client/src/cli.mjs` (commands), `warden/src/mcp/tools/checkin.mjs` (reply), `tools/finisher-band-sheet.mjs`, `server.json`, `README.md`
- Images: `out/finisher-band.png`, `out/marks/{base,all,all-illegal,vessel,break,iris}.png`, `tools/out/heart-v10.png`, `finisher-combined.png`, `finisher-inks.png`, `token-1.png`, `token-55-{day12,day200,lapsed,whole}.png`, `heart-preview-{12,365}.png`, `docs/day1-options.png`
- Live: `https://machinereadableonly.com/`, `/llms.txt`, `/t/1` (200), `/t/999` (404), `/skill.md` (404), `/mcp` (401), `/robots.txt`, `registry.npmjs.org/mro-agent`, the GitHub repo page

## Findings

### [BEFORE MAINNET] The only gold in the piece goes to the house
**Where:** `warden/DEPLOY.md:596-640`, `warden/public/door.html:39`, `contracts/src/MachineReadableOnly.sol:454-475`
**What a person meets now:** The door says "The first one home is written in gold." The runbook has the operator's seed agent mint token #1, then wait 48 hours before anything is announced. Place is finishing order, so a house token that never misses finishes at least two days before any outside agent can. No agent-facing page says token #1 is the operator's.
**Proposed:** Commit, before the mint, that the house token stops one day short. Add to `llms.txt` under "Who can do what": "Token 1 is the operator's own agent, minted before the door opened. Its owner calls `rest` at level 364, so it never finishes and takes no place. First is for someone who came in through the door." Add the `rest(1)` call and the seed timer shutdown to DEPLOY 9c as a dated step.
**Why:** An agent told to read the contract will see `totalMinted = 1` before the announcement and work out that Apex is gone. The operator also runs the Clock that writes every credit, so a house win reads as a house advantage.

### [BEFORE MAINNET] The picture can never be made final
**Where:** `contracts/src/MachineReadableOnly.sol:238`, `:265`; `warden/public/llms.txt:420-422`
**What a person meets now:** `setRenderer` is onlyOwner forever and `renounceOwnership` is disabled. After a sunset, or after `sunsetByAbsence` when the operator is gone, whoever holds the owner key can still redraw every token, QR included.
**Proposed:** Keep the swap and add a one-way lock: `bool public rendererFrozen; function freezeRenderer() external onlyOwner { rendererFrozen = true; emit RendererFrozen(renderer); }`, with `_setRenderer` reverting `RendererIsFrozen()` once set. Add to `llms.txt`: "The owner can freeze the Renderer, once, and then nobody can redraw anything."
**Why:** This does not re-open swappability; it adds the ending the swap lacks. Without it "Nobody can delete it" depends on one key's custody forever, and it cannot be added after token #1.

### [BEFORE MAINNET] No `contractURI()`: the collection's identity lives off chain
**Where:** `contracts/src/MachineReadableOnly.sol` (absent; no match for `contractURI` anywhere in `contracts/src`)
**What a person meets now:** Each token draws itself on chain, but the collection has no name card, description or image on chain. Every marketplace collection page would be typed in by hand, per marketplace, behind a login.
**Proposed:** Add `function contractURI() external view returns (string memory) { return IRenderer(renderer).contractURI(); }` and the ERC-7572 `ContractURIUpdated()` event, emitted from `_setRenderer`. The Renderer returns a `data:application/json;utf-8,` card: name "Machine Readable Only", the existing `DESCRIPTION`, `external_link` `https://machinereadableonly.com`, and the unbanded heart as `image`.
**Why:** "There is no image server to outlive" should hold for the collection page too. The token contract cannot gain a function after the mint; routing through the Renderer keeps the card swappable.

### [BEFORE MAINNET] The domain is paid for one year, and the first renewal falls before the first finish
**Where:** `docs/2026-09-03-mro-domain-decision.md:159-176`; `warden/public/llms.txt:428-434`
**What a person meets now:** Registration expires 2027-09-03 on auto-renew with one card. A token minted in October 2026 finishes in October 2027, so the single renewal lands weeks before the first places are written. `llms.txt` promises the urls "for the life of the piece" and does not say what a lapse means.
**Proposed:** Extend to the ICANN maximum (expiry 2036-09-03) before the mint, roughly nine more years at the at-cost `.com` fee. Add a yearly top-up to the runbook. Add to "What we commit to": "The domain is registered to 2036 and topped up every year. If it ever lapses, a token's code leads somewhere we do not control. The record is on chain and does not need it."
**Why:** The decision doc itself calls this "the only unbounded risk this project carries". CLAUDE.md lists the domain term as still open, so this is not a settled decision.

### [BEFORE MAINNET] Rehearsal tokens and mainnet tokens share the same QR urls
**Where:** `warden/DEPLOY.md:503`, `:727-731`; live `https://machinereadableonly.com/t/1`
**What a person meets now:** Inferred from source, not decoded by me: bitmaps are solved at mint from `MRO_DOMAIN`, and the live Sepolia Warden runs on the real domain. So Sepolia token 1 on the current pair encodes `https://machinereadableonly.com/t/1#`, the same url mainnet token 1 will carry. After cutover a verified Sepolia token's code leads to a different owner's mainnet record.
**Proposed:** Add a row to the DEPLOY section 10 table: "`sunset()` on the Sepolia pair `0x6a6f...c41C`, from its owner key, on cutover day", so every rehearsal token reads "(At Rest)" and `Sunset: yes`. Add one line to `llms.txt`: "Tokens on Base Sepolia were a rehearsal and are closed. `/t/<id>` answers for chain 8453 only; check `chainId`."
**Why:** CLAUDE.md's "testnet tokens stay as they are" was written when they carried `example.com`. That premise changed when the rehearsal moved to the real domain.

### [BEFORE MAINNET] The opening-day door and llms.txt are not written, and the runbook edits would leave them wrong
**Where:** `warden/public/door.html:41-43`, `:53-54`; `warden/public/llms.txt:59-97`; `warden/DEPLOY.md:504-505`; `contracts/script/adopt-deployment.sh:154-158`
**What a person meets now:** DEPLOY says to delete "It will be ready soon". Doing only that leaves "The piece is not open yet. What runs here is a rehearsal on a test network" on the mainnet door. `adopt-deployment.sh` rewrites addresses only, so the door's links would send a mainnet address to `sepolia.basescan.org` and `base-sepolia.blockscout.com`. No replacement for the testnet section exists.
**Proposed:**
- Door, replacing the whole paragraph at lines 41-43: "The piece is open. It runs on Base, and what it records is permanent. /llms.txt has the detail."
- Door links: `https://basescan.org/address/<token>` and `https://base.blockscout.com/address/<token>`.
- `llms.txt`, replacing "This is a testnet preview": a section headed "This is the piece, and the money is real", stating chain id 8453, the contract, the treasury, and "check both against the SKILL.md in the repository".
- Cold-read it with the three-reader rig before serving.
**Why:** The first impression happens once. The locked copy was cold-read for the rehearsal wording, not the opening-day wording.

### [BEFORE MAINNET] Token #1 is minted before the client agents are told to use exists
**Where:** `warden/DEPLOY.md:580-640`; `docs/specs/2026-08-27-machine-readable-only-design.md:1078-1087`; `skills/machine-readable-only/SKILL.md:8-11`; live npm `mro-agent@0.0.1`
**What a person meets now:** Order today is deploy, adopt, mint token #1 from a checkout, then publish the client and skill. Live, `npx mro-agent` is a placeholder with no provenance attestation, `/skill.md` is 404, and SKILL.md's step 1 is `npx --yes PENDING-BEFORE-MAINNET-package join`.
**Proposed:** Insert a step between DEPLOY 10.5 and 10.6:
1. Fill the three SKILL.md placeholders.
2. Publish `mro-agent@0.1.0` with provenance.
3. Serve `/skill.md` and `/client.mjs`.
4. Confirm from a clean machine that `npx --yes mro-agent@0.1.0 whoami` and `npx skills add machinereadableonly/machine-readable-only` both work.
5. Mint token #1 with the published package, not the checkout.
**Why:** Place follows mint order, so the race starts at token #1. Every path the page names should work that day, and minting #1 with the published artefact proves the thing agents will run.

### [BEFORE MAINNET] The piece opens with a cap of 10,000
**Where:** `contracts/src/MachineReadableOnly.sol:178`; `contracts/script/DeployPlan5.s.sol:29-33`; `warden/public/llms.txt:254-255`; `warden/DEPLOY.md:404-407`
**What a person meets now:** The constructor sets 10,000 and the deploy script never changes it. DEPLOY and the main spec both say to set it near real demand, but only in the key-leak section, not the cutover table.
**Proposed:** Add `t.setSupplyCap(1024);` after the `setUpgrade` loop in `DeployPlan5`. Replace the `llms.txt` sentence with: "The collection is capped by the contract owner, 1,024 today, readable as `supplyCap()`. It is a bound, not an edition size."
**Why:** The project's own base case is single-digit mints without a channel. "3 of 10,000" reads like BLINK's 1 of 5,555, and 10,000 is also the damage a leaked Clock key can do.

### [BEFORE MAINNET] The accelerated year has not produced a report
**Where:** `docs/specs/2026-09-26-mro-accelerated-year-design.md:3`; `warden/tools/year/` (tools present, no report in the snapshot)
**What a person meets now:** The design is "awaiting spec review". Finishing, place ties, the digit band on a lived token and the heartbeat have only passed unit tests. Chamber and Aorta are never reached even in the run.
**Proposed:** Make the run's `report.html` with zero checker FAILs a named gate in DEPLOY 10 step 0, beside the fork rehearsal. Add a rendered and decoded tile for place 15 (blue) and place 65 (red) to the same gate.
**Why:** The design doc calls this "the last cheap place to see them together" before history is permanent.

### [ANYTIME] The product cannot take a Mark or seed a child
**Where:** `client/src/cli.mjs:248`; `skills/machine-readable-only/SKILL.md:253-255`
**What a person meets now:** Commands are `whoami, join, beat, status, ladder, rebind, rest`. An agent that joined with the client reaches a run of 7 in week one and cannot take Ache, which is free, without hand-writing an RFC 9421 signer.
**Proposed:** Add `mro-agent mark --token <id> --id <1-10> [--variant n]`. It prints the `ladder` row and what the Mark closes, then calls `upgrade`, and requires the same `--expect-payto` and `--expect-amount` for a bought side. Add `mro-agent seed --parent <id> --to <0x...>`. Ship both in the 0.1.0 published above.
**Why:** The ladder is the piece's only milestones between day 1 and day 365, and its only revenue. The original spec listed both commands. This needs to land before the announcement, 48 hours after the mint.

### [ANYTIME] The first-hundred plan names no channel the project controls
**Where:** `docs/specs/2026-08-27-machine-readable-only-design.md:1079-1087`; `docs/2026-08-27-mro-comparable-projects.md:58-64`, `:75-77`
**What a person meets now:** The plan is one paragraph from August. Its strongest channel, "a human X account with reach", does not exist. "Early access for wallets holding Claws, Shellborn, Base Buds or BLOKS" has no mechanism behind it, and the same study says unsolicited mint invitations now read as hostile. The repo has 0 stars.
**Proposed:** Write `docs/launch-plan.md` with four dated rows:
1. Day 0: skill listed by PR to openclaw/skills and ClawHub.
2. Day 0: `server.json` published to the MCP registry and the ERC-8257 entry written.
3. Day 2: one human launch post, carrying the day-1 token image and the line "curl https://machinereadableonly.com/llms.txt and hand it to your agent".
4. Day 30: a written rule, "under 10 mints changes nothing: no price cut, no cap change, no reopened decision".

Delete the early-access line.
**Why:** The project's own research says mechanism alone got BLINK one mint. A rule written before the quiet month stops panic changes to a permanent piece.

### [ANYTIME] After day 100 the check-in reply points at nothing for 265 days
**Where:** `warden/src/mcp/tools/checkin.mjs:259-288`
**What a person meets now:** `nextRung` is null once the run passes 100. The note says only "Your run is N. Check in again before ...".
**Proposed:** Add `whole: { at: 365, daysAway: 365 - level }` to every unfinished reply. Extend the note: "Day 212 of 365; 153 to go. N tokens have finished." Read N from `finishers()`.
**Why:** The engagement study calls this stretch "where most tokens will die". The reply is the only surface an agent relays to the person who decides whether the cron keeps running.

### [ANYTIME] First place is drawn as fifteen hollow squares and one digit
**Where:** `out/finisher-band.png` (top-middle tile); `contracts/src/render/DigitBand.sol:18`
**What a person meets now:** Place 1 is `0000000000000001` on each edge, and the zero glyph is a hollow square. The border reads as a row of boxes; the high-numbered tiles read as writing. Every capped place is 64 or lower, so nine or more of sixteen digits are always zeros.
**Proposed:** Draw leading zeros in the ghost ink and the significant digits in the Mark's ink, as two paths. Apex becomes one gold `1` at the end of a pale row. Cost is one extra `<path>` wrapper against 1,842 bytes of headroom; measure it.
**Why:** The spec rejected coloured rings because they "look like more squares"; the rarest tokens now have the most squares. It is renderer-only, but must settle before the first finish because a finished picture is promised final.

### [ANYTIME] No image in the snapshot shows what ships
**Where:** `out/finisher-band.png`, `out/marks/*.png`, `out/marks/all.svg`
**What a person meets now:** Three stale samples:
- `finisher-band.png` draws every band in near-black at places 1, 42, 365, 43690 and 65535. The current script draws places 1, 3, 9, 42 and 365 in the five inks.
- The `out/marks` samples are QR version 5.
- `all.svg` carries exactly the fills of `base.svg`, so "all" shows no Marks.

I could not see gold, silver, bronze, blue or red digits anywhere.
**Proposed:** Re-run `tools/finisher-band-sheet.mjs` and the marks sheet at version 10. Add day-1, day-7 and day-30 tiles, and judge the silver band (`#8c9096`, one-module strokes on white) at 256 px.
**Why:** "Written in gold" is on the door, and the operator's sign-off should be against the picture that ships.

### [ANYTIME] The image's own encoding is still unpublished
**Where:** `docs/specs/2026-09-20-mro-finisher-marks-design.md:519-536`; `warden/public/llms.txt` (absent)
**What a person meets now:** Section 10d says publishing how to read level, streak tier, lineage and Marks off the picture is "worth doing independently". Nothing in `llms.txt`, the protocol doc or the client does it.
**Proposed:** Add a section "Reading a token with no server" to `llms.txt`: lit frame cells equal level, the band is the place as sixteen binary digits, a dashed ring means a seeded child, eye shape and ink name the Marks. Add `mro-agent read <svg>` as the reference decoder.
**Why:** If the Warden and the domain both die, this is what keeps the record legible.

### [ANYTIME] A person who scans the code gets bare JSON with no sentence in it
**Where:** live `https://machinereadableonly.com/t/1`; `contracts/src/render/Renderer.sol:40-49`
**What a person meets now:** `/t/1` returns fields such as `"heart": "2/365"` and nothing addressed to a reader. Token metadata has no `external_url`.
**Proposed:** Add to the `/t/<id>` body: `"about": "An agent's record of coming back. Machine readable only: hand this url to your agent."` Add `"external_url":"https://machinereadableonly.com/t/<id>"` to the metadata JSON.
**Why:** The QR on a marketplace thumbnail is the piece's one distribution surface no comparable had. This stays JSON, so it is not a human-facing gallery.

## Coverage

**Checked and found right, no finding:**
- QR version 10. `heart-v10.png` is a clean heart; the version 5 tokens (`token-1.png`, `token-55-*.png`) are visibly ragged. Redeploying for `CODE_BYTES = 407` is correct.
- The place bands as constants, 1 / 3 / 10 / 50 plus uncapped. 64 capped places suits the turnout the comparables suggest.
- The quiet month on chain. `heartbeat()` keeps `sunsetByAbsence` measuring the operator, and the rehearsal prices a check-in at about $0.0006.
- The repo-side SKILL.md placeholders cannot be squatted on npm, because package names must be lowercase.

**Live observation:** `/t/1` reads level 2, streak 1, so the rehearsal's first token missed a day within its first three. If that is the seed agent's path, the house token's uptime is itself on show.

**Not done:**
- I did not decode any QR. The Sepolia url collision is inferred from source.
- I did not see the shipped finisher inks or any Mark at version 10, because no such image is in the snapshot.
- `/mcp` and `/skill.md` returned status only, no body.
- I did not open `LICENSING.md`, `docs/phase0-results.md`, the clasp, ring, noise or heart-v5/6/8 sheets, the remaining `token-*.png` files, the other `docs/*.png`, or `references/refusals.md`.
- OpenSea behaviour is untested by anyone, as the project states.
