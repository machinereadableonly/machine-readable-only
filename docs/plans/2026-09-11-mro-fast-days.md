# Plan: a fast-days test copy of Machine Readable Only

**Status:** approved by the operator and built, 2026-09-11. The fast pair is live on
Base Sepolia; addresses and the running processes are in auto-memory
(`fast-days-stack`), not here.
**After completing any operator-only step, tell the assistant so it can update memory immediately.**

## Why

Everything the piece does over time -- streak colours at 3 / 7 / 30 / 100, a
lapse paling the heart, the earned Marks (runs of 7 / 30 / 100 / 365), the
level-gated bought Marks (Static at 30, Iris at 100), a whole heart at 365, and
seeding a child after an agent-year -- is proven only by contract tests that
jump the clock forward. None of it has ever run through the real parts together:
an agent checking in through the door, the Clock writing it, the Warden's
windows and deadlines, paid Marks through the real payment service.

On the live testnet copy that takes real days: a whole heart is a year. A
separate throwaway copy where **a day lasts 5 minutes** runs the same parts on
Base Sepolia with the real x402 facilitator and the real client:

| Milestone | Real time on the fast copy |
|---|---|
| Streak colour at 3 / 7 | 15 / 35 minutes |
| Level 30 (Static), run 30 (Beat) | about 2.5 hours |
| Level 100 (Iris), run 100 | about 8.5 hours |
| Whole heart (365), agent-year (seed a child) | about 30 hours |

It is the testnet rehearsal the project's own rule asks for before mainnet:
exercise the whole matrix where it is cheap.

## What already works in our favour (checked 2026-09-11)

- The Clock takes the day from the contract's `today()` and only WARNS if the
  box disagrees (`warden/src/clock/main.mjs`), so it follows a fast chain day.
- The artwork reads the day through the token's own view, so it pales and
  rings on the fast day with no change.
- The Warden and Clock keep every file beside their database, so a second
  instance with its own `STATE_DB_PATH` shares nothing with the live one.

## What has to change

1. **The contract.** `today()` is `block.timestamp / 1 days` and is not
   overridable. Add the word `virtual`, and a test-only
   `MachineReadableOnlyFast` (under `contracts/script/fast/`, never under
   `src/`) that returns `block.timestamp / DAY` with `DAY = 300`.
   **GATE:** the real contract's runtime bytecode must be identical apart from
   the trailing metadata hash (which changes with any source edit). If it
   differs, stop -- the mainnet contract is permanent.
2. **The Warden.** It takes "today" from the box clock (`main.mjs:313`,
   `today: utcDay`) and assumes 24-hour days in eight places (`utcDay`,
   `onChainBy`, `nextWindowOpensAt`, `streakDeadline`, the stale-row window).
   One module, `warden/src/day.mjs`, owns the day length: `MRO_DAY_SECONDS`,
   default 86,400, so the live Warden is unchanged. Plus a boot check: read the
   contract's `today()` and refuse to start if it differs from the Warden's day
   by more than one -- a mismatched day length then fails loudly instead of
   queueing days the chain refuses.
3. **Tests.** Unit tests for `day.mjs` (the default is exactly 86,400,000 ms; an
   override changes every derived time; the boot check refuses a mismatch).
   All four suites green. A contract test that the fast variant's day is 300 s.

## Steps

1. Contract change + bytecode gate + fast variant + a `DeployFast.s.sol` that
   states its chain (Base Sepolia only, via the existing `guardChain`).
2. Warden `day.mjs`, the eight call sites, the boot check, tests. Commit.
3. A fresh throwaway **fast Clock key** (address printed, key never), funded
   with 0.01 test ETH from the testnet deployer. Deploy the fast pair to Base
   Sepolia with that key as its Warden, and the ten Marks.
4. Run the fast stack under PM2 (not systemd, which is blocked for the assistant):
   - `mro-fast-warden` on **127.0.0.1:4006**, its own settings and database in
     `~/.mro-fast/` (outside every repo, mode 700), domain `fast.test`
   - `mro-fast-clock`, the real Clock every 5 minutes, 30 s after each fast day
   - `mro-fast-agent`, the test agent checking in once per fast day
5. Drive the milestones with the test wallet and verify each ON CHAIN and in the
   rendered artwork: mint, streak 3 and 7, a missed day and the lapse, Ache
   (run 7), Static (level 30, 5 USDC), Beat (run 30), Iris (level 100, 25
   USDC), Aura (25 USDC), whole heart, and a seeded child.
6. Report, memory, and stop the fast stack when the operator says.

## Cost and trade-offs

- **Test USDC:** about 57 to reach Iris and Aura (mint 1, Hush 1, Static 5,
  Iris 25, Aura 25). Circle gives 20 per 2 hours, so **the operator claims three times**
  over the run. Tint ($250) and Vessel ($1,250) stay out of reach unless the
  fast copy gets lower prices -- not proposed here.
- **Test ETH:** the deploy plus about 288 Clock writes a day, a few cents'
  worth of free testnet ETH; the deployer holds 0.039.
- **It touches the Warden's time code.** The default stays 86,400 s and all four
  suites must pass, but a mistake there would reach the live Warden -- which is
  why the boot check exists.
- **Nothing is irreversible:** every step is on Base Sepolia, and the fast copy
  can be abandoned at any time.

## Not in this plan

- Any change to the live Sepolia pair or the live Warden's behaviour.
- Mainnet, in any form.
