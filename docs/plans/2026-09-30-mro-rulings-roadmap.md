# The nine rulings: build roadmap

> After completing any operator-only step, tell Claude so it can update memory
> immediately. Operator-only steps in this roadmap: creating the Clock's Unix
> user (needs sudo), and creating the Safe or setting up the Ledger that will
> own the mainnet contract.

## Why

The 2026-09-28 review ended with nine decisions only the operator could make.
He made all nine on 2026-09-30 (the "Rulings" section of
`docs/reviews/2026-09-28/00-verification.md`). Each ruling now needs building,
and every one of them must land BEFORE the mainnet deploy: the token contract
cannot change after it, the reference client is staged on npm but not yet
released, and token 1's first day is written at its mint.

Nothing in this roadmap spends real funds or touches Base mainnet. The only
chain writes are on Base Sepolia.

## One correction to ruling 9, found while planning

A mint credits its own day, and same-day finishers are placed by lowest token
id. A token minted on day M that misses k days finishes on day M + 364 + k; a
perfect agent minted on opening day O finishes on O + 364. Token 1 is strictly
behind that agent only when k is at least (O - M) + 1, which means its first
check-in after the mint must be on **day O + 2, two days after the door opens**
-- whatever the head start. Resuming the day after opening, as first worded,
leaves an exact tie that token 1 wins on its id. The plan builds O + 2.

## The daily question (Q), added 2026-10-02

Approved by the operator the same day:
`docs/specs/2026-10-02-mro-daily-question-design.md`. It needs no plan of its
own; its work splits along the seams below and is marked **Q** in the table.
B comes first because the window must be measured before A fixes anything on
chain.

## Five plans, in this order

The rulings touch five separate parts of the system, so each gets its own plan,
its own tests and its own review. Small, independent work goes first; the one
Sepolia redeploy comes after the code it must carry; the Clock's move to its
own user comes last because it relocates the thing the redeploy exercises.

| Plan | Rulings | What it builds | Redeploy? |
|---|---|---|---|
| **C. Payments** | 7, 6 | The live refusal probe against x402.org and CDP on Base Sepolia first, because its result decides the classification. Then: an explicit facilitator refusal is `declined` if the probe shows refusals arrive non-2xx; the unresolved branch returns reason `payment-unresolved`; the client prints the approved wording for it; the plain-refusal text stays. | No |
| **B. Door and client** | 4, 5, Q | `challenge-response` becomes a required signed component, so only the key holder can answer. The door builds a `"signature-agent";key=` base line from the named dictionary member (RFC 9421 section 2.1.2), with a test signed from a hand-built base. `mro-agent`, the raw-protocol doc, `refusals.md` and SKILL.md change in the same plan. **Daily question (Q):** the `question` tool (one look per token per day), `checkin`'s optional `answer`, the mirror's `questions` table, the private question bank and its loader, `mro-agent question` / `beat --answer`, the agent-facing copy, and a MEASURED answer window. | No |
| **D. Token 1 on equal terms** | 9 | A `--not-before <YYYY-MM-DD>` guard on `mro-agent beat`, so the seed agent cannot check in early whatever the timer does; `MRO_SEED_NOT_BEFORE` in the seed agent's settings; the disclosure line in `llms.txt`; DEPLOY.md section 9c. A guard in code, not a runbook step, because a convention is not a guard. | No |
| **A. The contract redeploy** | 3, 2, Q | `seed` takes `expectedKeyId`; contractURI (ERC-7572) and a per-token `external_url`; `freezeRenderer` (built, not called); `bestRunOf`; the stored rest day; a `DEPLOY_DAY` floor; a 30-day lateness floor on check-ins. The Warden and Clock follow: the Clock passes the key to `seed`, and drops and flags a credit older than 30 days instead of letting it revert a whole batch. Then the size gate, a strict-limit anvil deploy, and a Base Sepolia redeploy with `adopt-deployment.sh`. `applyMark` is untouched (ruling 2). **Daily question (Q):** 365 answer bits per token, `batchCheckIn`'s answer bits and key reveals, `setSplitAnchor`, the renderer's three answer edges, the Clock's split and reveal, `mro-agent verify-border`, and re-pinned size, gas and decode gates. | **Yes, Sepolia** |
| **E. Key custody** | 1 | The Clock under its own Unix user: its own settings file split from `warden/.env`, a code copy the Warden cannot write, a shared group for the mirror database and its SQLite side files, new unit and log paths. The owner handover right after deploy (Ownable2Step), and `SwapRenderer` / `SetClockWarden` reworked to sign through the chosen device. DEPLOY.md 9b rewritten for a Safe-or-Ledger owner. **Daily question (Q):** the split seed lives with the Clock key. | No |

## What cannot be undone

- **Plan A's Sepolia redeploy supersedes the live pair.** Every Sepolia token,
  including token 1 and the test agent's daily cron that keeps it alive, stays
  on the old pair and stops being the live one. That is testnet and expected;
  the cron is re-pointed in the same plan.
- Nothing else in this roadmap is irreversible. Every push still waits for the
  operator.

## Open question for Plan E only

**Safe or Ledger for the mainnet owner?** A Ledger is one hardware device and
works with Foundry directly (`--ledger`). A Safe is a contract wallet approved
in the Safe web app, and can require more than one device. The scripts differ,
so Plan E is written after this is answered. It blocks nothing before Plan E.

## How each plan is written

Each plan is its own file in `docs/plans/`, in the house format (numbered
tasks, the failing test first, exact files, all four suites green before
every commit), rendered to HTML, and reviewed by the operator before it runs.
