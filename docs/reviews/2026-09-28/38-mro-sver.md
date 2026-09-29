# Machine Readable Only -- security -- verified

**Snapshot:** 8d2a0d27e3
**Findings in:** 43 -- **after merging:** 40

Inputs: the threat model (32) and all five area reports (33-37) were present, and none said FAILED. The `node_modules` trees are **not in this snapshot**. That covers `@x402/*`, `@noble/curves`, `http-message-sig`, `web-bot-auth` and PM2. So I could not open any claim that rests on library internals. Where a verdict depends on one, it says so, and it uses the project's own tests as evidence instead.

## Summary

- **Severity after corrections:** Critical 0, High 5, Medium 4, Low 17, Info 14.
- **[BLOCKS MAINNET]:** 7. These are the seed binding drift, the door dot-segment bypass, the held-payment oracle, the settlement-pending release, the cap gates ignoring unwritten mints, the Clock key reachable from the Warden, and the hot owner key.
- **Verdicts:** CONFIRMED 34, PLAUSIBLE 5, UNVERIFIED 1, REFUTED 0.
- **Merges:**
  - 33-H1 + 36-M1 (seed spends the write-time key).
  - 35-H1 + 36-H1 (cancelled authorisation treated as paid).
  - 36-H2 + the Clock-key half of 37-M1. The owner-key half of 37-M1 converges with 36-H3 and is noted there.
- **One settled decision re-raised, and the premise is false in the code.** The `rebind` acceptance rests on "the Warden re-checks the signature against the current on-chain binding". That check happens at request time. The Clock's `seed` write happens up to a day later and re-checks nothing, and the contract reads the binding at write time (see High 1).

## Critical

None.

## High

### [CONFIRMED] `seed` spends the seed of whichever key is bound when the Clock writes, not the key that asked [BLOCKS MAINNET]
*(merged: 33 High 1, 36 Medium 1)*

**Where:** `contracts/src/MachineReadableOnly.sol:839-884`:
- budget check `:854` via `seedsAvailable` `:826-833`;
- key read `:857`;
- charge `:875`;
- `rebind` at `:793-800`.

Off chain:
- `warden/src/clock/run.mjs:439-451` sends `seed` with no key argument and no re-read.
- `warden/src/mcp/tools/seed.mjs:53-58,103-110` checks binding and budget only when the request is made.
- `warden/src/mirror/queries.mjs:278` selects `agentKeyId` for the seed pass, and nothing uses it.

**Attacker story:**
1. The owner of a whole token P (bound to key KA, with one seed open) calls `seed` signed by KA. Every gate passes and a child row is reserved.
2. Before 00:05 UTC, the owner calls `rebind(P, KB)`. KB is any victim key with an open seed; all keys are public through `viewOf(id).agentKeyId`.
3. The Clock sends `seed(child, P, to, code, day)`. The contract charges `_seedsSpent[KB]` and gives the child KB.
4. The attacker rebinds P, and the child, back to KA.

After that:
- KA's on-chain budget is untouched, and the row is `written`, so `seedBudgetBlock` (`gates.mjs:136-140`: chain `seedsAvailable` minus unwritten rows) passes again the next day.
- The attacker gets one free child per day. Each victim loses its once-a-year seed.
- An honest sale in the same window does the same to a buyer.
- The attack is latent until some key passes its first anniversary.

**Fix:** Add `bytes32 expectedKeyId` to `seed` and revert on `_agentKeyOf[parentId] != expectedKeyId`. Have the Clock pass the reservation's key, and add the new error to `isFinalSeed`. It has to go into the bytecode at the redeploy that is already planned. A Clock-side pre-read of `viewOf(parentId).agentKeyId` is a useful interim guard, but it leaves a window of seconds at a predictable 00:05. Add the test: request, rebind, write must revert.

- **Reachability:** Holds. Opened the contract `seed` / `rebind` / `seedsAvailable`, `run.mjs:439-451`, `seed.mjs` and `gates.mjs`. The seed pass reads nothing about the binding before sending.
- **Impact:** Holds. `_seedsSpent[key]` is keyed on the write-time key (`:857,:875`), and `unwrittenSeeds` (`queries.mjs:93-96`) stops counting once the row is written.
- **Defences:** None. `rebind` is `onlyTokenOwner` and not pausable, and there is no key argument anywhere on the write path.

