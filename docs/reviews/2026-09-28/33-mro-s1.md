# Machine Readable Only -- security -- contracts and permanent bytecode

**Snapshot:** 8d2a0d27e3
**Read:** `contracts/src/MachineReadableOnly.sol` (all), `contracts/src/Ladder.sol`, `contracts/src/spike/MROSpikeToken.sol`, `contracts/src/render/Renderer.sol`, `CodeRenderer.sol` (20-98), `FrameRenderer.sol` (32-67, 95-286), `PathWriter.sol` (20-134), plus a grep of `MarkRenderer.sol` for the bit decoders; `contracts/test/AccessControlGaps.t.sol`, `ContractSize.t.sol`, `Vouchers.t.sol`, `MachineReadableOnly.t.sol` (40-288), `Lifecycle.t.sol` (20-149), and every `expectRevert` / dial call across `contracts/test/`; `.claude/rules/contracts.md`; the threat model; the Slither leads. I also read a few Warden and Clock files, only to check whether a contract behaviour can be reached: `warden/src/clock/run.mjs` (100-520, 933-935), `clock/batch.mjs` (1-140), `clock/write.mjs` (84-213), `clock/reconcile.mjs` (event handling), `mirror/queries.mjs` (mint/seed statements), `mcp/tools/seed.mjs`, and `docs/specs/2026-09-20-mro-finisher-marks-design.md` (190-250). I built nothing and ran no tests.

## Findings

### [HIGH] `seed` charges whichever key is bound when the Clock writes, not the key that asked -- one agent can spend other agents' yearly seeds, again and again **[BLOCKS MAINNET]**

**Where:** `contracts/src/MachineReadableOnly.sol:839-884` (key read at `:857`, budget checked at `:854` via `seedsAvailable` `:826-833`, charged at `:875`); `rebind` at `:793-800`. For reachability: `warden/src/clock/run.mjs:440-451` sends `seed` with no key argument, and `warden/src/mcp/tools/seed.mjs:53-58,103-107` checks the binding and budget only when the request is made.

**Attacker story:** The attacker is the owner of a whole token P, bound to their key KA, which has one seed available.
1. The attacker calls the `seed` tool, signed by KA. Every gate passes and a child is reserved (`seed.mjs:144-151`).
2. Before 00:05 UTC, the owner wallet calls `rebind(P, KB)` directly on chain. KB is any victim key whose seed budget is open. Every key is readable on chain through `viewOf(id).agentKeyId`, and in year two that covers every year-one minter that has not seeded yet.
3. At 00:05 the Clock calls `seed(child, P, to, code, day)`. The contract reads `_agentKeyOf[P] == KB`, sees KB has a seed, marks KB's seed as spent (`_seedsSpent[KB] += 1`) and gives the child KB.
4. The attacker rebinds P, and the child, back to KA.

KA's on-chain budget was never touched and the reservation row is now "written". So the next day the Warden's budget check (`seedBudgetBlock`: chain `seedsAvailable(P)` minus unwritten reservations) passes again, and the attacker repeats with a new victim.

- **Gain:** one free token per day, for as long as victim keys have budget. Each child also uses up `supplyCap`, which moves toward blocking paid mints for everyone.
- **Victim's loss:** each victim loses its once-a-year seed for good. Their own later request is refused `NoSeedAvailable`.
- **The same thing without malice:** a seller asks for a seed, sells P, and the buyer rebinds. The buyer's seed is spent and the child goes to the seller's `to`.
- **Preconditions:** a whole token with its own budget open (year two onward), plus two `rebind` transactions per theft.

**Why it works:** The settled `rebind` decision rests on the premise that "the Warden re-checks the signature against the current on-chain binding". That premise is false for `seed` as built. The Warden checks at request time, but the contract reads the binding at write time, up to about 24 hours later, and neither the Clock nor `seed` compares the two. I am not re-opening `rebind`. The gap is between checking and using.

