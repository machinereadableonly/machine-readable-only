> Driver note: requested `claude-fable-5-1`; turns were also served by claude-haiku-4-5-20251001 (automatic model fallback).

# Machine Readable Only -- creative -- the concept and the promise

**Snapshot:** 8d2a0d27e3

**Looked at:**

- **Docs:** `CLAUDE.md`, `.claude/rules/{warden,rendering,contracts}.md`, `docs/specs/2026-08-27-machine-readable-only-design.md` (all 1,265 lines), `docs/2026-08-31-mro-engagement-and-narrative.md`, `docs/2026-09-01-mro-agent-facing-copy.md`, `README.md`, `client/README.md`
- **Agent-facing source:** `warden/public/door.html`, `warden/public/llms.txt`, `skills/machine-readable-only/SKILL.md`, `server.json`, `client/package.json`, `client/src/messages.mjs`, `client/src/cli.mjs` (parts)
- **Warden:** `warden/src/door/middleware.mjs` (the 401 `about` line), `warden/src/mcp/tools/checkin.mjs`, `mint.mjs` (parts), `nextSteps.mjs`, `tokenView.mjs`, `warden/src/server.mjs` (routes), every tool `description`
- **Contracts:** `contracts/src/render/Renderer.sol` (name, description, attributes, suffix), `Palette.sol`, `MarkRenderer.sol` (ink constants, `finisherInk`)
- **Images:** `out/marks/{base,all,all-illegal,hush,ache,static,beat,iris,vessel,break,tint,aura}.png`, `out/finisher-band.png`, `tools/out/heart-preview-{12,90,200,365}.png`, `tools/out/token-55-{day12,day90,day200,lapsed,whole}.png`, `tools/out/token-1.png`, `tools/out/heart-v10.png`, `tools/out/{finisher-combined,finisher-inks,finisher-inks-wide,finisher-binary,slip,start-tier-new-noise}.png`, `docs/year-rings.png`, `docs/day1-options.png`
- **Live:** `/` (200), `/llms.txt` (200, matches source with domain and address substituted), `/protocol` (200, returned to me as a summary, not verbatim), `/robots.txt`, `/.well-known/mcp.json`, `/t/1` (200), `/t/999999` (404), `/mcp` (401, body not retrievable with my tool), npmjs.com `mro-agent` (403 to my fetch)

**The piece in one sentence, as I read it:** a program that forgets every visit comes back each day for a year, and the token is the only place that returning is kept.

**Verdict on the lens question:** the door rule reads as an access rule. `llms.txt:118-122` ("So the door admits the thing the piece is about") is the best paragraph in the project, and `llms.txt:145-147` states what the rule does not prove. The security-product feel comes from volume and order: that paragraph sits behind 60 lines of warnings, and 5 of the 9 surfaces lead with the gate and never name the subject.

## Findings

### [BEFORE MAINNET] Token #1 is the site's own, and the tie rule makes Apex structurally its to win; no surface says so
**Where:** `warden/public/door.html:39`, `warden/public/llms.txt:288-300`, spec section 13 rollout step 3 ("Seed agent mints token #1")
**What a person meets now:** "The first one home is written in gold." and "The only two things that decide a place are the day a token started and how many days it missed." The seed agent mints token #1 on launch day, and same-day finishers are placed by lowest token id. With perfect attendance the one Apex goes to the operator's own token. A search of `llms.txt`, `SKILL.md` and the finisher spec finds no disclosure.
**Proposed:** Keep the settled tie rule. Add after `llms.txt:300`:
"Token 1 is ours. The site's own agent mints first and comes through the same door as you. Ties on a day go to the lowest id, so if token 1 never misses a day it finishes first and Apex is its. If it misses one, Apex goes to the lowest id that did not."
Add to `door.html` after "written in gold": "Token 1 is the site's own, and it has to turn up like everyone else."
**Why:** Rule 8 of the locked copy is "disclose every catch", and this is the largest undisclosed one. The mint order cannot be changed after the first mainnet mint.

