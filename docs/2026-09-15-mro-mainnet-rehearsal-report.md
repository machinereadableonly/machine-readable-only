# Report: the mainnet cutover, rehearsed on a Base mainnet fork (2026-09-15)

Plan: `docs/plans/2026-09-15-mro-mainnet-rehearsal.md`. This is testnet
coverage Phase 5.

## The headline

**The cutover now runs end to end, as one command, and it passed.**

```
~/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh
```

Run 3 of the rehearsal passed every step. It forked real Base mainnet at block
51,341,835 into a local, disposable chain. Nothing was sent to a real chain. Real
mainnet was only read: its state, its gas price, and its fee oracle.

It also found **one real mainnet risk, decided and closed on 2026-09-16** (F5
below).

## What passed (run 3)

| Step | Result |
|---|---|
| Export the working tree; fork mainnet with `--prune-history` | PASS; `~/.foundry/anvil/tmp` stayed at 4 KB |
| `deploy-mainnet.sh --fork --broadcast` | PASS; 12 transactions, 8,001,122 gas |
| `check-deployed-abi.mjs`, `read-ladder.mjs` against the fork | PASS; the ABI describes the bytecode, and the ten Marks match the spec |
| Owner is the deploying key; warden is the `--warden` key | PASS |
| `adopt-deployment.sh --chain 8453` in the exported copy | PASS; `{ 84532: 46_686_660n, 8453: 51_341_836n }` |
| The Warden booted in mainnet mode through `rehearse-start.sh` | PASS; `payment ready (eip155:8453 via https://api.cdp.coinbase.com/platform/v2/x402, ...)` |
| The `0x...dEaD` treasury on 8453 | REFUSED, for the right reason: "TREASURY_ADDRESS is a placeholder ... and chain 8453 is not Base Sepolia" |
| The Clock with no `DEPLOY_BLOCK[8453]` | REFUSED before writing anything |
| The Clock's gas guard (the fork prices at about 1 gwei; the cap is 0.05) | HELD; nothing written, exit 0 |
| The Clock: a mint, then a check-in and a Mark two days on | PASS; 356,650 / 42,643 / 62,722 gas |
| Reconcile | PASS; read `Minted: 1` back from the fork |
| A paid mint to an EIP-7702-delegated wallet | cannot land, as asserted (F5) |

## Findings

| # | Finding | Status |
|---|---|---|
| F1 | There was no mainnet deploy wrapper: `deploy-plan7.sh` hard-codes Base Sepolia. | **Fixed** in `b478404`: `contracts/script/deploy-mainnet.sh`, run on the fork. |
| F2 | `adopt-deployment.sh` could only record a Sepolia deploy block. | **Fixed** in `b478404`: `--chain`, plus `set-deploy-block.sh` with its own test. |
| F3 | `rehearse-start.sh` ran node without the ecosystem's IPv4 flags, so a mainnet rehearsal would have tested the CDP key over IPv6, where it is refused. | **Fixed** in `b478404`. |
| F4 | `warden/tools/clock-rehearsal.mjs` is stale. It calls `insertMint` without the payment nonce required since 2026-09-05, so it would crash, and it is Sepolia-only. | **Retired** the same day at the operator's decision, with its wrapper `rehearse.sh`. Superseded for mainnet by `mainnet-fork-clock.mjs`. |
| **F5** | **A paid mint to a recipient that cannot receive an ERC-721 can never land.** `mint` ends in `_safeMint` (`MachineReadableOnly.sol:399`), which calls `onERC721Received` on any recipient with code. The Warden took the payment without checking the recipient. On the fork, the anvil test accounts carry an EIP-7702 delegation inherited from real mainnet (`0xef0100` followed by `8a67b502...`), and a mint to one fails every run. | **DECIDED AND BUILT 2026-09-16: option 1**, the Warden refuses before payment (`receiverBlock`). See below. |
| F6 | A revert raised by the recipient's own code is not in MRO's ABI, so the Clock logs a bare `reverted-on-simulate` with no error name. | **FIXED 2026-09-16.** An unnamed revert is now diagnosed: the Clock asks whether the recipient can hold an ERC-721 and names that as the cause, and otherwise prints the (redaction-safe) `detail`. A recipient that cannot receive makes the mint `stuckMints`, so the run fails instead of retrying in silence. |
| F7 | A mint that cannot land takes the check-in queued behind it down with it: `NoSuchToken`, then `stuckCredits`, then exit 1. Fork run 2 showed exactly this. It is the path-inventory flag 3.16, made concrete. | **FIXED 2026-09-16.** A `NoSuchToken` for a token whose own mint is still unwritten is "not yet", not "never": it stays queued instead of being condemned by `failCredit`, and goes out on the first run where the mint lands. The credit is still SENT -- withholding it was too broad and stopped a seeding parent's own check-ins. |
| F8 | The gas guard works in mainnet mode. Real Base was at 0.006 gwei, well under the 0.05 cap. | Proven. |
| F9 | The Builder Code is still null, so every mainnet write would go unattributed. | Known; waits on base/docs#1950. |
| F10 | Section 10's "re-solve every bitmap" is satisfied by configuration: bitmaps are solved at mint from `MRO_DOMAIN`. | Proven; DEPLOY.md corrected. |
| F11 | `https://mainnet.base.org` refused requests after about five quick calls during measurement. | Note. The production Warden and Clock should not depend on the public endpoint under load. |

