# Machine Readable Only -- Project Instructions

<!-- PROJECT-SPECIFIC SECTIONS -- unique to this project -->

## What This Project Is

An agents-only NFT art piece on Base. A site with no human-facing rendering:
a visitor must cryptographically prove it is a program before it can enter,
connect a wallet and mint. The token is a living record of the agent's
return visits, so the artwork is the agent's own history of coming back.

- **Role:** Art piece and protocol demo (both, deliberately -- not a
  speculative collectible)
- **Stack:** Solidity (Foundry 1.7.1) + Node 24.14.1; MCP server; reference
  client BUILT in `client/` as the `mro-agent` package (not yet published),
  plus a SKILL.md that is not written yet
- **Status:** Spec revision 3 APPROVED 2026-08-27. Phase 0's TASK LIST IS
  COMPLETE as of 2026-08-29 -- Tasks 1-10 of plan revision 2, plus Task 10b
  (the state soak) and Task 10c Phases 1-3. The budget question is SETTLED
  (see Gotchas) and the spike is deployed and Basescan-verified on Base
  Sepolia. TASK 11, the throwaway Base MAINNET deploy for the OpenSea check,
  WAS DROPPED by the operator on 2026-08-29: Phase 0 spends no real funds.
  **PLAN 1 (the token contract) IS BUILT as of 2026-08-30** -- all ten tasks
  reviewed, plus a final whole-branch review. The pre-fix build at
  MachineReadableOnly 0x29Fd79212D6f7fc61ddF21aFEbe44046F3D1DB65 and Renderer
  0xfBA313941CCaAf08492cE501cF2F73839904fc35 is SUPERSEDED; do not read state
  off it.
  **THE SEVEN PRE-MAINNET FIXES ARE APPLIED as of 2026-08-30 (commit b3d0282)
  AND THE FIXED BUILD IS DEPLOYED AND VERIFIED ON BASE SEPOLIA** -- 231 tests
  pass. That build's addresses were MachineReadableOnly
  0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D, Renderer
  0x00c3B576769cd42852328528E0D97F76a51A2E7c -- both SUPERSEDED by the Plan 5
  deploy on 2026-09-03 (see below). Do not read state off them. See the gotcha
  below and the plan1-prelaunch-fixes memory.
  **PHASE 0 IS SIGNED OFF, by the operator on 2026-08-30.** The last item, ERC-4906, was
  closed by DECISION rather than by measurement: keep emitting it, and accept
  that a consumer ignoring it is outside this project's control. The question
  is unanswerable on Base Sepolia, so it closed by accepting that limit. Do
  not re-open it, and do not describe Phase 0 as blocked or pending.
  **PLAN 2 (the Warden service) IS BUILT as of 2026-08-31** -- 54 commits,
  `33e5b31` to `30e0af2`, on main with the operator's consent. warden/ holds the door
  (RFC 9421 + the 5s challenge + the key directory and its SSRF guard), the
  node:sqlite mirror, the 2026-07-28 MCP server with eight tools, the bitmap
  solve queue, the x402 adapter and the bootstrap. **196 warden tests; 231
  contracts and 56 tools unchanged.** It holds NO private key -- every chain
  write is Plan 3's.
  **PAYMENT IS WIRED as of 2026-08-31 (commit `f4de22a`)** -- `@x402/evm`
  2.24.0 installed, `makePaymentGateway` live, and a real agent through the
  real door is handed a correct mint demand on Base Sepolia. **Warden
  tests are now 214.** SETTLEMENT IS STILL UNPROVEN (it needs testnet USDC
  from a captcha-gated faucet) and the treasury is a PLACEHOLDER. See the
  plan2-payment memory.
  **THE GATES NOW MIRROR THE CONTRACT as of 2026-08-31 (commit `df8d012`)** --
  WalletCap, Resting, notSunset AND whenNotPaused (a fourth gate no document
  had recorded) are read live from the chain, the paid tools re-read them after
  settlement, and an unreadable RPC REFUSES rather than admits. **Warden tests
  are now 240.** `BASE_RPC_URL` is load-bearing for every write now, not just
  the rebind re-check.
  **PLAN 3 (the Clock) IS BUILT as of 2026-08-31** -- commits `28d2ae7` to
  `d61bcb9`, in `warden/src/clock/`. It holds the ONLY key in this repository.
  The signer is separated on chain: warden is now
  0xb919443Ecb8B73a6179a523734f2184d26fF4D7A and owner is unchanged, proven in
  both directions. PROVEN ON CHAIN, not simulated: two mints with real solved
  bitmaps, a batchCheckIn crediting a day, the re-chunk rule dropping a bad
  entry by name while the good one landed, and reconcile paging five windows
  across 49,000 blocks. **Warden tests are now 283.** See the plan3-status and
  clock-live-lessons memories.
  WHAT IS LEFT FOR the operator: (1) there is still no domain, so deployment is written
  and never applied -- including the Clock's systemd timer, which is verified
  but not installed; (2) a real TREASURY_ADDRESS -- a placeholder is in use and
  refuses to start on any chain but Base Sepolia; (3) settlement is still
  unproven and needs testnet USDC; (4) the daily X post is deliberately unbuilt
  and needs X API credentials.
  **PLAN 4 IS PART-BUILT as of 2026-09-02.** Tasks 2, 4, 5 and 8 are DONE:
  `docs/2026-09-01-mro-raw-protocol.md` documents the protocol request by
  request (transcribed from a live capture, `warden/tools/protocol-transcript.mjs`,
  not from reading the source); `warden/test/scope.test.mjs` pins the key-scope
  and payment-scope claims; and `client/` is the reference client `mro-agent`,
  built from nothing -- the plan wrongly said one already existed. The protocol
  doc was cold-tested on SIX fresh agents: all six engaged, none refused, and
  they found three real defects. Read the plan4-client-and-auditability memory
  before touching any of it. **Suites at that commit: contracts 232, warden 289,
  tools 56, client 24.**
  **A BLOCKING PAYMENT BUG WAS FOUND AND FIXED 2026-09-02 (`eaac15a`)** -- the
  MCP tool wrapper double-wrapped the paid tools' refusals, burying `isError`,
  so the official x402 client could not see a payment demand and NOTHING COULD
  BE MINTED. Found by documenting the wire format, not by testing. The live
  check that was meant to prove payment worked used a regex over the raw JSON
  and passed happily. See the plan2-payment memory.
  **THE MINT PRICE IS 1 USDC as of 2026-09-01 (`f49749c`)**, swept everywhere.
  It is the Warden constant `MINT_PRICE`, not an on-chain value.
  **PLAN 5 (the Mark ladder) IS BUILT as of 2026-09-02 and NOTHING IS
  DEPLOYED.** Spec: `docs/specs/2026-09-02-mro-mark-ladder-design.md`, which
  SUPERSEDES section 9 of the master spec. Ten Marks in FIVE EXCLUSIVE PAIRS; in
  FOUR of the pairs one side is bought and one earned by a run of days, and pair
  five (Tint / Aura) is BOUGHT ON BOTH SIDES with both sides gated on holding an
  Iris. Taking either side closes the other. EVERY EXCLUSION IS PAIR-INTERNAL --
  the cross-pair rule that cost Break was removed as a trap on 2026-09-02, along
  with a second trap (ungated Aura). The CONTRACT change landed -- the first
  since Plan 1: two uint16 masks on `Upgrade` (excludes, requiresAny), a
  `variant` argument on `applyMark`, and variants packed into the spare bits of
  `_marks`. BOTH renderers draw the ladder. All four visual questions are CLOSED
  by rendering: Static is green, Beat violet, the Iris offers target / squircle
  / leaf, Tint offers violet / gold. 189 Mark sets, 459 renderable combinations.
  The Warden's catalogue is `warden/src/mcp/ladder.mjs`, a hash-checked mirror
  of `contracts/src/Ladder.sol`; `upgrade` accepts ids 1-10 with a `variant`,
  checks every gate BEFORE payment and names the Mark that excluded it, and a
  NINTH tool, `ladder`, reads a token's pairs back for free so a forfeit is
  legible before it is taken. THE FOUR EARNED MARKS ARE FREE AND RESERVE AT THE
  DOOR. The six bought Marks carry the settlement caveat as well.
  **THE LADDER IS DEPLOYED AND VERIFIED ON BASE SEPOLIA, 2026-09-03, with the operator's
  approval: MachineReadableOnly 0xf0Df806ff06ae051756db128Bc9F83CDB425a716,
  Renderer 0xb95D32292a5517415B9e4A61e4A30d97F4136539.** All ten Mark records
  read back correct off the chain, and the three-argument `applyMark`
  (0xf542b20e) is present, so the mismatch that made every Mark unwritable is
  gone. the operator repointed the Warden's configured contract address to match.
  NO MARK HAS ACTUALLY BEEN WRITTEN YET, and NOTHING IS MINTED on this
  deployment -- `viewOf(1)` returns level 0. The agent-facing copy still prints
  the OLD address and needs one line changed.
  `DeployPlan5.s.sol` needed a fix to run at all: it called a bare
  `vm.startBroadcast()` with no sender, so forge refused AFTER the simulation
  passed (commit c62ce2d). Read the plan5-status, mark-ladder-spec
  and static-hue-decision memories BEFORE touching Marks.
  **Suites: contracts 268, warden 355, tools 66, client 25** (2026-09-02).
