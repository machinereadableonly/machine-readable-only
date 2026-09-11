# Plan: a token's first day is the day it was paid for

**Status:** approved 2026-09-11 -- Option A, with the working-file cleanup and the history rewrite (the rewrite last, once the fix has landed).
**After completing any operator-only step, tell the assistant so it can update memory immediately.**

Also in this plan: two smaller fixes the fast-days copy found, and removing the
operator's initials from the repository.

## Why

Within an hour of running, the fast-days copy (a five-minute day on Base
Sepolia) showed that **every token loses its first check-in, and the Warden's
record of it runs one level ahead of the artwork from then on.** Measured on
fast token 1, 2026-09-11:

| | first day | last day | level | streak |
|---|---|---|---|---|
| Chain (the artwork) | 5,963,787 | 5,963,787 | **1** | 1 |
| Warden's mirror | 5,963,785 | 5,963,787 | **2** | 1 |

The agent was told "Day 2 credited". The Clock then sent that day, the contract
refused it (it was already the token's first day), and the Clock recorded it
as "already on chain".

**The root cause is a rule the project already states and does not follow.**
The Clock, the writer and the spec all say *"a pending row keeps its own day
number, so levels and streaks come out identical whenever the write lands."*
That holds for check-ins. It does not hold for mints and seeds: the Warden
records the day the agent PAID, but the contract sets `mintDay` and `lastDay`
from `today()` at the moment the Clock WRITES -- on the live site, 00:05 the
next day. So the two disagree by one day for every token, and for every child
(`seed` does the same).

It must be fixed before mainnet: mainnet is permanent, and a record that is
wrong by a day on every token is wrong forever.

## The choice (the operator's decision)

### Option A -- the contract takes the day (recommended)

`mint(id, to, keyId, code, day)` and `seed(childId, parentId, to, code, day)`
take the day the Warden recorded at payment. The contract checks it:

- `day <= today()` -- the existing `FutureDay` error, as for check-ins.
- `day + 30 >= today()` -- a new `StaleDay(day)` error. Without a floor, a
  Warden could backdate a mint and credit every day since, fabricating a year
  of history in one night. Thirty days is far beyond any delay the gas guard
  or an outage would cause; a mint older than that is refused and reported as a
  paid mint needing a human, by the path that already exists for stuck mints.

`mintDay`, `lastDay` and `_firstMintDay` (the agent-year for seeding) are then
the payment day. Mirror and chain agree by construction, the day the agent paid
is its first cell, and the next day's check-in counts.

- **Cost:** a change to the permanent contract -- allowed, because mainnet is
  not deployed yet. A Sepolia redeploy (new pair; the mirror is reset by the
  2026-09-06 rule, keys kept). About 57 test call sites updated mechanically,
  the ABI regenerated, and one column added to the Clock's pending-mint query.
  Gas: one extra calldata word per mint. Deployability re-proved.
- **What is lost:** live Sepolia tokens 1 and 2 stay on the old pair, which is
  superseded like every pair before it. The test wallet mints again.

### Option B -- the Warden adopts the chain's day

No contract change. When a mint or seed lands, the Clock reads the token back
and overwrites the mirror's days, level and streak with the chain's; the Warden
tells the agent its token begins on the day it is written.

- **Cost:** the day the agent paid never counts -- on the live site every token
  is born the day after it is bought. Two meanings of "the first day" stay in
  the code, and every future feature has to remember which one it is using.

**Recommendation: A.** It fixes the cause, it makes the project's own stated
rule true for every row, and this is the last moment it can be done cheaply.

## In both options: the two smaller findings

1. **A paid token cannot be checked in until it is minted.** Check-in asks the
   chain whether the token exists and refuses `unknown-token` -- telling the
   agent the site does not know a token it lists in `status`. Fix: accept and
   queue the check-in when the mirror holds a paid mint for it (the Clock writes
   mints before check-ins in the same run); keep `unknown-token` only when
   neither the chain nor a paid mint knows the id.
2. **The artwork solver runs on a fixed 5-minute timer**, not when payment
   settles, so a mint paid just before a Clock run can miss it. Fix: start the
   solver when a mint settles; keep the timer as a backstop.

## Steps (Option A)

1. **Contract:** `mint` and `seed` take `day`, with both bounds. Tests first:
   a future day and a stale day revert by name; the recorded day becomes
   `mintDay`, `lastDay` and `_firstMintDay`; a check-in the next day is level
   2; the seed budget counts from the paid day. All 57 call sites updated.
   Gas budget, sizes and a strict-limit deploy re-measured.
2. **Spec:** dated amendments to the `mint` and `seed` rows.
3. **Warden and Clock:** regenerate the ABI; the Clock sends the day from the
   token row; the two smaller fixes; tests first for each.
4. **Gate:** all four suites, the pre-publish check, and
   `warden/tools/rehearse-start.sh` (the real Warden against a copy of
   production state).
5. **Redeploy the live Sepolia pair**, adopt it, back the mirror up with
   `VACUUM INTO`, reset it by the rule, restart `mro-warden`. Re-mint with the
   test wallet.
6. **Redeploy the fast copy** and prove it end to end: mint, then the next fast
   day's check-in -- chain and mirror both at level 2.
7. Commit; push on the operator's approval.

## Removing the operator's initials

**Working files.** The initials appear 374 times in 67 of the repository's own files
(plans, specs, reviews, code comments, `CLAUDE.md` and `.claude/rules/`). The
16 matches under `contracts/lib` are binary audit PDFs in vendored code and are
left alone. Each becomes "the operator" (possessives and dated decisions read
the same way: "the operator, 2026-08-30"). The 26 changed Markdown files with
an HTML twin are re-rendered, and all four suites and the pre-publish check
run. One commit.

**History -- a separate decision, and irreversible.** The initials are also in 17 of
316 commit messages and in earlier versions of those files. Only rewriting the
whole history and force-pushing removes it, as on 2026-09-09: every commit id
changes, every id quoted in memory and docs goes dead, and anyone who has cloned
the repository keeps the old history. **Recommendation:** clean the working
files now; if the history is to be rewritten, do it once, after the mint-day
fix has landed, so it is not rewritten twice.

## What this plan does not do

- Deploy anything to mainnet.
- Rewrite history without a separate, explicit yes.
