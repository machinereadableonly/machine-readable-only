---
paths:
  - "contracts/**"
---

# Solidity and contract rules

Loaded only when working under `contracts/`. The unrecoverable rules -- Base
mainnet is permanent, never spend real funds without the operator's approval -- are in
CLAUDE.md and are NOT repeated here.

## Deployability is a gate, not a nicety

**Every contract must be proven deployable before it is called done:**
`forge build --sizes` showing POSITIVE runtime margin under 24,576 bytes, AND a
strict-limit anvil deploy (plain `anvil`, NOT `--disable-code-size-limit`) with a
non-empty `cast code`. `test/ContractSize.t.sol` fails the suite otherwise.

**`forge test` runs with EIP-170 DISABLED**, so a contract too big to deploy
still passes every test. base-200's SeasonFactory hit 42,923 bytes and passed 179
tests and 3 reviews. Factories that `new` their children inline are the classic
trap -- prefer clone/proxy (EIP-1167).

## Testing

- **Every owner / emergency / admin function gets an explicit test**, and every
  access-control revert gets one: wrong caller, `onlyOwner`, `OnlyVm`,
  provider/requestId mismatch, paused-state reverts.
- **`vm.expectRevert` matches the NEXT call.** Putting setup between it and the
  call under test asserts against the wrong thing.
- **Never measure gas around harness setup** -- it read 10x high once
  (54,445,957 against a true 5,652,973).
- A test that credits a day the chain has not reached passes only while the
  bound is missing. `MroTestBase._warpToDay(day)` exists for this; `_makeWhole`
  advances exactly 364 days and the seed-budget arithmetic depends on that.
- Follow CEI, and prefer per-entity reentrancy state over one global guard
  wherever funds move.
- Keep NatSpec in sync with enforced behaviour. A comment that contradicts the
  code is a finding.

## The gas and byte budget

Hard limits **4,000,000 gas / 24,000 bytes**; the 1M / 5 KB target is MISSED and
must always be reported as missed.

**THE BYTE LIMIT WAS RAISED FROM 20,000 ON 2026-09-22, by the operator.** The
20,000 was CHOSEN, not derived -- a Phase 0 pass criterion justified as "bytes
are what every viewer downloads". Measured at QR version 10: the dearest token
2,867,756 gas, the largest 18,246 bytes, leaving 1,754 against a finisher's
digit band measured at 3,360. A number nobody derived was about to decide a
design question.

**THE ONE REAL EXTERNAL CEILING IS 30,000 BYTES.** Alchemy's NFT API docs:
"This can also happen if the content length of the response is larger than
30 000 bytes." Alchemy is the ONLY third-party metadata consumer this piece has
ever had working -- Basescan ingests none on Base Sepolia, OpenSea is untested.
24,000 fits version 10 plus the digit band and leaves 6,000 under that ceiling.

**UNTESTED, AND IT MUST BE SAID THAT WAY.** Alchemy's sentence sits among
reasons an HTTP-hosted metadata URL fails to FETCH; this tokenURI is a data URI
and nothing is fetched. **GATE BEFORE THE MAINNET MINT: run
`tools/alchemy-nft.mjs` against a real Sepolia token and confirm a ~22,000-byte
data URI ingests.** Never state the cap applies, or does not, until that runs.

Gas is not the constraint: Base's own guidance puts the practical `tokenURI`
ceiling near 300M read gas, and this token spends 2.87M.

**THE GAS LIMIT WAS RAISED TWICE ON 2026-09-21, by the operator, on
measurement: 2,000,000 to 3,000,000 from a component estimate, then to
4,000,000 once version 10 was built and measured.** It was never a protocol rule: `tokenURI` is a READ that nobody
pays for, and a node will execute around 50M for one `eth_call`. The 2,000,000
was set at roughly the Uniswap V3 line from a survey where Anonymice runs at
24M and Terraforms at 28M, and what it bought was compatibility with strict
providers -- real, unmeasurable, and the reason the new figure moves only to 3M.
**THE BYTE LIMIT DID NOT MOVE**, because bytes are what every viewer downloads
and 20,000 is never threatened. See `GasBudget.t.sol` for the full reasoning.

**THERE IS NO SINGLE WORST CASE, and both worst cases are CHILDREN since Plan 7.**
The dearest token and the largest token are DIFFERENT TOKENS, and pairing one's
gas with the other's bytes is a number describing nothing. `GasBudget.t.sol`
prints each headroom against its own worst case.

**TWO FILES MEASURE THIS, and only one of them measures the contract that
ships.** `GasBudget.t.sol` sweeps twelve life stages on `MROSpikeToken`, whose
`setState` places any stage in one call -- right for comparing stages, wrong for
a published figure. `RealTokenGas.t.sol` builds real tokens the only way a real
one can be built (mint, check in, apply Marks, seed) on
`MachineReadableOnly` itself. The shipping contract is DEARER, measured
2026-09-18: 1,890,021 gas against the spike's 1,884,779 for the same dearest
case, because the real `viewOf` also reads `sunsetDay`, `fellRun` and `fellDay`.
**Quote the REAL file for any published number.**

**Do not quote a gas figure from memory -- run `forge test --match-path
test/RealTokenGas.t.sol -vv` (and `test/GasBudget.t.sol -vv` for the stage
sweep) and read it.** The `gas-budget` memory file carries the current figures
and the reasons all three coexist.

## Decided, do not re-propose

- **The `rebind` trust boundary is DECIDED** (the operator, 2026-08-30). `rebind` takes any
  `bytes32` with no proof of key possession. Accepted, because `seed` is
  `onlyWarden` and the Warden re-checks the RFC 9421 signature against the
  CURRENT ON-CHAIN binding. Do NOT re-propose EIP-712 proof-of-possession (it
  strands a token whose agent lost its key) or Warden-only rebind (a token could
  never be rebound if the Warden died).
- **ERC-4906 is CLOSED BY DECISION** (the operator, 2026-08-30): keep emitting it, accept
  that a consumer ignoring it is outside this project's control. `touchRange`
  already refuses the collection-wide catch-all. Do not propose contract changes
  for it -- the gap is consumer-side.
- The seven pre-mainnet bounds fixes are applied and each was provoked on chain.
  Do not re-audit them; `contracts/test/Bounds.t.sol` pins every one.

## Generated files

Files carrying a `// GENERATED by tools/<script>` header are never hand-edited.
Change the generator and re-run it.