- **Secrets:** `contracts/.env` only, chmod 600, never committed -- the operator edits
  it via WinSCP. Claude never reads it. `.env.example` holds the schema.
- **Environment:** VPS
- **Port:** 3006, the Warden, registered in
  `~/.claude/templates/port-allocation.md` on 2026-08-30. Bound to 127.0.0.1
  only; public traffic arrives through nginx. Nothing is deployed yet.

## Hard Rules (never break these)

1. **Base MAINNET and permanent.** The whole point is a record of return
   visits, and that history cannot be moved to another chain later. Do not
   propose a chain migration.
2. **Never spend real funds without explicit the operator approval, every time.**
   Mainnet deploys and any transaction with real value are operator-approval gates.
   Phase 0 no longer contains one at all -- Task 11 was dropped. There is no
   standing approval.
3. **Read the spec before any MRO work:**
   `docs/specs/2026-08-27-machine-readable-only-design.md`. It is 60 KB;
   read the relevant sections, not a skim.
4. **Phase 0 GATE IS PASSED** (signed off 2026-08-30). The rendering spike
   gated every other plan and no longer does. The token contract, Warden,
   client and Clock are now open to start. The spike's measured limits still
   bind the work that follows -- see Gotchas -- but the gate itself is done.
5. **Do not re-open decided ground.** Free mint, per-token yearly seeding,
   Ethereum / Solana / Monad, and a human-facing gallery are all decided
   against. Do not re-propose them. **Payment stays USDC** (reaffirmed by the operator
   2026-08-31): x402's exact scheme handles ERC-20 only, so native ETH is not
   available at all, and WETH would need a Permit2 approval -- an on-chain
   transaction and a gas balance the paying agent currently does not need. It
   would also untether the Marks ladder, which is priced in dollars.