### [CONFIRMED] A dot-segment request target gets past the domain pin, so a signature made for another site verifies here [BLOCKS MAINNET]
*(35 High 1)*

**Where:** `warden/src/door/middleware.mjs:35-39` (`pinnedUrl`), used at `:17`, `:109`, `warden/src/server.mjs:183` and `:468`.

**Attacker story:**
1. A site operator ("evil.example") gets an agent to sign `POST https://evil.example/mcp` covering the five required components.
2. They forward it within its window to the Warden with target `/.//evil.example/mcp` (or `/%2e//...`, `/a/..//...`), plus a fresh `challenge` / `challenge-response` pair. Both are free and neither is signed.
3. `new URL("/.//evil.example/mcp", origin).pathname` is `//evil.example/mcp` (WHATWG dot-segment removal). Rebuilding it with `new URL(pathname, origin)` makes it protocol-relative, so the host becomes `evil.example` and the path `/mcp`.
4. The router dispatches `/mcp` while the signature is checked against `@authority: evil.example`.
5. Key lookup succeeds either way:
   - If `Signature-Agent` names evil.example, the Warden fetches the attacker's directory, which can republish the victim's public JWK. This site's own directory is public.
   - Otherwise the victim's registered key is read from the mirror.
6. The worst in-body effect is a `seed` with an attacker `to` (spending the victim's year), or a free earned Mark that closes its pair.
7. A paid call does not move money: the payload's `payTo` would not match.

**Fix:**
- Build from the origin and assign the path through the setter (`u = new URL(origin); u.pathname = ...; u.search = ...`). Then assert `u.host === domain`, and refuse any target that does not start with exactly one `/`.
- Add tests for `/.//x/mcp`, `/%2e//x/mcp`, `/a/..//x/mcp`.
- The existing tests cover only `//evil.example/mcp` and `http://evil.example/mcp` (`warden/test/door.test.mjs:48-60,839-861`).

- **Reachability:** Holds at the origin. `nginx.conf.example:141-142` has `location /` with `proxy_pass` and no URI part, so the raw request URI is forwarded. The origin lock is commented out at `:84`. Through Cloudflare it is not settled (see Questions). The URL result is derived from WHATWG rules, not executed.
- **Impact:** Holds. `verify.mjs:128` requires `@authority`, and `http-message-sig` takes the authority from the URL `toRequestLike` builds. `admit` returns the verified keyId (`middleware.mjs:182`) into the MCP handler (`server.mjs:468`).
- **Defences:** None that apply. `spent` is keyed on the base signed for evil.example, so it is unspent here. The Origin check (`server.mjs:436`) only acts when an `Origin` header is sent, and the attacker can strip it.

### [CONFIRMED] A held payment is promoted to paid when its EIP-3009 nonce was cancelled or spent on another transfer: a free mint, or a free Mark up to $1,250 [BLOCKS MAINNET]
*(merged: 35 High 1, 36 High 1)*

**Where:**
- `warden/src/clock/unresolved.mjs:66,76-91,101-110`;
- `warden/src/mirror/queries.mjs:676-699` (and its docstring at `:664-666`);
- `warden/src/pay/x402.mjs:341-352` (every throw is labelled `unresolved`), `:508-526` (unresolved is held);
- `warden/src/pay/x402.mjs:56-75` (`payNonceOf` / `payerOf` also accept `permit2Authorization`).

**Attacker story:**
1. An agent pays with nonce N.
2. After verify and before settle (the handler makes several chain reads), it spends N itself: either USDC `cancelAuthorization`, or a second `transferWithAuthorization` with the same N for a dust amount to itself.
3. If the facilitator's refusal reaches `settlePayment` as a throw, the row is held as `payment-unresolved`.
4. At 00:05 the Clock asks `authorizationState(payer, N)`. FiatToken sets that flag on use and on cancel, so it answers `true`.
5. The row is promoted to `queued` and written in the same run.

- A failed attempt costs only the cancel's gas.
- **Permit2 variant:** a Permit2 nonce written as 0x plus 64 hex passes the `BYTES32` regex (`unresolved.mjs:44,66`). The oracle then answers about an unrelated EIP-3009 nonce the attacker cancelled beforehand. This depends on facilitator behaviour I could not open.

**Fix:**
1. Store `payTo` and `amount` on the held row.
2. In the Clock, decide "paid" from an `AuthorizationUsed(payer, N)` log emitted by `asset`, plus a `Transfer(payer, payTo, amount)` in the same transaction. Treat `AuthorizationCanceled`, or any other recipient or amount, as unpaid.
3. Refuse payloads without `payload.authorization` in `withNonce` (`x402.mjs:468-473`), unless Permit2 is deliberately supported with its own check.
4. Classify a facilitator's explicit refusal as `declined`. Only transport errors, timeouts and pending should count as unresolved.

- **Reachability:** Plausible, and not fully settled from the snapshot. The library that decides throw versus return is absent, and the remote facilitator's HTTP behaviour is unknown. But the project's own test shows that any facilitator answer failing `@x402/core`'s response schema throws and is held (`warden/test/settlement-commit.test.mjs:77-81,93,211-215`). The fake facilitator only ever answers 200 (`:66-68`).
- **Impact:** Holds. `resolveUnresolvedPayment(..., { paid: Boolean(spent) })` (`unresolved.mjs:91`) promotes on a bare boolean. The held row carries only `payer` and `asset` (`queries.mjs:169-171`), so no amount or recipient can be checked.
- **Defences:** None. The promotion alert (`unresolved.mjs:107-110`) is a log line, and the row is written the same night.

### [CONFIRMED] The Clock key is readable, and the Clock's code writable, by the internet-facing Warden [BLOCKS MAINNET]
*(merged: 36 High 2, and the Clock-key and infra-token half of 37 Medium 1)*

**Where:**
- `warden/ecosystem.config.cjs:41-45`: the Warden loads `--env-file=.env`, which holds `CLOCK_PRIVATE_KEY`. No `uid`, no sandbox.
- `warden/src/main.mjs:54-69`: `delete process.env.CLOCK_PRIVATE_KEY`, whose own comment says "defence in depth, not a boundary".
- `warden/deploy/mro-clock.service:11,27,38`: `ReadWritePaths` covers the whole `warden/` tree, source included.
- `ecosystem.config.cjs:66-73`: the operator shell carries a Cloudflare token, two GitHub tokens and the CDP key.

**Attacker story:** Code execution in the Warden runs as the same user as the Clock. That user can do either of two things:
- read `warden/.env` and take the warden role;
- edit `warden/src/clock/*.mjs` or `node_modules`, which the Clock runs with the key at 00:05. Key rotation does not stop this.

With the warden role, the attacker can:
- mint without paying, with any permanent bitmap (`:342-380`);
- credit visits and take finishing places (`:499-544`);
- apply unwanted Marks that close pairs forever (`:700-761`);
- spend any key's seed (`:839-884`);
- sign vouchers once they are enabled;
- drain the gas balance.

Everything written stays written. The project rule "The Warden holds NO private key" (`.claude/rules/warden.md`) is false in practice.

**Fix:**
- Run the Clock as its own system user, with a read-only code tree and a key file only it can read, kept outside `warden/` and outside the Warden's `.env`.
- Narrow `ReadWritePaths` to the state directory.
- Run the Warden from a sandboxed unit.
- Keep the GitHub and Cloudflare tokens off this host.
- Interim steps: a separate key file loaded only by the Clock, a small ETH float, and an alert on nonce jumps.

- **Reachability:** Holds, conditional on an RCE in the Warden. Nothing in the files above separates the two processes.
- **Impact:** Holds. Opened each `onlyWarden` function in the contract.
- **Defences:** None beyond `setWarden` after the fact. The Clock's systemd sandbox protects a tree the Warden can write.

### [CONFIRMED] The mainnet owner key's documented home is a hot file on the same box [BLOCKS MAINNET]
*(36 High 3; converges with the owner-key half of 37 Medium 1)*

**Where:**
- `contracts/.env.example:13-25`;
- `contracts/script/deploy-mainnet.sh:28-31` (moving ownership to a Safe is only "prefer"), `:86-93` (`set -a; . ./.env` exports the key).

**Attacker story:** The same compromise as above can read `contracts/.env` if the key is left there. That gives the permanent owner:
- `setRenderer`, which changes or bricks every image;
- `sunset`, which is irreversible;
- `setWarden`;
- `setUpgrade` on Marks already sold.

**Fix:**
- For chain 8453, require `--ledger` or a keystore with `--account` rather than a plain-text key.
- Make the `Ownable2Step` handover to a Safe a checked pass criterion of the cutover (assert `owner()`).

- **Reachability:** Holds, conditional on a box compromise and on the key staying on disk. Nothing in the script removes it or checks the handover.
- **Impact:** Holds. Opened the owner dials `:238-278` and `:672-693`.
- **Defences:** None enforced.

## Medium

### [CONFIRMED] A settlement returned as `success: false` is always released, even when it carries a broadcast transaction [BLOCKS MAINNET]
*(35 High 2; lowered to Medium: no attacker gain, a remote-facilitator condition I could not open, and the money sits in the operator's treasury, so it is refundable by hand)*

**Where:**
- `warden/src/pay/x402.mjs:343-345`: any `!settlement.success` is recorded as `declined`, and `transaction` is ignored.
- `x402.mjs:493-505`: `declined` means release.
- `queries.mjs:761-773`: `releaseReservation` deletes the rows.

**Attacker story:** None; the loser is an honest agent.
1. A facilitator reports "pending" or failed with a transaction hash.
2. The row is deleted.
3. The transfer mines anyway. `pay_nonces` keeps the claim, so a retry answers `payment-already-used`.

**Fix:** Record `declined` only when there is no `transaction` and the reason is not pending. Treat anything carrying a hash as unresolved. Land this together with the oracle fix above.

- **Reachability:** Unverified. It depends on the facilitator ever returning that shape, and the library is not in the snapshot.
- **Impact:** Holds (opened `x402.mjs` and `queries.mjs`).
- **Defences:** None.

### [CONFIRMED] Eight slow directory hosts can hold every third-party key lookup
*(35 Medium 1)*

**Where:**
- `warden/src/door/directory.mjs:238` (`timeout` is an idle socket timeout), `:279`;
- `:404`, `:471-481` (process-wide `MAX_INFLIGHT_FETCHES = 8`);
- `verify.mjs:345-354` (the lookup runs before the cryptography).

**Attacker story:**
1. An unauthenticated caller sends eight requests, each naming its own `Signature-Agent` host.
2. Each host trickles bytes and never goes idle, so the 3 s timeout never fires.
3. While the slots are held, every other third-party lookup throws `too many directory fetches in flight`.
4. Keys registered through `POST /keys` (the reference client) are unaffected.

**Fix:**
- Add an absolute deadline per fetch (`AbortSignal.timeout` or a timer that destroys the request).
- Add a per-registrable-domain in-flight cap.

- **Reachability:** Holds. Nginx meters only `/keys*`, and `allowToolCall` runs after `admit` (`server.mjs:456`).
- **Impact:** Holds for the self-hosted-directory cohort only.
- **Defences:** None against trickling.

### [CONFIRMED] Wallet-cap and supply-cap gates ignore paid-but-unwritten mints, so over-cap mints are charged and then refused [BLOCKS MAINNET]
*(35 Medium 1)*

**Where:**
- `warden/src/mcp/gates.mjs:89-110`;
- `warden/src/chain/read.mjs:414-453` (both read only `mintedTo` / `totalMinted` from the chain);
- `warden/src/mcp/tools/mint.mjs:34,81`.
- **Line correction:** the Clock keeps these mints queued through the generic failure path at `run.mjs:363-392`, not `:900-903`, which is the seed comment.

**Attacker story:**
1. Everyone minting to one `to` in one UTC day sees the same room. So does everyone buying near sell-out.
2. The mints beyond the real room settle their payment, then revert `WalletCap` / `SupplyCap` at the Clock.
3. They are retried nightly until `StaleDay`, then stuck. There is no refund path.

`seedBudgetBlock` already subtracts unwritten rows (`gates.mjs:136-140`). These two gates do not.

**Fix:** Subtract the mirror's unwritten mint and seed rows (by `toAddress` for the wallet cap, all of them for the supply cap), before payment and again after verify.

- **Reachability:** Holds.
- **Impact:** Holds. The contract enforces both caps at `:356-357` and `:851-852`.
- **Defences:** None.

### [CONFIRMED] A killed Clock run leaves its lock behind and halts every later run

*(36 Medium 2)*

**Where:**
- `warden/src/clock/main.mjs:94-112` (`wx` lock, no PID or boot id), `:205-226` (released only on SIGTERM/SIGINT and in `finally`);
- `mro-clock.service:59-60` (`MemoryMax=1G`, OOM kill);
- `reconcile.mjs:66-91` (every event of the window is held in memory, and a too-large page is never split).

**Attacker story:**
- An OOM kill or a power loss leaves `state.db.run-lock` on disk. Every later run throws at `takeLock`.
- After 30 days, queued paid mints hit `StaleDay`. The heartbeat also stops.
- The only signals are a non-zero exit and log lines. There is no `OnFailure=`.
- The outsider lever (flooding `Transfer` events to OOM reconcile) is unmeasured and looks expensive. The finding rests on SIGKILL alone.

**Fix:**
- Put the PID and boot id in the lock and reclaim it when that process is gone, or use `RuntimeDirectory=`.
- Add `OnFailure=` with an external alert.
- Apply reconcile events page by page.

- **Reachability:** Holds for OOM and power loss.
- **Impact:** Holds.
- **Defences:** None automatic.

## Low

### [PLAUSIBLE] With vouchers on, finishing places go to whoever submits first
*(33 Medium 1; lowered: vouchers ship disabled, which is settled, and nothing in `warden/src` signs vouchers)*

**Where:** `MachineReadableOnly.sol:581-610`, `_credit` `:442`, `_finish` `:468-475`; the NatSpec at `:462-465`.

A voucher for day D can land at 00:00:01 on D, ahead of the Clock's D-1 batch at 00:05. Places are the order of `++finishers`.

**Fix:** Decide before the redeploy. Either refuse the finishing credit on the voucher path while `lastWardenDay` is recent, or write "first-come on the voucher path" into the spec and correct the NatSpec.

- **Reachability:** Does not hold today. `vouchersEnabled` is false, and a grep of `warden/src` for "voucher" finds only `abi.mjs` and `gates.mjs`.
- **Impact:** Holds if enabled while the Clock runs.
- **Defences:** The owner-only toggle and the absence of a signer.

### [CONFIRMED] A pause or Clock outage over 30 days leaves every paid-but-unwritten mint stuck
*(33 Low)*

**Where:** `MachineReadableOnly.sol:342-347`, `:397`, `:401-405`; `run.mjs:357-362`.

**Fix:** Add it to the runbook: drain or re-date rows before a long pause. Note the 30-day limit beside `pause()`.

### [CONFIRMED] A Warden key can backdate the first tokens before deployment, a 30-day head start to Apex
*(33 Low)*

**Where:** `MachineReadableOnly.sol:401-405` (no floor at deploy), constructor `:171-183`, `:372`.

`batchCheckIn` accepts the same id several times in one call with rising days (`:515-535`), so 30 days can be back-filled in one transaction.

**Fix:** Record `DEPLOY_DAY` in the constructor and refuse `day < DEPLOY_DAY`. Reachable only with the Clock key (High 4).

### [CONFIRMED] The five-second challenge is not tied to the signature
*(35 Low)*

**Where:** `middleware.mjs:161-164`; `verify.mjs:128` (`challenge` is not in `REQUIRED`); `challenge.mjs:84`.

The answer is `sha256(challenge + keyId)`, computed from public inputs, so a relayer can supply it. This is what makes the dot-segment High a single step.

**Fix:** Make `challenge` a covered component, or bind the signature `nonce` parameter to an issued challenge.

### [CONFIRMED] Replay protection lives only in process memory
*(35 Low)*

**Where:** `server.mjs:126-133`; `ecosystem.config.cjs:59-61,93`.

**Fix:** Refuse any signature whose `created` is before process start, or persist `spent`.

### [CONFIRMED] The expiry sweep deletes possibly-paid reservations after a crash
*(35 Low)*

**Where:** `queries.mjs:236-239,788-798`, `:49`.

A restart between the settle and the hook leaves the row `awaiting-payment`. It is deleted ten minutes later, and no payer was stored.

**Fix:** Store payer, asset, payTo and amount at reservation time. Move expired rows to `payment-unresolved` instead of deleting them. This depends on the corrected oracle.

### [CONFIRMED] Gates are re-read before settlement, not after; the rule text says otherwise
*(35 Low)*

**Where:** `upgrade.mjs:249-255`, `mint.mjs:81-85`; `.claude/rules/warden.md` ("re-read AFTER settlement").

A `rest()` before 00:05 makes a paid Mark revert `Resting`, which `isFinalMark` (`run.mjs:821-829`) makes permanent.

**Fix:** Correct the rule text and write a manual-refund runbook.

### [CONFIRMED] A child that landed and was then transferred is deleted from the mirror
*(36 Low)*

**Where:** `run.mjs:193-205` (the owner comparison), `:473-488` (`dropSeed`); the mint shape is at `:167-179,336-350`.

**Fix:** Identify the child by `parent` plus `code`, and drop the owner comparison.

### [CONFIRMED] The gas cap is checked once and never binds what is sent
*(36 Low)*

**Where:** `write.mjs:96-99` (`gasOk`); `:166-176` (no `maxFeePerGas`).

**Fix:** Pass `maxFeePerGas` on every send.

### [PLAUSIBLE] The cursor is written non-atomically and never floored at the deploy block
*(36 Low)*

**Where:** `cursor.mjs:51-54`; `run.mjs:960`.

The missing floor is confirmed. A truncated-but-parseable cursor is improbable for an 8-byte write.

**Fix:** Write to a temporary file and rename it; use `max(floor, cursor+1)`.

### [CONFIRMED] PM2 `filter_env` is a substring denylist, and it is not reapplied on a restart from the config file
*(37 Low)*

**Where:** `ecosystem.config.cjs:90`.

The list misses `GITHUB_PAT`, `MNEMONIC`, `*_PASS`, keyed `*_RPC_URL` and `NODE_OPTIONS`. That part is confirmed. The PM2 restart-path internals (`API.js`, `God/ActionMethods.js`) are outside the snapshot. `warden.md` itself says to use `pm2 delete` plus `pm2 start`.

**Fix:** Load `.env` with `util.parseEnv` inside `main.mjs`, and allowlist `process.env`.

### [CONFIRMED] Re-running `install-warden-site.sh` drops the origin lock and `real_ip`, and the rate-limit installer then skips them
*(37 Low)*

**Where:**
- `install-warden-site.sh:48` (`sed ... > "$SITE"` overwrites the live vhost);
- `nginx.conf.example:63` (zone declared), `:84,101-102` (lock and `real_ip` commented out);
- `install-nginx-rate-limits.sh:66-69` (skips when `zone=mro_keys` is already present).

**Fix:** Refuse to overwrite an existing vhost, or re-run the lock script afterwards. Check `real_ip_header` separately.

### [CONFIRMED] The push and publish guards have no secret-shaped rules, skip `docs/reviews/`, and `.gitignore` misses `*.env`
*(37 Low)*

**Where:** `tools/prepublish-check.mjs:65,67-123`; `.gitignore:20-24`.

**Fix:** Add rules for 64-hex keys (with the anvil allowlist), JWK `"d":`, `*_KEY=`, keyed RPC paths and PEM headers. Add `*.env`.

### [CONFIRMED] The pre-push hook scans `@{u}..HEAD`, not the refs being pushed
*(37 Low)*

**Where:** `.githooks/pre-push:42-49`. Stdin is never read.

**Fix:** Scan each `remote_sha..local_sha` from stdin.

### [PLAUSIBLE] `publish-client.yml` grants `id-token: write` to a job that runs install scripts
*(37 Low)*

**Where:**
- `publish-client.yml:48-50` (`id-token: write`);
- `:61,68` (actions pinned by tag);
- `:84` (`npm@latest`);
- `:111,126` (`npm ci` with scripts enabled).

The workflow can only stage (`:18-31,195`). The remaining gate is the 2FA approval, which I could not verify (external).

**Fix:** Split the workflow into a test job and a publish job, pin by SHA, and use `--ignore-scripts`.

### [CONFIRMED] The client identity file has no mode or owner check on load, and falls back to the working directory when `HOME` is unset
*(37 Low)*

**Where:** `client/src/keys.mjs:19-21,89-92`. Compare `cli.mjs:288-302`, which does check the wallet key file's mode.

**Fix:** Use `fstat` and refuse loose modes. Use `os.homedir()` and throw when it is empty.

### [CONFIRMED] The documented mainnet mint puts the funding wallet key on a command line
*(37 Low)*

**Where:**
- `warden/DEPLOY.md:605-609`;
- `DEPLOY.md:614` calls `--expect-amount` optional, which contradicts `client/src/pay.mjs:111` (mandatory);
- `cli.mjs:176` does not format-check `MRO_WALLET_KEY`.

**Fix:** Use `--wallet-key-file` created by a `read -s` helper, and correct `DEPLOY.md:614`.

## Info

- **[CONFIRMED] `_safeMint` lets a recipient contract cost the Clock one reverted transaction a night** *(33 Low, lowered).*
  - Where: `:378`, `:881`, and `run.mjs:393-404`. `reverted-on-chain` is not run-level.
  - Impact is gas-only, capped at about 30 nights by `StaleDay`, and costs the attacker $1 per key. That is roughly break-even griefing.
  - Fix: use `_mint`, since the Warden already checks receivers.
- **[CONFIRMED] The wallet cap limits an address, not an actor** *(33).* `:82,:357,:852`.
- **[CONFIRMED] Test gaps.**
  - `MachineReadableOnly` has no negative `acceptOwnership` / `transferOwnership` test. The only owner-revert selector checks are at `MachineReadableOnly.t.sol:108` and `AccessControlGaps.t.sol:147-153`; the spike has its own.
  - There is no paused-state test for `rest` / `rebind`.
  - There is no request-rebind-seed test.
- **[CONFIRMED] The spike comment contradicts the real contract** *(33).* `MROSpikeToken.sol:209-212` says the real contract emits over minted ids. `MachineReadableOnly.sol:269-278` emits no metadata event.
- **[CONFIRMED] Challenge burn is bypassed by lenient hex parsing** *(35 Low, lowered).* `challenge.mjs:16-21,82-87`. It is reachable and one challenge admits several requests, but the `spent` set on the signature base (`middleware.mjs:151`) makes it moot.
- **[CONFIRMED] A one-hour success cache hides newly added keys** *(35).* `directory.mjs:374,457-465,497-501`.
- **[CONFIRMED] Outbound directory fetch guards hold** *(35).* `directory.mjs:172-283`. No gap found.
- **[CONFIRMED] `CHALLENGE_SECRET` is checked for presence only** *(35).* `main.mjs:81`.
- **[CONFIRMED] The Origin check also accepts `http://<domain>`** *(35).* `server.mjs:436`.
- **[CONFIRMED] The pre-payment `already-minted` check runs before the sweep** *(35).* `mint.mjs:27` runs before `:50`, and `hasMinted` counts any row for the key (`queries.mjs:259`), which contradicts the comment at `mint.mjs:45-49`.
- **[CONFIRMED] Redaction** *(36 Low, lowered).*
  - The private-key half fails on impact: a value of 0, or at or above the curve order, is not a usable key, so logging it discloses nothing that controls an account.
  - The other half holds: `unresolved.mjs:87` logs `err.shortMessage ?? err.message` without `safeErrorText`. It is low risk because viem's `shortMessage` is URL-free per `redact.mjs:12-21`.
  - The noble internals are not in the snapshot.
- **[CONFIRMED] The heartbeat keeps running after a sunset** *(36).* `heartbeat()` has no `notSunset` (`:169`), and `run.mjs:727-771` skips it only when a write aborted.
- **[PLAUSIBLE] An IP-allowlist origin lock admits any Cloudflare customer's proxied traffic** *(37).* This is general Cloudflare behaviour. `enable-origin-lock.sh` was not opened; the template describes an IP map (`nginx.conf.example:104-106`).

## Refuted, plausible and unverified

- **Refuted:** none.
- **Plausible (5):**
  - The voucher finishing race: not reachable while vouchers are off.
  - The cursor truncation: the floor is missing, but truncation is improbable.
  - The publish workflow: the defence is 2FA staging.
  - Redaction: the key half has no impact.
  - The origin-lock allowlist: the script was not opened.
- **Unverified (1):** **[INFO] x402 v1 payloads matched only on scheme and network** *(35).* All cited code is in `@x402/core` / `@x402/evm`, which are absent from the snapshot. I checked `x402.mjs`: it does not filter on `x402Version`, so the suggested `withNonce` refusal would be new, harmless and cheap.

## Corrections made

- Merged the three duplicate pairs listed in the Summary. 37 Medium 1 is split across the Clock-key High and the owner-key High.
- **Severity changes:**
  - Settlement-pending release: High to Medium (no attacker gain, unverified facilitator condition, refundable).
  - Voucher ordering: Medium to Low (off by settled decision, no signer exists).
  - Challenge hex: Low to Info (moot behind `spent`).
  - `_safeMint`: Low to Info (break-even gas griefing, capped by `StaleDay`).
  - Redaction: Low to Info (the leaked value is not a key).
- The seed finding stays High and blocking, although 36 rated it Medium: it is repeatable by an attacker, and the only atomic fix is in bytecode at the planned redeploy.
- **Line corrections:**
  - The wallet/supply-cap finding's Clock reference is `run.mjs:363-392` (the generic mint failure path), not `:900-903`.
  - The seed-pass query selecting the unused `agentKeyId` is `queries.mjs:278`.
  - The real `sunset()` body is `MachineReadableOnly.sol:273-278`, with NatSpec at `:269-272`.
  - The owner-revert tests on the real contract are `MachineReadableOnly.t.sol:108` and `AccessControlGaps.t.sol:147-153`.
- **Reachability evidence added to the oracle finding:** `warden/test/settlement-commit.test.mjs:77-81,211-215` proves that a schema-failing facilitator reply throws and is held as unresolved. So exploitability does not rest on non-2xx status alone.
- **Premise check on the settled `rebind` decision:** false for `seed` at write time. Earned Marks share the same gap: `run.mjs:660` sends `applyMark` with no binding re-check, and `upgrade.mjs:175-185` checks binding only at request time.

## Questions still open

1. **Cloudflare path handling** (decides the door High's exposure through the proxy). Is "Normalize URLs to origin" on, or a WAF rule refusing `/./` and `//`? Is the origin lock actually live in production, as `DEPLOY.md` claims, when the template has it commented out? A signed probe of `POST /.//example.org/mcp` settles both.
2. **Facilitator refusal shape.** What do x402.org and CDP return when `transferWithAuthorization` fails on a used or cancelled nonce, and when a settle is pending with a hash: 200 with `success:false`, non-2xx, or a body without `transaction`? This affects the likelihood of both payment findings, not whether they need fixing.
3. **Permit2.** Is it meant to be accepted? The Warden deliberately reads both envelopes (`x402.mjs:50-58`). Whether the facilitator settles a Permit2 USDC payload for an `exact` requirement could not be checked here.
4. **Earned Marks and binding drift** (33 Q1, settled in fact): the Clock sends `applyMark` with no key check. Whether that is accepted is a policy call, because an `expectedKeyId` there would also cost a legitimate rotation a paid Mark.
5. **Voucher trigger** (33 Q2, settled in fact): no voucher-signing code exists in `warden/src`. Whether a future signer runs alongside the Clock decides the voucher fix.
6. **`supplyCap` below `totalMinted`, and an unbounded `walletCap`** (`:246-255`): confirmed in code. Deliberate or not is the owner's call.
7. **Bitmap domain check** before `mint` / `seed` writes `code` for ever (36 Q2): `tools/robust-solve.mjs` was not opened.
8. **Still open as asked in the area reports:**
   - the stuck-nonce runbook (`write.mjs:85` uses the pending nonce);
   - systemd user-manager environment overriding `.env`;
   - a second RPC for the payment oracle;
   - `~/backups` key copies;
   - npm stage approval semantics;
   - GitHub org and branch protection (`publish-client.yml:57`);
   - `NODE_OPTIONS` in the operator shell;
   - PM2 log and dump file modes;
   - `pay_nonces` keyed on the nonce alone;
   - growth of the `wrappers` map (`x402.mjs:372`);
   - `@query` not required (`verify.mjs:128`);
   - `sigHash` whitespace collapse.
