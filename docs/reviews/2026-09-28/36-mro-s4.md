# Machine Readable Only -- security -- the Clock, cron, chain writes and key handling

**Snapshot:** 8d2a0d27e3
**Read:** `reports/32-mro-tm.md`; `CLAUDE.md`; `.claude/rules/{warden,contracts,rendering}.md`; `warden/src/clock/{main,run,write,batch,reconcile,cursor,unresolved,heartbeat,redact,builder-code}.mjs`; `warden/src/mirror/{schema.sql,db.mjs,queries.mjs}`; `warden/src/chain/{read,preflight}.mjs`; `warden/src/main.mjs:1-120`; `warden/src/pay/x402.mjs:40-99,300-359,434-530`; `warden/src/mcp/tools/seed.mjs:90-183`; `warden/src/solve/worker.mjs`; `warden/ecosystem.config.cjs`; `warden/.env.example`; `warden/.gitignore`; `.gitignore`; `warden/deploy/{mro-clock.service,mro-clock.timer,install-clock-logging.sh,mro-clock-logrotate.conf.example,relocate-env-backups.sh}`; `warden/deploy/set-contract-address.sh` (grep); `warden/tools/derive-address.mjs`; `scripts/{make-clock-key,rehearse-clock-key,setup-clock}.sh`; `contracts/.env.example`; `contracts/script/deploy-mainnet.sh:1-110`; `contracts/src/MachineReadableOnly.sol:130-259,330-885`; installed library source: `@x402/core dist/esm/chunk-H7ETXA5T.mjs:402-532,1372-1569,1677-1693` and `chunk-P3DFEIO7.mjs:20-39`, `@x402/evm dist/esm/chunk-7KWSWAVE.mjs:225-331`, `@noble/curves` 1.9.1 `esm/abstract/{weierstrass.js:252-275,utils.js:70-195}`, `viem/_esm/accounts/privateKeyToAccount.js`.

## Findings

### [HIGH] [BLOCKS MAINNET] The held-payment check treats a cancelled authorisation as paid, so a payer can get a mint or a $1,250 Mark free
**Where:** `warden/src/clock/unresolved.mjs:76-91,101-110`; `warden/src/mirror/queries.mjs:676-690`. The path into it: `warden/src/pay/x402.mjs:347-351,508-514`, and `@x402/core chunk-H7ETXA5T.mjs:513-525` plus `:1548-1567`.

**Attacker story:** Any agent with a wallet and enough USDC to pass verification (for example $1,250 for Vessel, or $250 for Tint).
1. The agent signs an EIP-3009 authorisation with nonce N. It also signs a `cancelAuthorization` for (itself, N).
2. It calls `upgrade` (or `mint`) and, at the same moment, submits the cancel to USDC.
3. Verification passes, because the nonce is unused at that moment (`@x402/evm chunk-7KWSWAVE.mjs:238-249`). The handler then reserves the row.
4. The cancel lands before the facilitator's `transferWithAuthorization`, so settlement fails with "authorization is used or canceled" (`:289`).
5. If the facilitator answers that refusal with a non-2xx status and a `{success:false}` body, the payment is held as `payment-unresolved`.
6. At 00:05 the Clock reads `authorizationState(payer, N)`. It returns `true`, because USDC sets that same flag on cancel. The row is promoted to `queued`, and `applyMark` or `mint` is written in the same run.

The agent keeps its USDC. A failed attempt costs only the cancel's gas, so the race can be retried.

**Why it works:**
- `HTTPFacilitatorClient.settle` throws `SettleError` for any non-2xx reply whose body has `success` (`:523-524`), and `settlePayment` re-throws it (`:1567`).
- The Warden's wrapper labels every throw as `"unresolved"` (`x402.mjs:350`), so an explicit refusal and a lost answer end up in the same place.
- `resolveUnresolvedPayment` then promotes on `paid: Boolean(spent)` (`unresolved.mjs:91`), and `spent` is true for both "used" and "cancelled".

**Fix (both parts):**
1. In `unresolved.mjs`, decide "paid" from USDC's `AuthorizationUsed(authorizer, nonce)` event (both fields are indexed) rather than `authorizationState`. Search the block window from `reservedAt` to now, paged at 1,000 blocks. Also require a USDC `Transfer(payer → treasury, price)` in that transaction. Treat `AuthorizationCanceled` as unpaid.
2. In `x402.mjs:347-351`, classify a `SettleError` (the facilitator answered explicitly) as `"declined"`. Only transport errors, timeouts and `SETTLEMENT_PENDING_REASON` should count as unknown.