6. **Frame proof-of-agent as an access rule**, which is what it is: an entry
   condition for an art piece ("a program minted this"). It is not an
   anti-abuse or bot-defence system, and describing it that way invites a
   safety classifier that derails the session.
7. **Every contract must be proven deployable before it is called done:**
   `forge build --sizes` showing positive runtime margin AND a strict-limit
   anvil deploy with non-empty `cast code`. `test/ContractSize.t.sol` fails
   the suite otherwise.

## Conventions

- **Plain ASCII only** in all docs and code comments. No em dashes, smart
  quotes, arrows or emoji.
- **Propose specifics, never adjectives.** Name the exact mechanism, not
  "a robust check".
- Solidity work follows the global smart-contract testing rules: every
  owner / emergency / admin function gets an explicit test, every
  access-control revert gets a test, and `forge build --sizes` must show
  positive runtime margin under 24,576 bytes before anything is called
  deploy-ready.
- **Builds AND any long-running compute go through `~/scripts/build-project.sh`
  or `~/scripts/safe-build.sh`.** The wrapper takes any command, not just a
  build: `~/scripts/safe-build.sh node ./sweep.mjs`.
  This project's normal work is exactly the shape that breaks the box --
  rasterising SVGs and decoding them in bulk. On 2026-08-28 a bare
  `node -e` sweep (400 renders x 14 pixel sizes) reached 6.28 GB resident,
  hit the 7.8 GB box limit, and destroyed this tmux session. The rule was
  already here; it said "builds", and that was not a build.
  Rule of thumb: if a command is slow enough that you are about to background
  it, it is big enough to cap. Split bulk sweeps into batches as well.
