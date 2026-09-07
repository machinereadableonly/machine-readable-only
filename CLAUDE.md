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
  WHAT IS LEFT FOR the operator: (1) **THE WARDEN IS DEPLOYED AND LIVE as of 2026-09-03
  at `https://machinereadableonly.com`** -- door, llms.txt, key directory and a
  real 401 challenge all verified through Cloudflare, Let's Encrypt cert to
  2026-12-02, PM2 `mro-warden` saved, port 3006 loopback-only plus `ufw deny`.
  A scoped `CLOUDFLARE_API_TOKEN_MRO` (one zone) IS now on the box, so Claude
  drives DNS. **THE CLOCK'S SYSTEMD TIMER IS INSTALLED AND ENABLED as of
  2026-09-03**, first fire 2026-09-04 00:05 UTC, with a smoke run proven clean
  (`Result=success`, a real reconcile off Base Sepolia, nothing written on the
  mint day). It needed `loginctl enable-linger` -- a precondition no document
  had recorded, without which the user manager dies at logout and the timer
  never fires -- and one unit fix (`623f9a5`): `ProtectKernelModules` cannot
  work in a user unit, because dropping a capability needs `CAP_SETPCAP`. The
  mirror now holds token 2, so `/t/2` returns 200; `/t/1` still 404s because
  token 1 was minted against a SCRATCH mirror and reconcile pages from a later
  block. See [[clock-timer-installed]] and [[warden-deployed]];
  (2) a real TREASURY_ADDRESS -- a placeholder is in use and
  refuses to start on any chain but Base Sepolia; (3) **settlement IS PROVEN as
  of 2026-09-03** -- token 2 was minted by paying 1 USDC through the live door
  and wears a bought Hush Mark; see [[settlement-proven]]; (4) the daily X post
  is deliberately unbuilt and needs X API credentials.
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
  **A SECOND PAYMENT BUG WAS FOUND AND FIXED 2026-09-04 (`53ed350`)** --
  `paid-but-unavailable` CHARGED THE AGENT for a refusal it was given nothing
  for. x402's `authorization` flow settles AFTER the handler returns and
  @x402/mcp cancels only on `result.isError`, which our plain `{ ok: false }`
  refusals never carried. Fixed once in the gateway
  (`cancelSettlementOnRefusal`), measured on Base Sepolia at 1.00 USDC before
  and 0.00 after with a successful mint still settling, and the agent-facing
  promise in `llms.txt` and the raw protocol doc -- both of which told agents to
  budget for losing the money -- is corrected. Read
  [[refusal-cancels-settlement]] before touching the paid path.
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
  **THE LADDER WAS FIRST DEPLOYED AND VERIFIED ON BASE SEPOLIA 2026-09-03**, on
  the pair that is now superseded. All ten Mark records read back correct off the
  chain and the three-argument `applyMark` (0xf542b20e) was present, so the
  mismatch that made every Mark unwritable was gone. **Both facts were
  re-established on the 2026-09-06 pair** -- ten records checked by value against
  the design document with `warden/tools/read-ladder.mjs`, which exits non-zero
  on a mismatch instead of being eyeballed.
  **A MARK HAS LANDED ON CHAIN, 2026-09-03** -- the first ever. Token 1 was
  minted (tx 0xef42b84a) and Hush applied (tx 0x307b6ac3, 62,332 gas); the
  chain reports marks 0x2 and the metadata reads `"Marks": ["hush"]`. Proven by
  `warden/tools/mark-rehearse.sh`, which runs the REAL Clock against a SCRATCH
  mirror -- never the Warden's own, because it seeds rows no agent paid for.
  WHAT THAT PROVES IS THE WRITE, NOT THE SALE. (Settlement was PROVEN later the
  same week -- see [[settlement-proven]] -- so that clause is historical.)
  That mint was on the SUPERSEDED pair. The 2026-09-06 redeploy repeated it on
  the new one: token 1 minted and Hush applied (tx 0xbcfa0be6, 62,700 gas), same
  scratch-mirror rule. The agent-facing copy, `llms.txt` and the skill all name
  the NEW address and were verified through Cloudflare after the restart.
  `DeployPlan5.s.sol` needed a fix to run at all: it called a bare
  `vm.startBroadcast()` with no sender, so forge refused AFTER the simulation
  passed (commit c62ce2d). Read the plan5-status, mark-ladder-spec
  and static-hue-decision memories BEFORE touching Marks.
  **PLAN 6 IS BUILT as of 2026-09-05 and NOTHING IS DEPLOYED** -- the four
  decisions a mainnet deploy makes permanent, the only 4 review findings that
  had a deadline. A missed day now costs ONE shade at once and
  then the lost run fades on the 3/7/30 ladder, so a token that comes back is
  never paler than one that stopped; the earned-Mark gate reads the LONGEST run
  ever completed, not the live streak; `MAX_MARK_ID` is 15 with ids 11-15
  unwritten; and `sunsetByAbsence()` lets anyone close the piece after 365 days
  without a Warden write, sealing each token at the colour it held when the
  writing stopped. `struct Token`'s spare `uint56` is now
  `uint16 fellRun; uint16 bestRun; uint24 fellDay;` -- an exact fit, so a
  check-in still costs about 5,000 gas.
  **REDEPLOYED 2026-09-06**: MachineReadableOnly
  0xe032054D54b407C52C49c40A423aC79031401C03 and Renderer
  0x48B6f41E0B8C4f38EBC67dfE57AeF18D553BC7f4, block 46,468,133, both
  Basescan-verified. That pair is ITSELF SUPERSEDED by the Plan 7 deploy of
  2026-09-07 (see below) and is kept here as the record of that day, not as an
  address to use. The pair before it (0xf0Df806f... / 0xb95D3229...) is
  SUPERSEDED too and keeps tokens 1 and 2 forever; do not read state off
  either. Token 1 on the 2026-09-06 pair was minted and wears Hush, and C4.10
  was proven on that deployed Renderer by asking it directly
  (`warden/tools/absence-on-chain.mjs`). See
  [[sepolia-redeploy-2026-09-06]]. Read
  [[plan6-permanent-decisions]] and [[review-triage-2026-09-05]] before touching
  the run, the palette or the endings.
  **SEVEN MORE REVIEW FINDINGS WERE CLOSED on 2026-09-05**, in three commits,
  all pushed. NONE of it is deployed except the first.
  **(1) THE TWO PAYMENT CRITICALS, `85a4784`, DEPLOYED.** A paid row is now a
  RESERVATION: it lands as `awaiting-payment` carrying the EIP-3009 nonce, and
  only `hooks.onAfterSettlement` promotes it to the `queued` the Clock reads, so
  a settlement that fails leaves no token and no spent mint. There is NO
  settlement-failure hook in @x402/mcp, so the gateway watches whether the
  success hook fired for its own nonce. 14.3: `keys.keyIdHash` now stores the
  on-chain form going FORWARDS (the chain's SHA-256 cannot be inverted), so a
  `Rebound` resolves; `upgrade` and `seed` read the binding live in BOTH
  directions. `checkin` STAYS ONE-SIDED by the operator's decision. Read
  [[payment-criticals-closed]] -- it carries the schema/migrate ordering rule
  that CRASH-LOOPED PRODUCTION during that deploy (`1cc4699`): nothing in
  schema.sql may reference a column migrate() adds.
  **(2) CDP AUTH AND THE DEPLOY BLOCK, `136b714`, NOT DEPLOYED.** `pay/cdp.mjs`
  mints the mainnet facilitator's Bearer token, hand-written, zero new deps; the
  Warden refuses to start if the facilitator is CDP's and the key is missing;
  the Clock checks `DEPLOY_BLOCK[chainId]` at STARTUP; DEPLOY.md gained the
  mainnet cutover section it never had. **THE CDP CREDENTIALS ON THE BOX ARE
  REFUSED** -- so is a token from Coinbase's own SDK -- so mainnet payment is
  impossible until the operator fixes the key in the CDP portal. CDP's PROSE DOCS ARE
  WRONG about the claim set; read [[cdp-facilitator-auth]] before touching it.
  **(3) THE CHECK-IN WEDGE, `c1aac40`, NOT DEPLOYED.** 15.2 + 16.1 + 4.H2 were
  one defect: a `batchCheckIn` that mines and is never marked. `BatchCheckedIn`
  carries NO token ids, so only the chain's STATE can heal it. Read
  [[checkin-recovery]].
  (2) and (3) were NOT deployed when they landed; they went live with the
  2026-09-05 restart below, so this no longer needs chasing.
  **EVERY CRITICAL AND HIGH FROM THE THREE REVIEWS IS NOW CLOSED (2026-09-05,
  third session), and ALL OF IT IS PUSHED AND DEPLOYED.** Five commits:
  `9a08b42` (the Clock key stops reaching argv; umask/chmod ordering),
  `39e1faa` (one signature admits once; the key directory is rendered per CHANGE
  behind an ETag; nginx limit_req in the template), `472b866` (an unused
  registered key is forgotten after 30 days -- the operator's decision, and told to agents
  in llms.txt and the protocol doc), `8d671af` (one payment authorisation buys
  one thing; every deploy script must STATE its chain; the leaked-key copy
  corrected plus a rotation runbook), `e3530f6` (`seed` stops promising a token
  it cannot write; the client and server move to the 2026-07-28 MCP leg and the
  legacy leg is REJECTED).
  **THE LIVE WARDEN IS THE TREE** -- verified after restart by serving the new
  llms.txt paragraphs, not assumed.
  **THE PUBLISHED WIRE CONTRACT CHANGED, TWICE.** `legacy: 'reject'` refuses an
  agent following the pre-2026-09-05 protocol document. Then 2026-09-06: the
  401 dropped `client` and gained `about`, every refusal carries `next`, and
  `/t/<id>` plus `status` carry `docs`/`mcp`/`contract`/`chainId`. Additive
  except the dropped `client`. Safe because nothing is invited yet.
  **THE CREATIVE TIER IS CLOSED TOO (2026-09-06), and so are the FIRST TWO
  PHASES of the Medium/Low tier. ALL PUSHED AND DEPLOYED.** Ten commits,
  `2542daa` to `903e1bf`. The creative work: the client's printed commands now
  run (C3.1-C3.5), the locked offer is SERVED, SKILL.md exists as the
  out-of-band channel for the treasury (C3.11), the Mark sheets are judged on
  the real-domain heart (C2.8), the door/arrival surfaces say what the piece is
  (C1.4-C1.6), every refusal carries a `next` (C3.7), and the heart/frame
  wording is corrected (C2.1, approved by the operator). Medium/Low phases 1-2: the three
  contract guards that stop being fixable at deploy, the access-control test
  gaps, and eight Clock failure modes.
  **PHASE 3 (door and payment) IS DONE TOO, 2026-09-06, DEPLOYED AND PUSHED** --
  all twelve findings, commits `c5dbb1f` to `a4dd8d3`. SupplyCap was the last
  contract gate answered from the mirror and is now read from the chain; the
  chain id is checked against the RPC at boot and the treasury must be EIP-55
  checksummed (both in `warden/src/chain/preflight.mjs`, because main.mjs
  cannot be imported); every paid refusal carries `isError`; the post-payment
  gate set is the full one; a one-hour negative directory cache that let ONE
  unauthenticated request lock an agent out for an hour is now 45 seconds; and
  `/mcp` has a per-key budget of 60 calls a minute.
  **THE PUBLISHED WIRE CONTRACT CHANGED AGAIN, twice**: signing for an
  authority that hosts no directory now answers `directory` rather than
  `unknown-key` (that reason was previously UNREACHABLE), and 429
  `rate-limited` is new. Both are documented in the protocol doc, `llms.txt`
  and the skill.
  **PHASE 4'S FINDINGS ARE DONE TOO, 2026-09-06, PUSHED AND NOT DEPLOYED** --
  all 51 quality Mediums and Lows, commits `9e2bec4` to `f536899`. The Years
  attribute counts past ten again (it was fed the ring cap, so an eleven-year
  token reported ten and the differential could not see it); `Signature-Agent`
  is read as the DICTIONARY the current draft requires as well as the legacy
  string; an aborted Clock run still reconciles; a Mark the chain refused reads
  `refused` rather than `held`; the CLI exits non-zero on a refusal and its
  cron line is pinned to UTC; `status` says when the next window opens and when
  the run breaks; and `mro://contract` serves the ABI and the catalogue.
  **ALL 46 TEST GAPS ARE CLOSED as of 2026-09-06 (`8a4de62` to `94d10cd`),
  PUSHED AND DEPLOYED** -- which also brought Phase 4 live. Twelve were already
  closed and were verified one by one rather than re-fixed. Gap 39 found a REAL
  DEFECT in the paid path: `upgrade` and `seed` refused an unrecognised caller
  on the STALE MIRROR without ever reading the chain, so an agent whose
  `rebind` had landed but not reconciled was refused for up to a day on the two
  paths where it spends money. It had been PINNED AS CORRECT by an existing
  test. `checkin` had asked the chain since 14.3; those two now do too.
  Gap 34 was NOT a test gap and stayed open: it wanted tests on `seed`'s Clock
  write path, which 4.H1 recorded as an unbuilt FEATURE. **It is CLOSED as of
  2026-09-07** -- Plan 7 built that write path and `warden/test/clock-seed.test.mjs`
  covers it.
  **THE LIVE WARDEN IS THE TREE** (`94d10cd`), verified through Cloudflare by
  serving `/t/2` with `nextWindowOpensAt`, `streakDeadline` and `children` --
  three fields the Phase 3 build did not have.
  **WHAT REMAINS: the operator's five launch items C4.4-C4.8**, plus the standing
  blockers below. The reviews themselves are DONE. The real finding count was
  184 (security 67, quality 74, creative 43) -- the "158" in older notes
  reconciles against nothing.
  **THE LAST FOUR CREATIVE ITEMS CLAUDE COULD DO ALONE ARE DONE (2026-09-06),
  PUSHED AND DEPLOYED.** `594e1a2` closed the three copy findings: llms.txt says
  why the entry rule exists, door.html drops "RFC 9421, Web Bot Auth" for a
  human relay who reads those words as bot protection, and a new
  "What we commit to" section serves FOUR commitments. C4.9 asked for a FIFTH,
  "the verifier is open source" -- OMITTED by the operator's decision, because the repo is
  private and C4.4 is undecided, so serving it would publish a false
  commitment. Add it the day C4.4 lands, and read
  [[check-the-finding-before-fixing-it]] before implementing any copy finding
  verbatim. `32a861f` closed C2.7: the Mark forfeit is named BEFORE it is taken
  (`closes` on every open side, `closed` on both accepted `upgrade` responses,
  `price: "free"` on earned sides, and the tool retitled "Take a Mark").
  **THE WIRE CHANGED ADDITIVELY AGAIN** and is documented in the protocol doc,
  llms.txt and SKILL.md. **NOTHING CREATIVE IS LEFT THAT CLAUDE CAN DO ALONE:**
  six ANYTIME items remain and all six need the operator (C2.3-C2.6 want rendered sheets
  and his eye; C4.11 and C4.12 are credential-blocked).
  **16.10 IS RE-DERIVED AND CLOSED (2026-09-06, `c742412`), NOT DEPLOYED** --
  three of its four claims were wrong, including the only function it named and
  the only fix it proposed. Measured on viem 2.56.0: `err.message` ALWAYS
  carries the endpoint url and `err.shortMessage` never does, so the two Clock
  sinks that logged `err.message` are now redacted, the log is 600 with
  `UMask=0077`, and logrotate runs from the Clock's own `ExecStartPre` with
  copytruncate. The Warden needed nothing and no agent was ever exposed.
  **THE INSTALLER RAN AND ALL SIX CHECKS PASSED (the operator, 2026-09-06)**, so this is
  INSTALLED, not pending; the timer is armed for 2026-09-07 00:05 UTC, the
  first run on the redacted code. Read [[rpc-url-in-logs]].
  **THE NGINX RATE LIMITS ARE NOT LIVE**: the template has them, the installed
  vhost was written from the old one, and applying them needs sudo. The
  application-level limiter added in Phase 3 is a different thing and IS live.
  Read [[rpc-url-in-logs]], [[test-gaps-closed]], [[phase4-quality-findings]],
  [[check-the-finding-before-fixing-it]],
  [[phase3-door-and-payment]], [[review-medium-low-2026-09-06]],
  [[creative-closeout-2026-09-05]], [[security-quality-closeout-2026-09-05]]
  and [[door-replay-and-key-argv]] before touching the door, the payment path,
  the Clock or a deploy script.
  **Rehearse every deploy** with `warden/tools/rehearse-start.sh`: it runs the
  real `main.mjs` against a COPY of production state, which is the only thing
  that can catch a bad boot check.
  **Suites: contracts 335, warden 568, tools 76, client 40** (2026-09-06).
  **PLAN 7 (lineage / the Echo) IS BUILT, REVIEWED AND PUSHED as of 2026-09-07**
  -- `5707b17..147ec26`, 30 commits, main level with origin. A token that has run
  a full year seeds a child, free; the child starts at level 1 and carries the
  line's tenure as a sealed number, the Echo, drawn as ONE DASHED innermost ring.
  Suites: **contracts 362, warden 652, tools 86, client 40.**
  **DEPLOYED, ADOPTED AND LIVE as of 2026-09-07**: MachineReadableOnly
  **0x3E8A9D50C69c206df741A8d5BB78E66070A53020** and Renderer
  **0x95F5153787BbF6Df007719d9f1972382353122Cb**, block **46,517,330**, all
  twelve transactions in that one block, both Basescan-verified. The
  2026-09-06 pair (0xe032054D... / 0x48B6f41E...) is SUPERSEDED and keeps its
  token 1 forever; do not read state off it. The Warden was restarted onto the
  new pair and VERIFIED THROUGH CLOUDFLARE, not assumed: llms.txt serves the new
  address, the old one is gone, and the false "Not built yet" for `seed` is gone
  with it -- the live site now documents lineage and the Echo.
  Proven before the restart, in this order: `check-deployed-abi.mjs` (55 of 55
  selectors, `seed` and `echoOf` present, `viewOf` decoding 18 fields),
  `read-ladder.mjs` (all ten Marks correct by value), then a rehearsal against a
  COPY of production state. The rehearsal was run TWICE: once with
  `REHEARSE_OVERRIDE` to prove the new pair boots, and once WITHOUT it, which is
  what proved the environment file had actually been changed -- a value-free way
  to check a file Claude must not read.
  `adopt-deployment.sh` REWROTE A HISTORICAL PARAGRAPH in this file (the
  2026-09-06 record, which it left naming the 2026-09-07 pair at the old block).
  Its own comments say historical records must not be rewritten, but CLAUDE.md
  holds live statements and history in one file and a blanket `sed` cannot tell
  them apart. Restored by hand. **Check this file's history paragraphs after
  every future adoption.**
  Read the plan7-lineage-echo and the-index-that-blocked-lineage memories first.
- **Secrets:** `contracts/.env` only, chmod 600, never committed -- the operator edits
  it via WinSCP. Claude never reads it. `.env.example` holds the schema.
- **Environment:** VPS
- **Port:** 3006, the Warden, registered in
  `~/.claude/templates/port-allocation.md` on 2026-08-30. Bound to 127.0.0.1
  only; public traffic arrives through nginx. **The Warden IS deployed and live**
  at `https://machinereadableonly.com` (since 2026-09-03); the "nothing is
  deployed yet" that stood here was left over from before that.

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

- **Domain:** `machinereadableonly.com`, DECIDED and REGISTERED 2026-09-03.
  Cloudflare Registrar, 1 year with auto-renew, expires 2027-09-03, registrar
  lock on, nameservers already Cloudflare. `.com` was chosen as a DURABILITY
  decision, not a branding one: ICANN caps any registration at ten years, so
  permanence is the sum of renewals, and a new gTLD can be removed from the root
  zone if its registry fails (EBERO is explicitly temporary). A lapse is worse
  than a dead link -- the QR embeds the url in the artwork permanently, so
  whoever registers the name next controls what a minted token points at. A
  ten-year term was recommended and the operator chose one year plus auto-renew; extending
  is possible at any time. `agentsonly` / `onlyagents` were considered and
  REJECTED (a live AI company holds `agentsonly.com`; the names describe the
  door, not the artwork). Full record and the measured artwork cost:
  `docs/2026-09-03-mro-domain-decision.md`. Do not re-open the name.
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

- **Child token visuals and the lineage narrative are SETTLED and BUILT
  (Plan 7, 2026-09-06/07). This is no longer an open question.** A child
  carries a sealed `echo` -- the days its line had already run when it was
  seeded -- drawn as one dashed ring, the innermost of the token's rings, just
  outside the day frame. The record is
  `docs/specs/2026-09-06-mro-lineage-design.md`; master spec section 10 points
  at it. `seed` writes a real child through the Clock's fourth pass.
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
  **RE-MEASURED 2026-09-07 FOR THE ECHO RING (Plan 7). BOTH WORST CASES ARE NOW
  CHILDREN, which is new** -- a seeded child draws one dashed ring a founding
  token never has, so it is dearer and larger than any founding token can be.
  A reader who assumes a founding token is the worst case will mis-predict
  every future measurement. Do not quote the Plan 6 pairs (1,750,744 / 10,651
  and 1,680,468 / 11,550); they are superseded.
  THREE worst-case figures exist and ALL THREE are correct -- do not treat any
  of them as a stale version of another. They measure DIFFERENT TOKENS.
  (1) **1,633,224 gas / 8,924 bytes** is soak token 21 read over RPC, the number
  for what a real provider returns. It PREDATES Plan 5 AND Plan 7, and nothing
  has re-measured that path since the ladder was drawn.
  (2) **1,889,279 gas, and 11,682 bytes on that same token** is the GAS worst
  case in Foundry: **a CHILD at day 364 wearing FOUR Marks** (four, not five --
  pair 4 is shut below a whole heart, so five is not legal at day 364).
  **Gas margin 110,721** of 2,000,000. That is
  `test_theDearestTokenAloneInAFreshCall`, measured COLD and the headline
  figure. `GAS_BAND` instead guards `worstGas`, the same token measured WARM
  through the ladder at **1,884,779** -- about 4,500 lower because the shared
  renderer's account and SLOAD are already warm. Both are correct; say which
  one you mean.
  (3) **12,546 bytes, and 1,811,979 gas on that same token** is the BYTE worst
  case in Foundry: **a CHILD at the ring cap wearing FIVE Marks**. This is
  `maxBytes`, and the byte margin is 20,000 - 12,546 = **7,454**, not the 8,318
  you get by subtracting the gas worst case's byte count.
  THE DEAREST TOKEN AND THE LARGEST TOKEN ARE NOT THE SAME TOKEN --
  `GasBudget.t.sol` says so and the test prints each headroom against
  its own worst case. Pairing one token's gas with another's bytes is the exact
  mistake that was in this file until 2026-09-02. (1) differs from (2) and (3)
  because a bitmap encodes its own url, so every token has its own run
  structure.
  For comparison, the FOUNDING-token worst cases: **1,735,469 gas** (day 364,
  max Marks) and **11,582 bytes** (the ring cap, max Marks). **These MOVED in
  Plan 7 and are not the Plan 6 figures** -- gas from 1,750,744 and bytes from
  11,550. A founding token draws no echo ring, but it still pays the echo
  SLOAD on every `tokenURI` and still carries the `Echo` attribute in its
  metadata, so neither number could stay put; the gas also absorbs Task 3's
  measurement-harness fix. What is unchanged by the echo RING, and by the
  dot-to-dash revision, is every founding figure relative to the rest of Plan 7.
  The ring itself costs **145,533 gas / 1,007 bytes** and the echo SLOAD
  **2,183 gas** on every token including founding ones.
  "Every Mark at once" is no longer a state any token can reach:
  the five exclusive pairs cap a token at five Marks, and the maximal LEGAL set
  is Hush + Beat + the bought Iris in leaf + Vessel + Tint. Do not quote the
  retired seven-Mark figures.
- **EVERY QR BITMAP MUST BE RE-SOLVED against `machinereadableonly.com` before
  any mainnet mint.** A bitmap encodes its own url, so nothing solved against
  the `example.com` placeholder carries over -- including every Base Sepolia
  token minted so far, which stay as they are because they are testnet. The real
  payload is `https://machinereadableonly.com/t/<id>#`, 36 characters at id 1,
  because it carries the scheme AND a trailing `#`. MEASURED 2026-09-03: the
  heart costs **2.13 points** (64.9 / 63.9 / 63.3 falling to 61.9 / 62.2 / 61.6
  on ids 1, 12, 55), which is about TWICE what phase0-results.md's 0.065-points-
  per-character slope predicts. That slope came from a 9-character increase and
  does NOT hold linearly to 12; do not quote it as a general figure. Robustness
  did not degrade -- all three passed the decode gate on the first-choice mask
  with zero rejections, against two of five needing a fallback under
  `example.com`. Rendered comparison:
  `tools/out/domain-compare/compare-whole.png`.
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