### [HIGH] [BLOCKS MAINNET] The Clock key is readable, and the Clock's code is writable, by the internet-facing Warden
**Where:**
- `warden/ecosystem.config.cjs:41-45` (the Warden loads `.env`)
- `warden/src/main.mjs:54-69` (the key is deleted from `process.env` only, and the comment admits "not a boundary")
- `warden/deploy/mro-clock.service:11,27,38`
- `scripts/make-clock-key.sh:115-126`

**Attacker story:** Anyone who gets code execution in the Warden gets the warden role. Possible routes include a dependency in the x402, MCP or web-bot-auth tree, the solver child, or a path bug. The Warden has no sandbox and runs as the same Unix user as the Clock. That user can do two things:
- read `warden/.env`, which holds `CLOCK_PRIVATE_KEY`;
- rewrite `warden/src/clock/*.mjs` or `node_modules`, which the Clock runs with the key at the next 00:05. Rotating the key does not stop this.

With the key, the attacker can:
- **Mint without paying.** Up to `supplyCap`, to any address, with any key ID and any permanent bitmap (`MachineReadableOnly.sol:342-380`).
- **Forge visits.** Credit today to any token that is not resting, including to take finishing places (`:499-544`).
- **Change other people's tokens for good.** Write unwanted Marks onto strangers' tokens, which permanently closes off each Mark's pair partner (`:700-761`; Marks are never cleared).
- **Spend other agents' seeds.** Spend any whole token's key's seed and send the child to themselves (`:839-884`).
- **Sign vouchers.** Once vouchers are enabled, these never expire (`:581-600`).
- **Drain** the gas ETH.

`setWarden` stops further damage, but everything already written is permanent. The comment at `make-clock-key.sh:117-120` also misstates the key's powers: it leaves out `heartbeat` and voucher signing.

**Why it works:** One file, one Unix user and one writable code tree serve both processes. `delete process.env.CLOCK_PRIVATE_KEY` guards against leaking the environment, not against reading the file.