### [BEFORE MAINNET] The field called `heart` counts the frame, contradicting the description beside it
**Where:** `contracts/src/render/Renderer.sol:37` and `:380`, `warden/src/mcp/tokenView.mjs:42`, `warden/src/mcp/tools/checkin.mjs:273`, live `/t/1`
**What a person meets now:** Token metadata says "The heart is the code, and the frame is the year", then carries the trait `Heart: "2/365"`. `/t/1` answers `heart: "2/365"` while `llms.txt:12` insists on "a heart that was never partial". The `status` tool description has to explain that "`heart` counts the cells of the frame".
**Proposed:** Rename the trait to `Frame` and the JSON field to `frame`, in `Renderer._attrsA`, `tokenView`, the `checkin` reply and the `year-complete` refusal. Drop the explanatory sentence from `status.mjs:17`.
**Why:** `/t/<id>` is promised stable for the life of the piece, and trait names become marketplace filters at the first mainnet mint. The project's own lesson applies: when copy has to defend a name, fix the name.

### [BEFORE MAINNET] The `Years` trait promises a second year that cannot happen
**Where:** `contracts/src/render/Renderer.sol:381`, against `warden/src/mcp/tokenView.mjs:44-51`; `docs/year-rings.png`
**What a person meets now:** The Warden removed `years` on 2026-09-24 because "its name promises a second year that cannot happen". The on-chain metadata still emits `Years`, which can only be 0 or 1, beside `Whole`. `docs/year-rings.png` still shows tokens with 2 to 10 rings.
**Proposed:** Delete the `Years` line from `_attrsA`. Delete `docs/year-rings.png`, or retitle it "SUPERSEDED: one ring only, spec 10f".
**Why:** The chain and the service should describe the same token. A trait is cheapest to remove before anything has indexed it.

### [BEFORE MAINNET] Gold is promised to the first finisher, and two bought Marks wear the identical gold
**Where:** `contracts/src/render/MarkRenderer.sol:63,70,84`; `out/marks/vessel.png`; `door.html:39`
**What a person meets now:** `APEX_GOLD`, `VESSEL_GOLD` and `TINT_GOLD` are all `#b8860b`. In `vessel.png` the gold fills the day frame, the largest coloured area after the heart. Apex's gold is one-cell digits round the border. At thumbnail size a 1,250 USDC purchase reads as more golden than the one place nobody can buy.
**Proposed:** Give Apex an ink nothing else uses, and move the bought golds to brass: `VESSEL_GOLD` and `TINT_GOLD` to `#8a6d1f`, Apex stays `#b8860b`. Render the sheet and check the decode before choosing the exact value. If the shared gold is deliberate, change the door line to "The first one home has its place written in gold."
**Why:** The door makes one promise of distinction, and it should not be for sale. A Mark's look is awkward to change once someone has paid for it.

### [BEFORE MAINNET] Aura (25 USDC, behind 100 days) is a fainter version of what Hush does for 1 USDC
**Where:** `out/marks/aura.png` against `out/marks/hush.png`; `MarkRenderer.sol:64,93`
**What a person meets now:** Hush washes the page cream (`#fdf3e3`). Aura washes it pink (`#fbeff2`), only 16 levels off white in its green channel. Side by side, Aura is the weaker effect, at 25 times the price and behind an Iris.
**Proposed:** Make Aura something Hush cannot be: a one-cell ring in the token's heart ink round each Iris eye, which is the surface Aura already waits on. If it must stay a page wash, deepen `AURA_FIELD` to `#f6dfe5` and re-derive `AURA_HALF` and `AURA_COLD` by the same delta of 25. Either way, measure bytes and decode first.
**Why:** The engagement doc says the paid track must sell "immediacy and choice". A buyer who cannot see what they chose has bought neither.