### F5: the decision

**DECIDED AND BUILT, 2026-09-16: option 1.** `receiverBlock` in
`warden/src/mcp/gates.mjs` reads the code at `--to` and, when there is any,
simulates `onERC721Received` from the token contract's own address and requires
the magic value. An unreadable RPC refuses rather than admits, like every other
gate. The refusal names the remedy, because `--to` is the OWNER address the
agent supplied rather than the agent itself: a refused agent passes a different
address and mints, having paid nothing. It excludes no address the contract
would have accepted -- `_safeMint` already refuses exactly this set, and the
only change is that the refusal now happens before the money moves.

Options 2 and 3 were considered and are recorded below as they stood. Option 2
remains available until the mainnet deploy, and was declined for now because a
token minted into an address that cannot move it is frozen in ownership
forever: never transferable, never rebindable, never sealable.

On mainnet, agents increasingly pay from smart wallets or EIP-7702-delegated
accounts, and the client sends whatever `--to` the operator gives it. There
are three options:

1. **Refuse before payment (recommended).** Before issuing a payment demand,
   the Warden asks whether `--to` can receive: if the address has code, it
   calls `onERC721Received` on it and requires the ERC-721 magic value. An
   agent is then refused with a clear reason and pays nothing. This changes the
   Warden only; no redeploy.
2. **Change `mint` to use `_mint`.** Anything can then receive a token,
   including contracts that can never move it. This changes the contract, and
   mainnet is not deployed yet, so it is still possible.
3. **Document it only**, in SKILL.md and llms.txt: `--to` must be an ordinary
   wallet or one that accepts ERC-721. This is cheapest, and it relies on every
   agent reading the documentation.

Seeds are not affected in the same way: `seed` treats `ERC721InvalidReceiver`
as a permanent refusal and hands the seed back, and nobody paid for it.

## What it costs on real Base mainnet

Gas used was measured on the fork. The gas price, 0.006 gwei, was read live
from `mainnet.base.org` on 2026-09-15. Base's L1 data fee was measured live
with the GasPriceOracle predeploy, `getL1Fee` (version 1.6.0), on each
transaction's real calldata. ETH was $2,474.43 at Coinbase spot that day.

| Item | L2 gas | Total ETH | USD |
|---|---|---|---|
| Deploy, all 12 transactions | 8,001,122 | 0.000048160 | about $0.12 |
| One mint | 356,650 | 0.000002141 | about $0.005 |
| One check-in (a one-entry batch) | 42,643 | 0.000000257 | about $0.0006 |
| One Mark | 62,722 | 0.000000377 | about $0.0009 |
| A night's 100-entry check-in batch | 907,196 (estimated) | 0.000005446 | about $0.014 |

- **The L1 data fee is about 0.3% of each total**, so L2 execution dominates.
- Of the deploy's L1 fee, five of the twelve transactions were measured. The
  other seven are identical-size Mark writes, taken as equal to the three
  measured ones.
- The 100-entry batch's L2 gas comes from the anvil-measured 30,896 gas per
  transaction plus 8,763 per entry. Its L1 fee was measured.
- **These figures move with the gas price.** The Clock's cap of 0.05 gwei is
  about eight times that day's price, and above it the Clock writes nothing
  and waits.

## What the rehearsal cannot prove

- A real Coinbase settlement.
- OpenSea.
- The handling of the real owner key.

These stay mainnet-day items; see DEPLOY.md section 10.