**Fix:**
- Run the Clock as a dedicated system user (a system unit with `User=`). Give it a read-only code tree and a key file it alone can read (mode 0400, outside `warden/`, never in the Warden's `.env`). Share only the mirror directory, through a group.
- An alternative is a remote signer or KMS.
- Interim step: move the key to its own file, loaded only by the Clock unit through a second `--env-file`. Keep only a small ETH float on the Clock address, and alert on any warden-signed transaction the Clock did not send (for example, a nonce jump against the last run).
- Correct the comment.

### [HIGH] [BLOCKS MAINNET] The mainnet owner key's default home is a hot file on the same box
**Where:** `contracts/.env.example:13-25`; `contracts/script/deploy-mainnet.sh:28-31,86-93`

**Attacker story:** The same Warden compromise as above. If `MAINNET_DEPLOYER_KEY` is still in `contracts/.env` after the deploy, the attacker also holds the permanent owner. That allows `setSunset` (irreversible), `setRenderer` (which can break every image), `setWarden`, and `setUpgrade` on Marks already sold.

**Why it works:**
- The script sources `./.env` with `set -a`, which exports every variable to `forge` and all its child processes.
- Moving ownership to a Safe or hardware wallet is written as "prefer", and nothing checks that it happened.

**Fix:**
- Remove the plain-text key path for chain 8453. Require `--ledger`, or `--account` with a keystore and a password prompt, so no owner key is ever written to disk on the VPS.
- Make the `Ownable2Step` handover part of the cutover's pass criteria: a check that `owner()` equals the Safe address.

### [MEDIUM] A queued seed spends whichever key the parent is bound to at 00:05, not the key that asked for it
**Where:** `warden/src/clock/run.mjs:439-451`; `warden/src/mirror/queries.mjs:275-282` (`agentKeyId` is selected and never used); contract `:854-857`

**Attacker story:**
1. The owner A of a whole token P asks for a seed late in the day, with `to` set to A's own wallet. The Warden checks the binding at that moment (`seed.mjs:106`).
2. Before 00:05, A sells P. The buyer B rebinds P to key KB, a key with its first mint at least a year back and a seed available.
3. The Clock sends `seed(child, P, A_wallet, …)`. The contract charges `seedsAvailable(P)` on KB (`_agentKeyOf[parentId]` at write time).

Result: B loses the seed they earn once a year. A receives a tradeable child token bound to B's key. If B asked for their own seed the same day, it is refused as `NoSeedAvailable` and dropped (`run.mjs:504-511`).

This cannot happen until some key reaches its first anniversary, so the risk is latent at launch.

**Why it works:** The seed pass re-reads nothing about the parent's binding or owner before it writes.

**Fix:** Before each `seed`, read `viewOf(parentId).agentKeyId` and compare it with `keyIdToBytes32(s.agentKeyId)`, and check `ownerOf(parentId)`. On a mismatch, drop the row (which hands the year back to the original key) and alert. Apply the same key check to the free, earned Mark orders before `applyMark`, since an earned Mark can close off a partner Mark a new owner wanted to buy.

### [MEDIUM] A killed run leaves its lock behind and halts every later run; reconcile's memory and page handling make that kill reachable
**Where:** `warden/src/clock/main.mjs:94-112,205-226`; `warden/deploy/mro-clock.service:59-60` (`OOMPolicy=continue`, `MemoryMax=1G`); `warden/src/clock/reconcile.mjs:66-91`; `warden/src/clock/cursor.mjs:79-82`

**Attacker story:**
- **The lock.** A SIGKILL leaves `state.db.run-lock` in place. Causes include the out-of-memory killer at 1 GB, a reboot or power loss, or systemd's final kill. The lock sits beside the database, so it survives a reboot. Every later run throws at `takeLock`, before the payment check, mints, credits and heartbeat.
- **The consequences.** After 30 days, queued paid mints can never land (`StaleDay`, `run.mjs:357-362`; contract `:397-405`). The heartbeat stops. There is no `OnFailure=`, and the "alerts" are lines in the same log file.
- **The outsider's lever.** A token holder can emit many `Transfer` events cheaply, for example by moving their own token back and forth through a helper contract. `readEvents` holds every event of the whole catch-up window in memory before applying any of them. It also never splits a page that the provider refuses as too large, so a bad window is re-read every night and the cursor never moves.

I did not measure the cost of the attack. The stale-lock behaviour itself is certain.

**Fix:**
- Record the PID and `/proc/sys/kernel/random/boot_id` in the lock, and reclaim it when that process is gone. Alternatively, move the lock to `RuntimeDirectory=`, which is cleared at reboot.
- Add `OnFailure=` with an external alert.
- Apply events and advance the cursor page by page, and halve the span when a response-size error comes back.

### [LOW] A child that landed and was then transferred is deleted from the mirror
**Where:** `warden/src/clock/run.mjs:193-205,473-488` (the same shape applies to mints at `:167-179,336-350`)

**Attacker story:** No attacker is needed; this is a failure mode an agent can trigger by accident.
1. A `seed` returns `receipt-unknown` (or the run is killed after broadcast), but the transaction lands.
2. The agent moves the child to another wallet before the next run.
3. `seedIsOnChain` compares the current owner with `s.toAddress`, gets `false`, and `dropSeed` deletes both rows. After that, `/t/<child>` returns 404 permanently.

For mints, the same situation raises a false "DIFFERENT token" alert that needs a human.

**Fix:** Identify the token by facts that cannot change: `view.parent == parentId` and `view.code == 0x${qr}` (the bitmap encodes its own ID's URL). For mints, add `agentKeyId`. Drop the owner comparison.

### [LOW] `redact.mjs` blocks only URLs, not a whitelist, and one error path can print the private key
**Where:** `warden/src/clock/redact.mjs:29,66-68`; `warden/src/clock/main.mjs:121,221`; `warden/src/clock/unresolved.mjs:87`; `@noble/curves esm/abstract/weierstrass.js:273`, `utils.js:193-194`

**Attacker story:** Nobody external. If `CLOCK_PRIVATE_KEY` holds a 32-byte value that is 0 or at least the curve order (for example, a hash pasted by mistake), noble's range check throws `expected valid private key: 1 <= n < N, got <key in decimal>`. `safeErrorText` does not redact it, and the value fits inside the 300-character cap, so the key goes into `~/logs/mro-clock.log`. Hex format errors, by contrast, are masked (`weierstrass.js:268-269`).

Separately, `unresolved.mjs:87` logs `err.shortMessage ?? err.message` without `safeErrorText`, so a non-viem error there could carry the RPC URL.

**Fix:**
- In `makeWriter`, wrap `privateKeyToAccount` in its own `try` and print a fixed message, as `derive-address.mjs:39-45` already does.
- Route `unresolved.mjs:87` through `safeErrorText`.
- Also redact any `0x` followed by 64 hex characters, and any run of more than 70 digits.

### [LOW] The gas cap is checked once and never binds what is sent
**Where:** `warden/src/clock/write.mjs:96-99,166-176`

**Attacker story:** Nobody external. `gasOk` compares `getGasPrice()` with the cap once per run. Each later `writeContract` (bisection, many chunks, a run of up to 10 minutes) uses viem's own EIP-1559 fees with no `maxFeePerGas`, so a fee spike during the run is paid in full.

**Fix:** Pass `maxFeePerGas: maxGasWei` (and a matching priority fee) on every send, and treat an underpriced refusal as `gasStopped`.

### [LOW] The cursor is written non-atomically and never floored at the deploy block
**Where:** `warden/src/clock/cursor.mjs:51-54`; `warden/src/clock/run.mjs:960`

**Attacker story:** Nobody external. A crash during `writeFileSync` can leave a truncated number that still parses, such as `4732`. Reconcile then pages from far before the deploy block, times out at 600 seconds, and never advances. This is the silent stall that `cursor.mjs:31-36` exists to prevent.

**Fix:** Write to a temporary file and `rename` it into place. Use `from = max(floor, cursor + 1)`.

### [INFO] The heartbeat keeps running after a sunset
**Where:** `warden/src/clock/run.mjs:753` (no `sunset` argument is passed); `heartbeat.mjs:45,53`; contract `:169`

`heartbeat` has no `notSunset` check. After a sunset, a quiet Clock therefore sends one every 30 days indefinitely. Pass `sunset` from `viewOf(...).sunset` or `isSunset()`.

## Questions

1. **What HTTP status do the facilitators return for a refused settle?** Ask this of both x402.org and CDP. A 4xx with a `{success:false}` body makes the first finding reachable today. A 200 limits it to real timeouts that happen to coincide with a cancel.
2. **Does anything check that a bitmap encodes `https://<MRO_DOMAIN>/t/<id>#` before it becomes permanent?** `worker.mjs:21` trusts `robustSolveFor`, and the Clock writes `qr` without any check (`run.mjs:316`). I did not read `tools/robust-solve.mjs`.
3. **Is there a runbook for a stuck nonce?** `startRun` uses the `pending` nonce (`write.mjs:85`). A `receipt-unknown` transaction that never mines (because it was underpriced) blocks every later send, and nothing in the Clock replaces it.
4. **Can the systemd user manager's environment override `.env`?** Node lets the environment win over `--env-file`. Unlike the Warden's `filter_env` under PM2, the Clock unit filters nothing. Does `environment.d` or `import-environment` carry any variable the Clock reads (`BASE_RPC_URL`, `STATE_DB_PATH`, `MAX_GAS_GWEI`, `CLOCK_*`)?
5. **Should the money check use a second RPC?** The payment check and every simulation trust a single `BASE_RPC_URL`. Is an independent provider worth it for `authorizationState` and the `AuthorizationUsed` lookup, before a row is promoted?
6. **Should the key copies in `~/backups` expire?** `set-contract-address.sh:31-35` copies the whole `.env`, key included, into `~/backups` on every run. After a key rotation, the old keys stay there.

## Out of scope

- The classification logic in `pay/x402.mjs` belongs to the payment area. It is cited above only because it is how rows reach the Clock.
- The door, the MCP tools' gates, renderer escaping, and the deploy pipeline beyond the owner-key default.
- `abi.mjs` (generated), `contracts/lib/**` and `node_modules` beyond the specific library functions cited.

## Coverage

- **SQL:** every statement in `queries.mjs:52-345` is prepared with `?` placeholders. `db.mjs` runs fixed DDL only. I found no path from caller input into SQL text.
- **Poisoned mirror rows:**
  - The chain limits every Clock write on its own: one mint per key, supply and wallet caps, `CODE_BYTES`, a creation day within 30 days, the check-in window, and the Mark gates.
  - Payment status (`queued`) is recorded only in the mirror, by design.
  - The Clock does read the chain for `today()`, `lastWardenDay`, the heal and trim decisions (`lastDay`, `level`) and the TokenExists identity check. It does not read the chain for the seed and Mark bindings (finding above).
- **Key handling:**
  - `cast wallet new` generates the key, and it never reaches argv: `printf` is a shell builtin and derivation reads stdin.
  - The file is set to 0600 before the key is written, and `setup-clock.sh` sets `umask 077`.
  - `.env`, `.env.*` and backup files are gitignored.
  - The rehearsal fixture is anvil's well-known public key.
  - The Clock log is 0600 through `UMask=0077`, and `copytruncate` keeps that mode across rotation.
  - Nothing on the Warden side imports `write.mjs`.
  - `chain/read.mjs` and `preflight.mjs` are read-only, and their error text goes through `safeErrorText` or carries none.
- **Restart mid-batch:**
  - Nonces are explicit, and a `send-failed` does not advance them.
  - `receipt-unknown` stops the check-in pass rather than resending, and the next run heals through `DayNotAdvanced` or `TokenExists`.
  - The `markMintWritten` and `markOrderWritten` pairs are transactional.
  - SIGTERM releases the lock. SIGKILL does not (finding above).
- **Reconcile:** logs are filtered by address in the client as well as by the node. Reads trail the head by 12 blocks. The cursor advances only on a completed reconcile. `MarkApplied` and `Finished` arguments are range-checked.