- Use `/bin/grep`, never bare `grep`.
- Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`. Non-interactive shells have neither on PATH.
- Tests: Foundry for Solidity (`cd contracts && forge test`), `node --test`
  for tools (`cd tools && npm test`), the Warden (`cd warden && npm test`) and
  the client (`cd client && npm test`). ALL FOUR green before any commit.
  The client's suite runs against a real Warden built from `warden/src`, so a
  door change can break it.
- Generated files (for example `contracts/src/render/FrameGeometry.sol`)
  carry a `// GENERATED by tools/<script>` header and are never hand-edited.
  Change the generator and re-run it instead.
- The Bash tool's working directory persists between calls, and the
  project-isolation hook compares write targets against it. After a `cd`
  into a subdirectory, `cd` back to the repo root before editing root files.

## Key Decisions (locked 2026-08-27)

- **Entry:** RFC 9421 / Web Bot Auth signed request, plus a 5-second
  stateless code-only challenge.
- **Mint:** 1 USDC via x402 inside MCP (`@x402/mcp` + `@x402/evm`), raised
  from 0.10 by the operator on 2026-09-01. The price is NOT on chain -- it is the
  Warden constant `MINT_PRICE`, so changing it needs no redeploy. The
  testnet facilitator is `https://x402.org/facilitator` -- the spec's
  `https://facilitator.x402.org` DOES NOT RESOLVE and was corrected
  2026-08-31. That host is testnet-only; mainnet is the CDP one and needs an
  API key.
- **Check-ins:** free to the agent, paid by the site, batched into one
  transaction per UTC day at 00:05. The check-in window is ONE DAY WIDE on
  chain (`lastDay < day <= today()`), so a run twice in a UTC day gets
  FutureDay on the second -- read the contract's `today()`, never the box's
  clock.
- **Token art:** static identity QR (payload `https://<domain>/t/<id>`,
  JSON) plus a 365-cell pixel heart, one cell per credited day. Streak sets
  colour at 3 / 7 / 30 / 100; a lapse pales it in steps. Rings mark extra
  years.
- **Marks:** the ten-Mark ladder, BUILT 2026-09-02. The seven independent tiers
  (Vein, Blue Blood, Voice, Bloom, Halo, Crown, Singularity) are retired. Ten
  Marks in five pairs, nothing limited, ids 1-10 in this order: Hush $1 / Ache
  run 7; Static $5 (level 30) / Beat run 30; Iris $25 (level 100, three shapes)
  / Iris run 100; Vessel $1,250 (whole heart) / Break run 365; Tint $250 (two
  inks) / Aura $25 -- pair five is BOUGHT ON BOTH SIDES and both wait on an
  Iris by either route. The x402 demand carries no thousands separator, so the
  Vessel string is `$1250.00`. See
  `docs/specs/2026-09-02-mro-mark-ladder-design.md`, and read it beside
  `contracts/src/Ladder.sol` and `warden/src/mcp/ladder.mjs`, which mirror each
  other by hash.
- **Endings:** Rest (owner seals, irreversible), Sunset (operator closes),
  Lineage (one seed per agent-year, same collection, tenure not depth).
- **Renderer** is swappable, split three ways.
- **Voucher check-in path ships paused.**
- **The reference client is the product.** Built-in MCP clients cannot sign,
  so `npx mro-agent` plus SKILL.md is how agents actually arrive.

## Open Questions

- **Child token visuals and the lineage narrative** are deliberately
  deferred to a follow-up brainstorm before the Renderer is built.
  Candidates are recorded in spec section 10.
- **Repo visibility.** Local git only for now. Whether this goes public is
  undecided; if it does, it needs a history scrub first.

## Gotchas

