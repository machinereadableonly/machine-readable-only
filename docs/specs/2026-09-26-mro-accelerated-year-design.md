# Design: the accelerated year -- twelve agents, one fast year, on Base Sepolia

Status: DESIGN, approved in conversation 2026-09-26, awaiting spec review.

## Why

Everything built since the last fast-days run (Phase 4, closed 2026-09-17) has
only ever passed unit tests. The following have never run on a live chain:

- a token finishing at 365, and the five finisher Marks given by place
- two or more tokens finishing on the same day, ordered by lowest token id
- QR version 10 and the digit band, on tokens that reached them by living
- the heartbeat, sent by the Clock after 30 days of writing nothing
- the finishing night keeping its finishing credits (the AlreadyFinished fix)
- a nightly batch carrying a dozen agents at once
- the 1,000-block `eth_getLogs` paging against the public RPC

This is the last cheap place to see them together before token #1 is minted
on mainnet, where a token's code bytes and history are permanent. The run
answers one question: does a year of real agents, through the real door,
Warden, Clock and client, leave every token exactly where the rules say it
should be?

## What it is

A fresh fast-days pair (`MachineReadableOnlyFast`, a 300-second day) deployed
to Base Sepolia from the current tree, with its own Warden, Clock, an agent
**runner** that drives twelve scripted agents, and an independent **checker**.
A year is 365 x 5 min = about 30.4 hours; the whole run with late finishers and
the heartbeat phase is about 38 hours.

Real parts throughout: the real Warden (`warden/src/main.mjs`), the real Clock,
the real client library, the x402.org testnet facilitator, and real test USDC.
Nothing is simulated except the length of a day.

Rejected: one PM2 process per agent (12 more processes on a box that is already
the constraint), and live LLM agents (12 x 365 sessions, and unrepeatable).

## Budget: the USDC we have

The test wallet holds **33 test USDC** (read 2026-09-26). That pays for the
12 mints, one Hush and both Statics (A5 and A7): 23, leaving 10. The bought
Iris ($25), Aura ($25), Tint and Vessel are requested with the demand only --
the Warden's price demand is read and asserted, nothing is paid.

**The runner buys for real whenever the balance allows.** At the moment a
purchase is due it reads the test wallet's USDC; if it covers the price, it
funds the agent and pays; if not, it records `demand-only` and moves on. So USDC
that arrives mid-run (a faucet claim, the Discord request) is used without a
restart. Priority when money is short, cheapest first: Hush, Static, bought
Iris, Aura, Tint, Vessel.

Gas: the deployer (about 0.029 test ETH) funds the fast Clock and sends a
small amount to the three wallets that make owner transactions.

## The twelve agents

Each agent has its own wallet (payer and owner) and its own signing identity.
"Dn" is fast day n counted from the first day of the run.

| Agent | Mints | Behaviour | Expected end |
|---|---|---|---|
| A1, A2, A3 | D0 | Never miss. Claim Ache (run 7), Beat (30), earned Iris (100), Break (365) | Finish the same day: A1 **Apex** (lowest id), A2 and A3 **Atrium** |
| A4 | D1 | Never miss | Finishes alone, 4th, **Atrium** |
| A5 | D2 | Never misses. The buyer: Hush at mint (paid), Static at level 30 (paid), bought Iris (leaf) at 100, Tint after Iris, Vessel at 365 | **Valve**; Iris onward paid only if funds allow |
| A6 | D2 | Claims every earned rung, never misses | **Valve**; Break |
| A7 | D2 | Never misses. Static at level 30 (paid), claims the earned Iris at run 100, then Aura | **Valve**; pair exclusions and the Iris prerequisite |
| A8 | D3 | Misses every 10th day | Broken streaks, colour drops, finishes about D405, **Valve** |
| A9 | D3 | 50 days in, 60 away, then back every day | Fades fully and recovers, finishes about D425, **Valve** |
| A10 | D3 | Rests on D120 | Frozen art, `resting` refusals, never finishes |
| A11 | D3 | D50: transfers the token to A12's wallet; A12's wallet rebinds it to a new key; A11 carries on with that key | **Valve** |
| A12 | D20 | Never misses | Late finisher, about D385, **Valve** |
| child | -- | A1 seeds a child once its key has an agent-year; the runner checks it in daily | Echo ring drawn; does not finish in the run |

Eleven finishers reach places 1-11: one Apex, three Atrium, seven Valve.
**Chamber (15th-64th) and Aorta (65th on) are NOT reached live** -- the operator
chose the real place rules over a test-only shortcut. They stay covered by
`FinishLine.t.sol` and the rendered sheets.