**Fix:** Add `bytes32 expectedKeyId` to `seed` and revert (for example `KeyMismatch`) when `_agentKeyOf[parentId] != expectedKeyId`. Have the Clock pass the reservation's `keyId` (already stored by `insertSeed`), and add `KeyMismatch` to `isFinalSeed` so the row is dropped. A Clock-only re-read before sending still leaves a window of a few seconds at a predictable 00:05. The atomic check has to live in the bytecode, and the redeploy before token #1 is the only chance to add it. Add a test: request, rebind, then write must revert.

### [MEDIUM] When vouchers are on, finishing places go to whoever submits first, which breaks the published "(day, lowest token id)" rule

**Where:** `MachineReadableOnly.sol:581-610` (anyone may submit, from the start of day `day`), `_credit` `:442`, `_finish` `:468-475`. The NatSpec at `:462-465` says places are given "across days by day". Published rule: `docs/specs/2026-09-20-mro-finisher-marks-design.md:211-214`, applied in `warden/src/clock/batch.mjs:44-55`.

**Attacker story:** The attacker holds a token at level 364 and a Warden-signed voucher for its finishing day D. This needs the owner to have called `setVouchersEnabled(true)` and the Warden to be signing vouchers.
1. They submit `checkInWithVoucher` at 00:00:01 on day D. `_finish` runs at once and `++finishers` gives them the next ordinal.
2. Every token that finished on day D-1 is still waiting in the Clock's batch, which lands at 00:05 on day D. Every lower-id token that finishes on day D lands at 00:05 on D+1. The attacker places ahead of all of them.

With the first cohort, that is Apex (unique, gold) or a capped band that is permanent in the image. In a voucher-only mode where the Clock no longer batches, every place becomes a submission-latency race. The spec rejects exactly that at `:216-221`.

**Why it works:** The place is the transaction order of `++finishers`, and the voucher path is a second writer that is not bound by the Clock's sort. The contract does not record or enforce the finishing day.

**Fix:** Decide this before the redeploy, because the voucher path cannot be changed afterwards. The simplest on-chain option: in `checkInWithVoucher`, refuse the credit that would finish a token (`s.level + 1 == FINISH_LEVEL`) while the Warden is live (for example `today() - lastWardenDay < N`), so that while the Clock runs, only the Clock gives places. If places on the voucher path are accepted as first-come, write that into the spec and fix the NatSpec at `:462-465`. Either way the Warden should never sign a finishing-day voucher while the Clock is running.

### [LOW] A pause, or any Clock outage, longer than 30 days leaves every paid-but-unwritten mint stuck

**Where:** `MachineReadableOnly.sol:342-347` (`whenNotPaused`), `:397`, `:401-405`; the Clock's response is at `warden/src/clock/run.mjs:357-362`.

**Attacker story:** No outsider is needed. The owner pauses, or the Clock stops, for more than `MAX_CREATION_LAG` days. Each queued mint carries the day it was paid, and after 30 days that day is refused `StaleDay` on every later run. Agents who paid 1 USDC get nothing until a human re-dates the row, and a re-dated mint loses its first-day credit.

**Why it works:** The 30-day bound on backdating is permanent, and `pause` stops `mint` but not the clock that ages each row.

**Fix:** No contract change is needed. Write in the runbook that a pause over about 25 days must first drain the mint queue, or re-date stuck rows to `today() - 30` (allowed at `:404`). Put the 30-day limit next to `pause()` in the NatSpec.

### [LOW] `mint` and `seed` hand control to the recipient's own contract (`_safeMint`)

**Where:** `MachineReadableOnly.sol:378`, `:881`; Clock handling at `run.mjs:393-404`, `:933-935`; `write.mjs:203-207`.

**Attacker story:** An agent pays 1 USDC with `to` set to a contract whose `onERC721Received` behaves differently in `eth_call` than when mined. For example it reads `block.basefee` or keys off `block.number`. It passes the Warden's pre-payment check, the simulate and the estimate, then reverts on chain. `reverted-on-chain` is not treated as run-level, so the run continues. But the row stays queued, and the Clock pays for one reverted transaction (up to `MAX_TX_GAS`) every night until `StaleDay`, about 30 nights. Each extra key costs another 1 USDC. The effect is gas griefing only: state is written before the callback (CEI holds), and no warden function can be re-entered by the recipient.

