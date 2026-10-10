# Plan G -- building the 2026-10-10 rulings

## Why

The 2026-10-08 review sprint closed everything Claude could fix alone. The
operator then ruled all 19 open decisions on 2026-10-10. Each ruling either
changes code that freezes at the mainnet deploy (the token contract, the
Renderer, the deploy path) or changes what an agent must do before
`mro-agent` is published. This plan builds those rulings so the mainnet deploy
and the npm publish are no longer blocked on code.

The operator asked for as much as possible without the operator being involved, so the
plan runs end to end and stops only at the gates listed at the bottom.

Nothing is pushed and nothing is deployed. Every change lands as a local
commit on `main`, gated by all four suites.

## Phase A -- housekeeping

1. **D18:** delete `contracts/script/deploy-plan6.sh` and `verify-plan6.sh`
   (ruled), and fix the comment in `deploy-plan7.sh` that points at them.
2. **D5:** token 1 starts on opening day + 1. Update DEPLOY.md 9c,
   `seed-config-check.sh`, `install-seed-agent.sh` and their tests.
3. **D13:** `CLOCK_CHECK_RPC_URL=https://mainnet.base.org` in the mainnet
   steps and the Clock's settings example.
4. **D14:** a script that lists the six env backups holding a Clock key by
   NAME and deletes them after a typed confirmation. It never reads a value.
   The operator runs it.
5. **D10a:** a runbook step for an offline backup of the split seed, stored
   like a wallet recovery phrase, reachable by the Safe signers.
6. **D10b:** question order gets its own secret, `QUESTION_SECRET`, required
   at Warden boot (fails loudly when missing). The operator adds one setting.
7. **D11:** cut the early-access allowlist from the spec; draft a launch plan
   for the operator to edit.
8. **D19:** draft the five copy items for approval (no copy is changed), and
   scope the `yesterday` square.

## Phase B -- contract and Warden rules (PERMANENT bytecode)

1. **D8.1:** a per-parent seed limit: a parent seeds at most once per 365
   days since its own mint day, whatever key it is bound to, in addition to
   the per-key budget.
2. **D8.4:** `setSplitAnchor` refuses once any token exists.
3. **D8.2, D8.3, D8.5:** record as intended -- NatSpec plus a test pinning
   each (reveal allowed while paused; a voucher writes no answer; a lost seed
   stops every write, recorded in the Clock's code comment and test).
4. **D6:** `question` and the answer half of `checkin` record an answer only
   when the chain's binding matches the caller. A donated check-in is still
   credited; its answer is dropped and the reply says so.
5. Gates: `forge build --sizes` positive margin, the strict-limit anvil
   deploy, `RealTokenGas.t.sol` re-run and the pins updated from measurement.

## Phase C -- deploy path and infra (scripts built and dry-run only)

1. **D2:** a Ledger signing path in the deploy script, and the Windows PC
   steps (Foundry, the repo, the Ledger) written one at a time.
2. **D1:** the Warden moves to its own system user running a root-owned copy,
   with the operator's secrets out of its reach. Installer + cutover script,
   dry-run and tests only. The operator runs one sudo install later.

## Phase D -- signing and payment (approved installs)

1. **D16 / item 23:** `web-bot-auth` 0.2.0 + `http-message-sig` 0.3.0 in the
   client and the Warden; signatures cover `"signature-agent";key="sig1"`; the
   door's `keyedMessage` workaround removed in the same commit.
   Versions and advisories re-checked live before installing.
2. **D16 shrinkwrap:** `npm-shrinkwrap.json` replaces
   `client/package-lock.json`; `viem` pinned exactly.
3. **D17:** the EIP-3009 nonce must equal
   `keccak256(keyId, tool, args, salt)`; the client sends `salt`; the
   Warden refuses a nonce that does not recompute. Client, SKILL.md and the
   raw protocol doc together.

## Phase E -- the Renderer pass (D3, D4, D19 #13-#16)

1. Compiler 0.8.37 (fall back to 0.8.35 only if a size margin goes negative).
2. Drop `Years`; `house` marker; constant collection image; #13 rung-0
   chroma, #14 ghost frame, #15 Apex's gold apart from Vessel's, #16 one
   `Mark` attribute per Mark; the description rewrite.
3. Every visual change and the description wording are rendered into a sheet
   for the operator. **Nothing visual is committed before the operator approves it.**
   The work sits on a branch until then.

## Where this stops for the operator

- Approving the Renderer sheet and the description wording (Phase E).
- Approving the copy drafts (Phase A8).
- Running the D14 deletion script; deleting `~/.mro-split/seed`.
- Adding `QUESTION_SECRET` to the Warden settings (and the earlier
  `MRO_QUESTION_BANK`), then the sudo installs.
- The Sepolia redeploy that carries Phase B's contract changes, and D15's Safe
  acceptance on THAT pair (one drill on the pair that will stay, rather than
  one on a pair about to be superseded).
- Every push.

## What cannot be undone

Nothing in this plan. The contract changes become permanent only at the
mainnet deploy, which is a separate operator-approved step.