- **OpenSea is NOT being checked in Phase 0.** It has had no testnets since
  2025-07-23, so the only way to check it was a throwaway Base MAINNET
  contract (plan revision 2, Task 11). the operator dropped that on 2026-08-29, so
  OpenSea's display and refresh behaviour is UNVERIFIED and must never be
  described otherwise. Should it ever be revived, it is a real-funds step
  needing explicit the operator approval; the run measured 5,613,812 gas on 2026-08-29,
  about eight US cents at Base's 0.006 gwei floor -- re-measure on the day
  rather than quoting that.
- **OpenSea flattens the SVG image to PNG** and needs ERC-4906 events with
  the exact token range, emitted AFTER the write, plus a refresh API call.
  Alchemy's NFT API flattens the same way and DOES run on Base Sepolia, so
  Task 10c Phase 2 rehearsed the same mechanism against a free consumer.
  Alchemy is the ONLY such consumer on that network -- Basescan is not one,
  measured 2026-08-30. Do not repeat the old "Alchemy and Basescan both" claim.
- **tokenURI gas WAS the live risk and is now settled.** Measured comparables:
  Loot 572k, Anonymice 24M. Phase 0 targets 1M gas / 5 KB and fails over at
  2M / 20 KB. Measured 2026-08-29 through the token contract on Base Sepolia,
  after the intrinsic SVG size was adopted: worst case 1,633,224 gas / 8,924
  bytes, leaving 366,776 gas and 11,076 bytes. The 2M / 20 KB HARD limit
  passes; the 1M / 5 KB TARGET is MISSED and must be reported as missed. The
  worst case is the day BEFORE the heart seals (level 364), not the oldest
  token -- see docs/phase0-results.md. Do not quote the older 1,590,476 /
  10,066 pair; it predates the intrinsic size.
  THREE worst-case figures exist and ALL THREE are correct -- do not treat any
  of them as a stale version of another. They measure DIFFERENT TOKENS.
  (1) **1,633,224 gas / 8,924 bytes** is soak token 21 read over RPC, the number
  for what a real provider returns. It PREDATES Plan 5 and nothing has
  re-measured that path since the ladder was drawn.
  (2) **1,749,915 gas / 10,651 bytes** is the GAS worst case in Foundry
  (`GasBudget.t.sol` token 9: level 364, run 400, maximal Mark set). This is
  `worstGas`, what the suite asserts and the one to compare across commits;
  Plan 5 moved it from 1,585,616 / 9,223 on 2026-09-02. Gas margin 250,085.
  (3) **1,679,943 gas / 11,550 bytes** is the BYTE worst case in Foundry (token
  7: level 3,650, the ring cap, run 400, maximal Mark set). This is `maxBytes`,
  and the byte margin is 20,000 - 11,550 = **8,450**, not the 9,349 you get by
  subtracting the gas worst case's byte count.
  THE DEAREST TOKEN AND THE LARGEST TOKEN ARE NOT THE SAME TOKEN --
  `GasBudget.t.sol:119-120` says so and the test prints each headroom against
  its own worst case. Pairing one token's gas with another's bytes is the exact
  mistake that was in this file until 2026-09-02. (1) differs from (2) and (3)
  because a bitmap encodes its own url, so every token has its own run
  structure. "Every Mark at once" is no longer a state any token can reach:
  the five exclusive pairs cap a token at five Marks, and the maximal LEGAL set
  is Hush + Beat + the bought Iris in leaf + Vessel + Tint. Do not quote the
  retired seven-Mark figures.
- **A third party's CDN interpolates unless the SVG declares a size.** With no
  width/height it rasterises at the viewBox units -- 53 pixels, one per module
  -- then upscales that bitmap, and 54% of the results would not decode.
  Declaring canvas * 16 took that to 3.6%. The grey-level count is the cheap
  diagnostic: the artwork has 3, a resampled copy has 150-208.