**Fix:** Use `_mint` in both functions. The Warden already refuses recipients that cannot hold an ERC-721 before taking payment (`chain/read.mjs canReceiveERC721`), so the callback adds risk without adding protection. If `_safeMint` stays, have the Clock park a mint row after one `reverted-on-chain`.

### [LOW] A Warden key can backdate the first tokens to before the contract existed, giving a 30-day head start to Apex

**Where:** `MachineReadableOnly.sol:401-405` (no lower bound other than `today() - 30`), constructor `:171-183`; also `_firstMintDay` at `:372`, which drives the seed budget.

**Attacker story:** Someone holding the Clock key (the threat model's risk #1: the Warden and Clock share a user and an env file) mints on launch day L with `day = L-30`. They then back-fill 30 days in one `batchCheckIn`, reach level 365 on L+334, and take Apex, and whichever capped places they want, 30 days before any honest token can finish. The token's `mintDay` and `_firstMintDay` also predate the collection, so its seed budget opens early too.

**Fix:** Record `uint32 immutable DEPLOY_DAY = today()` in the constructor and refuse `day < DEPLOY_DAY` in `_checkCreationDay`. This costs nothing and closes the only moment when the 30-day lag decides a place. It does not limit a compromised Warden in any other way.

### [INFO] The wallet cap does not limit an actor

**Where:** `MachineReadableOnly.sol:82`, `:357`, `:852`.

`mintedTo` counts only mints and seeds sent directly to an address. A fresh `to` per mint gets around it, and so does receiving tokens by transfer, which is never counted. Keys are free, so one actor can hold any number of tokens. It works as a per-address courtesy limit. If a per-actor limit was intended, no on-chain design here provides one. Documenting it is enough.

### [INFO] Test gaps against the project's own rule ("every access-control revert gets one")

- **Ownable2Step failure paths are untested.** Only the success path is covered (`MachineReadableOnly.t.sol:166-173`, `Bounds.t.sol:216-219`). There is no test that `acceptOwnership` from a non-pending account reverts `OwnableUnauthorizedAccount`, that `transferOwnership` from a non-owner reverts, or that a second `transferOwnership` replaces the pending owner.
- **Non-owner tests that still accept any revert:**
  - `setRenderer` -- `MachineReadableOnly.t.sol:55-59`
  - `setWarden` -- `:68-72`
  - `setSupplyCap(1)` -- `:81-85`
  - `unpause` -- `:133-140`
  - `setUpgrade` -- `Marks.t.sol:112-114`
  - `setVouchersEnabled` -- `Vouchers.t.sol:127-131`

  `AccessControlGaps.t.sol:142-157` says it fixed "nine non-owner tests" but names the selector for only three (plus the oversized `setSupplyCap` at `MachineReadableOnly.t.sol:106-110`).
- **Only transfer is tested as working while paused** (`:281-287`). No test asserts that `rest` and `rebind` also still work while paused (TM section 4 lists them as not pausable).
- **No test covers the two ordering and binding findings above:** request, rebind, then seed; and a voucher finish racing the batch.

### [INFO] A comment in the spike contradicts the real contract

`contracts/src/spike/MROSpikeToken.sol:209-212` says "The real contract emits over the ids it actually minted" on sunset. The real `sunset()` emits no metadata event at all (`MachineReadableOnly.sol:269-278`). The spike is not a mainnet artefact, but the project treats a comment that contradicts the code as a finding.

## Questions

1. **Earned Marks and binding drift.** `applyMark` (`:700-761`) takes no key and no owner. A seller who controls the key can queue a free earned Mark shortly before a sale. It lands after the sale and permanently shuts the paired bought Mark on the buyer's token (for example Break shuts Vessel). Is that accepted? An `expectedKeyId` argument here would also make a legitimate key rotation lose a paid Mark, so this is a trade-off, unlike `seed`.
2. **The voucher trigger.** Does the Warden intend to sign vouchers while the Clock is still running, or only after it stops? Finding 2's fix depends on the answer. I found no voucher-signing code in `warden/src`.
3. **Leaving `supplyCap` able to go below `totalMinted`, and `walletCap` unbounded (`:246-255`).** Is that deliberate? It is owner-only, and both simply stop creation.

## Out of scope

- Owner-key custody, and the hot `MAINNET_DEPLOYER_KEY` / manual Ownable2Step handover in `deploy-mainnet.sh`: deploy pipeline area.
- Clock heal and bisect correctness (I read it only to confirm that a `rest()` racing the batch is handled per entry: `Resting` is a named entry error at `batch.mjs:32-39`, so it costs at most one reverted chunk), the x402 and settlement oracle, and the door.
- Settled items I checked and did not re-raise:
  - `heartbeat` is not `whenNotPaused`.
  - `rebind` has no proof of possession (only its interaction with `seed` is raised).
  - The ERC-4906 choices, the renderer swap, the 4M / 24 KB budget.
  - Vouchers ship off.

## Coverage

- **Access control:** Every external function in `MachineReadableOnly.sol` was checked for its modifier. `onlyOwner`: all dials, `pause`/`unpause`, `sunset`, `setUpgrade`, `setVouchersEnabled`. `onlyWarden` (which also stamps `lastWardenDay`): `mint`, `batchCheckIn`, `applyMark`, `seed`, `heartbeat`. `onlyTokenOwner`: `rebind`, `rest`. Open to anyone: `checkInWithVoucher` (signature-gated) and `sunsetByAbsence`. Renounce is disabled, and `transferOwnership(0)` cannot be accepted, so ownership cannot be abandoned.
- **Irreversibility:** `rest` and `sunset` / `sunsetByAbsence` have no path that clears them. `sunsetByAbsence` cannot underflow (`lastWardenDay <= today()`).
- **Pause gate:** it covers `mint`, `batchCheckIn`, `checkInWithVoucher`, `applyMark` and `seed`, and not `heartbeat`, `rebind`, `rest` or transfers, which matches the threat model.
- **Mark bit packing:** Marks sit in bits 1-15, Iris shape in 16-23 (variant < 3), Tint ink in 24-31 (< 2), Iris run in 32-63, ordinal in 64-95. The exclusion masks are `uint16`, so they only ever read bits 0-15. Bit 0 is never set. Ids 11-15 are refused at `:712`, and a token finishes at most once (`:419`). The ordinal is capped at 65,535 through `supplyCap` (`:247`). I found no overlap or aliasing.
- **Reentrancy:** the contract moves no ETH and no tokens. The only outward calls are the `_safeMint` callback (after all state is written), the `SignatureChecker` staticcall, and the renderer staticcall inside a view. Nothing exploitable.
- **Renderer:** every string written into JSON or SVG is a number, a constant, or hex of the key, so there is no injection. The assembly reads (`_rowBits`, `_localRow`, `_fill`) stay within the fixed 407-byte code and constant tables. Coordinates stay under the 1000 limit because the canvas is at most 57 cells.
- **Slither triage (all 36 results):**
  - `encode-packed-collision`: dismissed -- strings are built, never hashed.
  - `divide-before-multiply` on `MAX_RUNS`: dismissed -- an intentional ceiling on a constant.
  - `incorrect-equality` on `seedsAvailable == 0`: dismissed -- the function floors at 0.
  - `uninitialized-local` `out` at `FrameRenderer.sol:177`: dismissed -- an intentionally empty `bytes`.
  - `unused-return` in `_eyes`: dismissed -- only the base ink is needed.
  - `timestamp`: dismissed -- day indices are the design, and the sequencer's leeway is seconds.
  - `assembly`: reviewed as above; no issue.
  - `costly-loop` on `++finishers`: dismissed -- it runs once per finishing token.
  - `dead-code` on `pxPerCell`: false positive -- it is used at `Renderer.sol:337` and overridden in `RendererUnsized`.
  - `too-many-digits`: dismissed -- generated constants.
  - `unindexed-event-address`: Info only.

  The wrapper's "build FAILED 255" came after Slither had printed all its results, so I treated them as complete.
- **Size and deployability:** `ContractSize.t.sol` measures the Renderer, the spike and the real contract against 24,576 bytes. The anvil half (`script/anvil-size-check.sh`) was not read or run.