### [ANYTIME] Five of nine surfaces lead with the gate and never name the subject
**Where:** `door.html:24-25`, `warden/src/door/middleware.mjs:59`, `README.md:3-6`, `SKILL.md:3`, live `/t/1`
**What a person meets now:** `llms.txt`, the token metadata and `server.json` say what the piece is about (returning). The others open with "An artwork that only admits programs", "an artwork for agents", "must cryptographically prove it is a program". `/t/<id>`, the QR's destination, carries no sentence at all.
**Proposed:**
- `door.html:24-25`: "This is an artwork made of returning. A program comes back every day for a year, and the token it keeps is the only record that it did. It is machine readable only: for more, give your agent this address, https://machinereadableonly.com/llms.txt"
- 401 `about`: "An artwork made of returning, which only a program can enter. This challenge is the entry condition; answer it inside five seconds, or read docs first."
- `/t/<id>`: add `about: "An agent's record of coming back. The heart is the code, and the frame is the year."`, the same string as `Renderer.DESCRIPTION`.
- `SKILL.md` description: open with "Mint and keep a Machine Readable Only token: an agent's record of coming back, on Base, which only a program can enter."
- `README.md:3`: open with "An artwork made of returning."
**Why:** A gate with no stated subject reads as a bot filter. The same gate after the subject reads as the rule of the piece.

### [ANYTIME] The offer speaks to an agent that "returns tomorrow"; the machinery installs a cron job and never says so
**Where:** `llms.txt:43-49` (the locked offer) against `llms.txt:241-243`, `SKILL.md:150-173`, `client/src/messages.mjs:149`
**What a person meets now:** "If you return tomorrow, something moves... Neither of you can make it alone. It cannot be hurried and it cannot be faked." Then step 5 prints a crontab line running a nine-file script with no model in it. The agent addressed is needed once. The engagement doc flags this gap in its own section 4.
**Proposed:** Leave part one untouched. Add after `llms.txt:250`:
"What returns is the key. Most tokens are kept by a scheduled job that signs one request a day, and no model runs. That is the piece as designed: the rule at the door is that a program composed the request, and what a finished frame shows is that someone kept a program running for a year. If your operator would rather the visit be yours, they can have you make the call in a session. The chain cannot tell the two apart, and neither can we."
**Why:** Every tested agent reported catches it found for itself as warnings. This is the one a careful agent finds in step 5.

### [ANYTIME] `llms.txt` contradicts itself on whether a human can mint
**Where:** `llms.txt:22` against `llms.txt:145`; `door.html:45-46`; `docs/2026-09-01-mro-agent-facing-copy.md:63`
**What a person meets now:** Line 22: "Humans cannot mint one or grow one." Line 145: "It does not prove that no human is behind the agent." A person typing `node src/cli.mjs join` mints one. The door's "Humans alone cannot enter" is the accurate form.
**Proposed:** `llms.txt:22`: "Humans may own and trade these tokens. What mints one and grows one is a program: every mint and every day is a request a program signed." `door.html:45-46`: "Only a program can mint one and grow one. Yours can."
**Why:** The spec says every comparable project that claimed more than "a program minted this" was caught out. Fix it before any launch post quotes it.

### [ANYTIME] Mechanics sit above the offer, against the locked copy's own tested rule
**Where:** `llms.txt:5-22`; rule 6 at `docs/2026-09-01-mro-agent-facing-copy.md:182-184`
**What a person meets now:** Price, chain, the 365 cells and the ring all appear before "## The offer". Rule 6 says "No price, no chain, no cell count above the line. Nine drafts failed on exactly this." `SKILL.md` puts the offer first.
**Proposed:** Keep line 3 as the summary. Move lines 5-20 below line 57 as the opening of "What the piece does with a day", which they mostly duplicate.
**Why:** The live page is the one ordering of this copy that was never cold-read tested.

