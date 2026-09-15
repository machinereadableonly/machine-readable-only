# Plan: rehearse the mainnet cutover on a Base mainnet fork (testnet coverage, Phase 5)

**Status:** proposed 2026-09-15, awaiting the operator's approval.
**After completing any operator-only step, tell the assistant so it can update memory immediately.**

## Why

A mainnet deploy is permanent (Hard Rule 1), and `warden/DEPLOY.md` section 10
says of the cutover, in so many words: "Nothing here has been rehearsed." Every
other phase of the testnet coverage work ran on Base Sepolia, and Sepolia cannot
exercise this part: its facilitator needs no key, its treasury may be a
placeholder, and its deploy block is already recorded.

A **fork** of Base mainnet closes that gap for free. `anvil --fork-url` runs a
local copy of the real mainnet state -- real USDC contract, real chain id 8453 --
that no one else can see, costs nothing, and is thrown away afterwards. Every
cutover step can run against it with the same scripts that will run on the day.

It unblocks the operator's mainnet steps (C4.5 onward): they should start from a
cutover that has been run once end to end, not from a checklist.

## What research already found (2026-09-15, before touching anything)

1. **There is no mainnet deploy wrapper.** `contracts/script/deploy-plan7.sh`
   hard-codes the chain (84532), the RPC and the Sepolia Clock's address. The
   Solidity script under it, `DeployPlan5.s.sol`, DOES support mainnet --
   `guardChain()` and a separate `MAINNET_DEPLOYER_KEY` that refuses the
   throwaway key -- but nothing calls it for mainnet.
2. **`adopt-deployment.sh` cannot adopt a mainnet deploy.** It sets
   `DEPLOY_BLOCK` with a pattern that matches only `{ 84532: ... }`
   (line 154), and asserts that shape; a mainnet adoption would fail there.
3. **`rehearse-start.sh` does not run the Warden the way PM2 does.** It starts
   node without the two IPv4 flags from `ecosystem.config.cjs`, so a mainnet
   rehearsal would test the Coinbase key over IPv6 -- where it is refused -- and
   report a failure that production would not have.
4. **`clock-rehearsal.mjs` is Base Sepolia only** (it throws on any other chain).

And one worry that turned out not to apply: **bitmaps are solved at mint time**
from `MRO_DOMAIN` (`main.mjs:80`, `:382`), so "re-solve every bitmap" in
section 10 is satisfied by configuration. The rehearsal confirms it.

## Steps

### A. Repository fixes (tests first where they can be tested; all four suites before each commit)

1. **`contracts/script/deploy-mainnet.sh`** -- the mainnet wrapper. States chain
   8453, defaults to `https://mainnet.base.org`, takes the Warden (Clock)
   address as a REQUIRED argument (the mainnet Clock is a new key, chosen at
   cutover), broadcasts only on the literal `--broadcast`, and runs the same
   build, size check and ABI pin as today. A `--fork <url>` mode for rehearsal
   only: it refuses any address that is not loopback and signs with anvil's
   public test key, so the rehearsal can never touch the real mainnet key.
2. **`adopt-deployment.sh --chain <id>`** -- records `DEPLOY_BLOCK` for the named
   chain and keeps the other chain's entry; the default stays 84532. Proven
   against a scratch copy both ways before it is trusted.
3. **`rehearse-start.sh`** reads the interpreter flags from
   `ecosystem.config.cjs`, so a rehearsal runs exactly as PM2 does.
4. **`warden/tools/mainnet-fork-rehearsal.sh`** -- one script that runs part B
   end to end, committed so the same run can be repeated on cutover day.

### B. The rehearsal (one run; the fork is thrown away at the end)

5. Start anvil forking Base mainnet at a pinned block, loopback only, with
   `--prune-history` (the 2026-09-11 disk incident), inside `safe-build.sh`;
   check `~/.foundry/anvil/tmp` afterwards.
6. Deploy with `deploy-mainnet.sh --fork`; then `forge build --sizes`,
   `check-deployed-abi.mjs` and `read-ladder.mjs` against the fork.
7. `adopt-deployment.sh --chain 8453` on an exported copy of the repository,
   never the repository itself; confirm `DEPLOY_BLOCK[8453]`.
8. Boot the Warden in mainnet mode against the fork with `rehearse-start.sh`
   (chain 8453, the fork contract, Coinbase's facilitator, a non-placeholder
   treasury). Expected: decoder verified, day matches, the treasury's balance
   read from the real mainnet USDC contract, and `payment ready` for
   `eip155:8453`. Also the refusal: the `0x...dEaD` placeholder on 8453 must
   stop it starting.
9. The Clock in mainnet mode against the fork: without a deploy block it must
   refuse; with one, a mint (solved against `machinereadableonly.com`), a
   check-in and a reconcile, with the real gas used recorded.
10. **A cost table at today's Base mainnet gas price:** the deploy, one mint,
    one day's check-in batch, one Mark -- what the operator will actually pay.

### C. Report

11. Findings, plus DEPLOY.md section 10 rewritten as the ordered checklist the
    rehearsal actually ran, rendered to HTML and committed.

## What a fork cannot prove

- **A real Coinbase settlement.** A payment made on the fork would settle on
  real mainnet, not on the fork; only the facilitator's handshake
  (`/supported`) can be exercised, and it is free.
- **OpenSea**, and **the real owner key** (a hardware wallet or a Safe is the
  treasury decision, C4.7). Those stay mainnet-day items.

## Cost, risk, and what cannot be undone

- **Nothing irreversible and no real funds.** The fork is local and disposable;
  anvil's test keys hold only fork money.
- **The auto-mode safety check may block the assistant** from starting anvil or
  signing on the fork, as it did for the testnet transactions. If so, the
  operator runs the rehearsal as one script, as in Phase 3.
- **Memory is tight on this box** (background tasks have been killed three
  times). anvil runs capped by `safe-build.sh`, and the rehearsal is one
  foreground run rather than a long-lived background process.
- **Parts A1-A3 change operator tooling** that the real cutover will use. That is
  the point -- the day should run tooling that has been run -- and each change is
  tested before it is trusted.

## Not in this plan

- Any real mainnet transaction, in any form.
- The treasury, the domain term, the owner key, the X credentials (operator
  items C4.5-C4.8).