- **ERC-4906 is CLOSED BY DECISION (the operator, 2026-08-30): keep emitting it, and
  accept that a consumer ignoring it is outside this project's control.** The
  measurements below still stand and still inform Plan 3, but the question is
  DECIDED and must not be re-opened as an open risk. Cost checked before the
  call: 1,006 gas per MetadataUpdate, 1,262 batched, against touchRange measured
  at 23,899 total of which 21,000 is the base any transaction pays.
  THE ONE ITEM LEFT FOR PLAN 3: BatchMetadataUpdate takes a CONTIGUOUS RANGE
  but a day's check-ins touch a SCATTERED SUBSET, so the poke must choose
  between one over-claiming range and one MetadataUpdate per token (about 1M
  gas/day at 1,000 agents). touchRange already refuses the collection-wide
  catch-all. The reason the residual risk is small: the audience is AGENTS, who
  call tokenURI directly and never touch a marketplace cache.
- **BASESCAN IS NOT A METADATA CONSUMER on Base Sepolia** (measured 2026-08-30,
  `tools/basescan-check.mjs`). It ingests no tokenURI metadata for anyone there
  -- control was 0 of 8 tokens with artwork on each of two runs, across two
  distinct outside contracts -- so ERC-4906 is moot for it and **Alchemy was the
  only third-party metadata consumer this phase ever had.** Its page title is
  the contract's name() plus the id, which LOOKS like ingested metadata and is
  not; assert on the JSON `name`. Playwright chromium is at
  `~/.cache/ms-playwright` -- borrow it, never install one. Base Sepolia only;
  mainnet is untested.
- **The measurements behind that decision, kept for Plan 3.** What holds:
  MetadataUpdate(1)
  is on chain (blocks 46119616 and 46134224, correct topic), the EIP obliges
  nobody ("a third party CAN update"), and passive staleness of at least 8.2
  hours is confirmed. What is NEW: the dedicated refreshNftMetadata endpoint --
  the only variant reporting whether a refresh was accepted -- returns HTTP 400
  "This endpoint isn't enabled for that chain or network just yet". Base Sepolia
  is absent from its supported-network list. So the one outstanding action item
  is STRUCK OFF, not satisfied.
  The three reachable mechanisms each got 20 clean minutes against a verified
  gap (chain Level 200, cache Level 300): refreshCache=true alone,
  invalidateContract alone, and both in sequence ALL left timeLastUpdated
  unmoved. refreshCache=true DOES ingest a COLD token -- all 26 soak tokens carry
  distinct stamps set by tools/third-party-check.mjs:63 -- so the pipeline is not
  dead; only warm-entry invalidation fails.
  Exactly ONE re-read has ever been seen (12:38:35Z -> 20:49:07Z) and it is
  UNATTRIBUTED: the sequence fired one minute before it was later reproduced and
  did nothing. An 8.2-hour gap collecting an 8-hour-old change fits a slow
  internal re-crawl; Alchemy documents no cadence. tools/erc4906-passive-watch.mjs
  tests that by making no refresh requests at all.
  NEVER claim Alchemy ignores ERC-4906 -- nothing here tests it. Watch
  timeLastUpdated, not Level; tools/erc4906-retest.mjs carries the discriminator
  table. All of it is Base Sepolia, where the endpoint does not exist; mainnet
  has it. The design rule stands regardless: the piece must never DEPEND on an
  indexer refreshing, and the Plan 3 poke must VERIFY timeLastUpdated moved
  rather than fire and forget. Do not propose contract changes -- the gap is
  consumer-side.
- **The `rebind` trust boundary is DECIDED (the operator, 2026-08-30), not an oversight.**
  `rebind` accepts any `bytes32` with no proof of key possession, and it is the
  only token-owner-callable function that writes identity. Since `seed` keys its
  budget on the agent key, a token owner can point a whole token at another
  key's earned budget. ACCEPTED: `seed` is `onlyWarden` and the Warden re-checks
  the RFC 9421 signature against the CURRENT ON-CHAIN binding, so it needs that
  key's signature. Same trust boundary as mint, check-in and marks. Do not
  re-propose EIP-712 proof-of-possession (strands a token whose agent lost its
  key) or Warden-only rebind (a token could never be rebound if the Warden
  died). THE WARDEN'S REBIND RE-CHECK IS A SECURITY CONTROL: it must read the
  chain, never its own database.