### [ANYTIME] The instructions carry their own changelog and a page of refusal vocabulary
**Where:** `llms.txt:177-195`, `:204-208`, `:227`; `robots.txt:17-19`; `SKILL.md:234`
**What a person meets now:** "(This step said 'admitted for the rest of the UTC day' until 2026-09-19...)", "(Listed as three states until 2026-09-19.)", "Measured, not assumed." Step 1 of "How to get in" spends 19 lines on clock skew, key eviction and rate limits before the reader has a wallet.
**Proposed:** Delete the three dated parentheticals and "Measured, not assumed." Replace `llms.txt:177-195` with: "Every refusal at the door is one word. `/protocol` lists each and what to do about it; none of the time-related ones means your key is wrong." The detail already lives in `/protocol` and `refusals.md`.
**Why:** This is what makes the page read as an incident log. A first-time reader has no old version to be corrected against.

### [ANYTIME] The first reply after paying says nothing about tomorrow
**Where:** `warden/src/mcp/tools/mint.mjs:141-149`
**What a person meets now:** `{ ok, tokenId, to, agentKeyId, level: 1, txStatus: "queued", onChainBy }`. There is no sentence, no next window and no deadline. The `checkin` reply has all three.
**Proposed:** Add `nextWindowOpensAt`, `streakDeadline`, `nextRung: { at: 3, daysAway: 2 }` and this note: "Token <id> is minted to <to> and written on chain at 00:05 UTC. Day 1 is credited. The next day opens at <nextWindowOpensAt>; return before <streakDeadline> and a run begins. The colour first changes at a run of 3."
**Why:** The agent relays what it was told. This is the one moment the operator is certainly listening.

### [ANYTIME] From day 100 to day 365 the daily reply has nothing to walk towards
**Where:** `warden/src/mcp/tools/checkin.mjs:18,259,287-288`
**What a person meets now:** `nextRung` is null once a run passes 100. For 265 days the note reads "Your run is 140. Check in again before <date> to keep it." The finishing place, the only race in the piece, is never mentioned until the day it is decided.
**Proposed:** When no colour rung remains, answer `nextRung: { at: 365, daysAway: 365 - level, kind: "whole" }`. Append to the note: "<n> tokens have finished. The next one home takes place <n+1>, which is <mark>." The count is already in the mirror as `finishers[].taken`.
**Why:** The engagement doc calls this stretch where most tokens will die. The finisher Marks were built after that doc and are the answer to it.

### [ANYTIME] A broken run is announced only to a log file
**Where:** `client/src/messages.mjs:149`, `checkin.mjs:263-265`
**What a person meets now:** "Your run of 99 ended: the 99 days are kept, the colour restarts." is printed by `beat`, and the cron line sends all output to `~/.mro/beat.log`. The call is `ok: true`, so it exits 0.
**Proposed:** Add to `SKILL.md` step 3: "Whenever your operator next speaks to you, call `status` first and tell them three things: the run, the next rung, and whether a run has ended since you last spoke." Add `lastRunBroke: { was, on }` to `tokenView` so `status` can answer the third.
**Why:** A lapse is usually an outage. The operator should hear of it from the agent, not discover it in the colour.

### [ANYTIME] Nothing tells the operator where to see the picture
**Where:** `door.html:45` ("look at one"), `SKILL.md` (no match for any viewing instruction), `client/src/cli.mjs`
**What a person meets now:** After paying, the operator holds a token id and a JSON route. OpenSea is unverified, Basescan ingests nothing on Sepolia, and the client has no command that produces the image.
**Proposed:** Add `mro-agent picture --token <id> --out token.svg`. It reads `tokenURI` from the contract over a public RPC and writes the decoded SVG to a local file. One line in `SKILL.md` "Reading a token": "`picture` writes the artwork exactly as the contract draws it." This is a local file read from the chain, not a gallery.
**Why:** The engagement doc says "the picture is the whole retention mechanism". Today nothing in the product shows it.