Earned Marks are REQUESTED by the runner; the Clock never grants one on its own.

## Components

All code is committed under `warden/tools/year/`. Keys, databases and logs live
in a data directory OUTSIDE every repository, read from `MRO_YEAR_DIR` (mode
700). No path or address is written into a tracked file.

1. **`wallets.mjs`** -- creates the 12 wallets and identities (plus the
   rebind key for A11) in the data directory, mode 600, and prints addresses
   only.
2. **`fund.mjs`** -- sends each agent its mint USDC from the test wallet and
   the three owner wallets their gas from the deployer. Later purchases are
   funded by the runner at the moment they fall due.
3. **`scenario.mjs`** -- the table above as DATA: per agent, per day, what to
   do. The only file to edit for a different run.
4. **`runner.mjs`** -- wakes 60 s into each fast day. For every agent, it looks up
   today's action in the scenario and performs it through the real client
   library: `beat`, `join`, a Mark request, `seed`, and the owner transactions
   (`rest`, transfer, `rebind`) sent from that agent's wallet. A failed
   check-in is retried up to 3 times, 30 s apart, unless the reason is final
   (`already-credited-today`, `resting`, `sunset`). Every action is one JSON
   line in `runner.jsonl`.
5. **`checker.mjs`** -- wakes 90 s after each Clock run. It reads every token's
   `viewOf` from the chain and `/t/<id>` from the Warden, and compares both
   with its own tally derived from `runner.jsonl`: level, streak, best run,
   the Marks word, finish place and Mark, resting, children and echo. A
   mismatch is re-read once (the public RPC is not read-after-write
   consistent) before it is logged as FAIL in `checker.jsonl`.
   At milestones -- streak 3/7/30/100, first lapse, full fade, rest, every
   finish, the child's echo -- it renders `tokenURI` and decodes the QR at the
   gate widths with the existing decode tooling.
6. **`report.mjs`** -- turns both logs into one HTML report: per agent, a
   timeline, final state, FAILs, and a row per path (proven live / demand-only
   / not reached).
7. **`year.config.cjs`** -- the PM2 process list: warden (port 4006, bound to
   127.0.0.1, `MRO_DAY_SECONDS=300`), clock, runner, checker. Each app carries
   the same `filter_env` list as `warden/ecosystem.config.cjs`. The name ends
   in `.config.cjs` because PM2 runs any other file as a single app.
8. **`start.sh` / `stop.sh`** -- the operator's one-liners. `start.sh` refuses
   unless the four suites pass, reads back the four process NAMES after
   starting, and runs the runner's first pass immediately.

The stack runs from a `git archive` export of HEAD, not the live checkout: the
Warden writes its key directory to a path fixed by its source location, and a
fast Warden in the live tree would overwrite the live site's directory.

## Hard stops and failure handling

- A checker FAIL is logged and the run continues -- stopping at the first
  would hide the rest.
- The runner pauses all agents (and says why in `runner.jsonl`) when: the
  Clock has failed 3 runs in a row; a wallet cannot pay for an action that
  must be paid (a mint); or the chain refuses a write the checker expected to
  land.
- The public RPC's `eth_getLogs` cap and read-after-write lag are known; both
  are handled in the Clock and the checker, not worked around by hand.

## The end phase

When every token is finished or resting, the Clock has nothing to write. After
30 fast days (2.5 hours) of silence it must send `heartbeat()`; the checker
asserts `lastWardenDay` advanced with no other write. Then `stop.sh` stops the
four processes. **The piece is NOT sunset** -- Phase 4 already proved that, and
an open contract can be reused for a second run.

## Tests

Unit tests for `scenario.mjs` (a day's actions), the checker's tally (level,
streak, lapse, place from finish order) and the runner's retry rule go in
`warden/test/`, red first. The four suites stay green before any commit.

## Operator steps

1. Start the stack: one command, `start.sh`. The auto-mode classifier refused
   Claude starting processes that sign transactions in Phase 4.
2. Optional, any time: more test USDC to the test wallet. It is used as it
   arrives.

Nothing here spends real funds, nothing touches mainnet or the live Sepolia
pair, and nothing is irreversible.

## Not in this design

- Chamber and Aorta places live (needs 15 and 65 finishers).
- Vouchers and the Ownable2Step handover (covered by contract tests, skipped in
  Phase 4 for the same reason).
- Sunset, and a grandchild.