- **THE SEVEN PRE-MAINNET CONTRACT FIXES ARE APPLIED** (2026-08-30, commit
  `b3d0282`). All were missing bounds on inputs the Warden supplies, which is
  why ten task-level reviews passed and only the whole-branch read caught them.
  Both check-in paths now reject `day > today()`; `mint` and `seed` reject ids
  above 2**32; `applyMark` gained an existence guard AND `whenNotPaused`;
  `setUpgrade` preserves `sold`; `mint` rejects a zero keyId; and
  `renounceOwnership` reverts. Detail in the plan1-prelaunch-fixes memory.
  **THE FIXED BUILD IS DEPLOYED AND VERIFIED** on Base Sepolia, and each guard
  was provoked on chain by `cast call` returning its exact selector, with the
  boundary control that matters: day = TODAY gives DayNotAdvanced while day =
  TOMORROW gives FutureDay, so the bound is exactly `> today()` and not off by
  one. The Renderer's bytecode is UNCHANGED by the fix wave, so the artwork
  pipeline is provably the one Phase 0 validated.
  The fix wave produced its own finding: **14 committed tests were crediting
  days the chain had not reached**, and only passed because the bound was
  absent. `MroTestBase` gained `_warpToDay(day)`; `_makeWhole` now advances the
  clock 364 days, and the seed-budget tests' arithmetic depends on that exact
  figure. Two items stay OPEN for Plan 3, neither a contract bug: `batchCheckIn`
  is ALL OR NOTHING (re-chunk with credited ids removed, never retry whole), and
  the Warden's rebind re-check is FRONT-RUNNABLE -- now pinned as an
  accepted-behaviour test in Lifecycle.t.sol so it is not re-audited as a
  defect.
- **The two untracked files are resolved (2026-08-30).**
  `contracts/script/MintOnePlan1.s.sol` is COMMITTED. `ZZReviewProbe.t.sol` was
  superseded by `contracts/test/Bounds.t.sol`, which inverts every probe to pin
  the fix, and then DELETED with the operator's approval. **The true count was 231 at that
  commit, not the 223 the old hazard quoted; it is 268 today.**
- **Coinbase Agentic Wallets cannot sign NFT trades** -- this rules out an
  otherwise obvious integration.
- **Distribution is the real risk, not the build.** Five of six early-2026
  agent mints had dead infrastructure within six months, and BLINK, the
  closest design, has 1 mint of 5,555. Velocity comes from timing, and the
  skills CLI (40M installs/month) beats both the MCP registry and llms.txt,
  which saw zero frontier-crawler fetches.

## References

- **Spec:** `docs/specs/2026-08-27-machine-readable-only-design.md`
- **Phase 0 plan:** `docs/plans/2026-08-27-mro-phase0-rendering-spike.md`
- **Comparable projects study:** `docs/2026-08-27-mro-comparable-projects.md`
- **Original brainstorming brief:** `docs/2026-08-27-machine-readable-only-brief.md`
- Origin: brainstormed on Claude Fable 5 from the move-to-vps hub, 2026-08-27

- Foundry book: <https://getfoundry.sh/>
- RFC 9421 HTTP Message Signatures: <https://www.rfc-editor.org/rfc/rfc9421.html>
- Web Bot Auth drafts: <https://datatracker.ietf.org/wg/webbotauth/documents/>
- x402: <https://www.x402.org/>
- Model Context Protocol: <https://modelcontextprotocol.io/>
- ERC-4906 metadata update extension: <https://eips.ethereum.org/EIPS/eip-4906>
- ERC-8257 Agent Tool Registry (Draft): <https://eips.ethereum.org/EIPS/eip-8257>
- ERC-8004 agent identity (Draft): <https://eips.ethereum.org/EIPS/eip-8004>
- ERC-8021 Builder Codes on Base:
  <https://blog.base.dev/builder-codes-and-erc-8021-fixing-onchain-attribution>
- MCP 2026-07-28 changelog (the deprecation list):
  <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- x402 Bazaar discovery extension: <https://docs.x402.org/extensions/bazaar>
- Cloudflare signed agents (the cohort that actually signs):
  <https://blog.cloudflare.com/signed-agents/>
- Base docs: <https://docs.base.org/>

---

@~/.claude/templates/common-sections.md