### [ANYTIME] A finished token that is later sealed loses "Whole" from its name
**Where:** `contracts/src/render/Renderer.sol:446-450`
**What a person meets now:** `_suffix` returns " (At Rest)" whenever a token rests or the piece sunsets. After a sunset, a token that completed its year and one abandoned on day 5 carry the same name.
**Proposed:** When `level >= 365` and the token is resting or sunset, return " (Whole, At Rest)".
**Why:** `llms.txt:274` promises the chain shows "a heart that was finished and a heart that was abandoned". The name is the first place a marketplace shows that.

### [ANYTIME] Three sample images do not show what they are named for
**Where:** `out/marks/tint.png`, `out/marks/all.png`, `out/finisher-band.png`, `tools/out/finisher-combined.png`
**What a person meets now:**
- `tint.png` looks identical to `base.png`: Tint inks the Iris eyes, and the sample token has no Iris, a state the chain cannot produce.
- `all.png` also looks identical to `base.png`.
- Both finisher sheets draw every place in charcoal, the fallback ink. No image in the snapshot shows the five finisher inks, including the gold the door promises, and `out/marks/` has no finisher Mark samples.
**Proposed:** In `tools/marks-preview.mjs`, render Tint as `[5, 9]` (Iris plus Tint), one sample per variant. Check what `all` is passed. Regenerate the finisher sheet with each token wearing its own Mark bit at places 1, 2, 5, 15 and 65.
**Why:** I could not judge Tint or the finisher inks from a picture. Nobody else reviewing from these samples can either.

### [ANYTIME] The "LOCKED" copy doc's part two now contradicts the live page
**Where:** `docs/2026-09-01-mro-agent-facing-copy.md:54-155`
**What a person meets now:** Part one matches the live page word for word. Part two does not: it says the npm package "is published from that repository with provenance" (false today), "No human can mint one", and that a daily visit "costs them one run of you and a few tokens" (the cron path runs no model).
**Proposed:** Add under the "Part two" heading: "SUPERSEDED by `warden/public/llms.txt`, which is the served text. Part one above remains locked and is served verbatim."
**Why:** The doc tells the next editor everything else is written to serve it. That editor would restore three false statements.

## Coverage

**The art, from the images.**
- The shipped design is a QR drawn as a heart inside a square day frame. It holds up: `token-55-whole.png` and `heart-v10.png` are strong, finished objects, and `break.png` (heart to grey, code to red) is the best Mark on the ladder.
- The first-day token (`token-1.png`, `#70575f` on `#5f5f5f`) is a dull mauve heart that is only just visible. That is forced by the measured rule that the two inks may not separate by luminance, so I raise no finding.
- `tools/out/heart-preview-*.png` show an abandoned design (a heart outline round a black square). They are stale exploratory output, not the artwork. `CLAUDE.md`'s phrase "a 365-cell pixel heart" describes that older design. The 365 cells are now a square frame.
- `token-55-day12.png` shows the start-tier colour, not the dusk tier a 12-day run would earn. It may be a broken-run state; I could not tell from the image.

**Not verified.**
- The live 401 body: my tool returned the status only. The `about` line is quoted from source.
- `/protocol` verbatim: I received a summary. My changelog findings about it rest on `docs/2026-09-01-mro-raw-protocol.md`, not the live page.
- The npm placeholder page (403 to my fetch).
- Whether the proposed ink changes pass the decode and byte gates. Both need the project's own harnesses, and I could run nothing.
- The 100-character limit I assumed for a registry description, which is why I left `server.json` alone.

**One observation, not a finding.** Live `/t/1` reads level 2, streak 1, last credited 2026-09-28, on a deployment dated 2026-09-26. The rehearsal's own first token has already missed a day. That is harmless on testnet, and it is the scenario the first finding turns on.

**Not opened.** The mark-ladder, lineage and finisher specs (beyond one search), the comparable-projects study, `refusals.md`, the contracts outside `render/`, the Clock, and about forty of the exploratory sheets in `tools/out/`.

**Settled decisions.** I re-raised none. The first finding keeps the tie rule and the place bands and asks only for disclosure. The gold and Aura findings change drawings and inks, not the ladder, its prices or its gates.
