I've finished tracing every path and checked the one remaining detail (how a settlement that was sent but never confirmed is reported back). Here is the report.

# Machine Readable Only -- security -- payment path (x402 settlement and the MCP gate)

**Snapshot:** 8d2a0d27e3
**Read:** `reports/32-mro-tm.md`; `CLAUDE.md`; `.claude/rules/warden.md`; `warden/src/pay/x402.mjs`, `warden/src/pay/cdp.mjs`; `warden/src/main.mjs`; `warden/src/mcp/server.mjs`, `mcp/gates.mjs`, `mcp/ladder.mjs`, `mcp/tools/mint.mjs`, `mcp/tools/upgrade.mjs`; `warden/src/server.mjs:400-477`; `warden/src/mirror/queries.mjs:1-260, 500-840`; `warden/src/mirror/schema.sql` (grep for the payment columns); `warden/src/clock/unresolved.mjs`; `warden/src/clock/run.mjs:880-928`; `warden/src/chain/read.mjs:300-475`; `warden/test/settlement-commit.test.mjs:1-329`; `warden/test/paid-refusal-settlement.test.mjs:1-80`; `warden/test/pay.test.mjs` (test names only). Installed libraries: `@x402/mcp dist/esm/index.mjs:740-1135`; `@x402/core dist/esm/chunk-H7ETXA5T.mjs:205-279, 304, 415-640, 1200-1669, 1677-1693, 2007-2020`; `@x402/core dist/esm/facilitator/index.mjs:275-344`; `@x402/evm dist/esm/exact/server/index.mjs:1-140`, `exact/facilitator/index.mjs:88-373, 760-822`, `chunk-KNDFHTKS.mjs`; `@x402/evm dist/cjs/exact/v1/facilitator/index.js` (grep).

## Findings

### [HIGH] A held payment is treated as paid if its nonce was cancelled or used for a different transfer, which gives out free mints and Marks [BLOCKS MAINNET]
**Where:** `warden/src/clock/unresolved.mjs:76-91`, `warden/src/mirror/queries.mjs:676-690`, `warden/src/pay/x402.mjs:341-352` and `:508-526`. Supporting library code: `@x402/core chunk-H7ETXA5T.mjs:513-525` and `:1548-1567`.

**Attacker story:**
- **Who:** any agent with a registered key (keys are free) and a wallet holding the price for as long as the verify step takes. That is 1 USDC for a mint, or up to $1,250 for a Vessel on a token that qualifies.
- **What they send:**
  1. A normal EIP-3009 authorisation (to the treasury, for the correct amount, nonce N).
  2. After the Warden has verified it, but before settlement, they spend nonce N themselves on chain. There are two ways:
     - USDC `cancelAuthorization(payer, N, sig)`; or
     - a second `transferWithAuthorization` they signed with the same N, sending 0.000001 USDC to themselves. Anyone can submit it.
  3. The window is the handler's run between verify and settle: `paidWriteBlock` (five parallel reads), `freeIdFrom` (up to 32 more reads), then the second `paidWriteBlock`. Base produces blocks every 2 s, so the attacker can retry this cheaply.
- **What they gain:** once settlement fails in the "unknown" way (below), the row is held as `payment-unresolved`. At 00:05 the Clock asks USDC `authorizationState(payer, N)`. That returns `true`, because USDC sets the same flag on use and on cancel. The Clock then promotes the row to `queued` and writes it. The result is a free token, or a free Mark worth up to $1,250.00. A free Mark also permanently closes its pair partner.
- **Precondition:** the failed settle has to reach the gateway as a *throw*, not as `success: false`. `HTTPFacilitatorClient.settle` throws `SettleError` for any non-2xx reply that carries a `success` field (`chunk-H7ETXA5T.mjs:513-525`). `settlePayment` then rethrows it (`:1548-1567`). The Warden's observer records a throw as `unresolved` (`x402.mjs:347-351`). So whether this is exploitable depends on how the facilitator's HTTP layer reports a reverted `transferWithAuthorization`. The tests never check that: the fake facilitator only ever answers 200 (`settlement-commit.test.mjs:62-90`), even though that file's own header (`:20-24`) names `cancelAuthorization` as the attack. Mainnet uses CDP, a different facilitator from the one ever measured. A transport error or timeout that happens to coincide produces the same state.

**Why it works:**
- `authorizationState` answers "was this nonce consumed?", not "did this payer pay this treasury this amount?".
- The comment at `unresolved.mjs:13-15` ("records every authorisation it has ever spent") and the docstring at `queries.mjs:664-666` ("true means this exact authorisation was spent") are both wrong for FiatToken. They are also wrong for the second route, where N is spent on a different recipient and amount.
- The held row stores `payer` and `asset` but not `payTo` or `amount`, so the Clock cannot check either.

**Variant:** the Warden also accepts a Permit2 payload. `payNonceOf` and `payerOf` read `permit2Authorization.*` (`x402.mjs:56-75`), and the facilitator chooses EIP-3009 or Permit2 from the payload's shape, not from the requirement (`exact/facilitator/index.mjs:773-821`). The facilitator parses the Permit2 nonce with `BigInt`, so it may be written as a 0x-prefixed 64-digit hex string. That string passes the Clock's `BYTES32` check (`unresolved.mjs:66`). An attacker can therefore cancel EIP-3009 nonce X in advance, then pay by Permit2 with nonce "X", and the Clock's question is answered `true` by the earlier cancel.

**Fix:**
1. When a row is held, also store `payTo` and `amount` (taken from `paymentRequirements`).
2. In the Clock, replace the `authorizationState` read with a log check. Find `AuthorizationUsed(payer, N)` emitted by `asset`, and require the same transaction to contain `Transfer(payer, payTo, amount)` from `asset`. An `AuthorizationCanceled` log, or a transfer to anyone else or for another amount, counts as unpaid.
3. In `withNonce` (`x402.mjs:468-473`), refuse any payload without `payload.authorization` (i.e. refuse Permit2), unless Permit2 is deliberately supported with its own settlement check.
4. Add a test where the fake facilitator answers settle with 400 plus a `SettleResponse` body, and the chain stub reports the nonce as cancelled.

### [HIGH] A settlement whose transaction was sent but not confirmed is treated as a known decline, so the reservation is deleted while the money may have moved [BLOCKS MAINNET]
**Where:** `warden/src/pay/x402.mjs:343-345` and `:493-505`. Supporting library code: `@x402/evm chunk-KNDFHTKS.mjs:23-27, 80-88`, `@x402/core chunk-H7ETXA5T.mjs:1677-1693`.

**Attacker story:** no attacker is needed.
1. An agent pays for any mint or Mark (up to $1,250.00).
2. The facilitator broadcasts `transferWithAuthorization`, but its `waitForTransactionReceipt` fails (RPC hiccup, congestion). It then returns `{ success: false, errorReason: "settlement_pending", transaction: <hash> }`.
3. `@x402/core` retries once. If the second attempt is still pending, it *returns* that `success: false`.
4. The observer records any `!settlement.success` as `declined` (`x402.mjs:343-345`). `releaseReservation` then deletes the mint or Mark row (`queries.mjs:761-773`).
5. The transfer mines anyway. The agent is told "Payment settlement failed", and the `pay_nonces` claim stays in place, so retrying the same authorisation answers `payment-already-used`.

This is exactly the loss the `payment-unresolved` design (`queries.mjs:715-736`) exists to prevent, arriving by a different route.

**Why it works:** the declined-or-unknown split is keyed only on throw versus return. A returned failure that carries a broadcast transaction hash is not a "known failed" payment.

**Fix:** in `observeSettlement`, record `declined` only when the failure carries no `transaction` and `errorReason !== "settlement_pending"`. Record anything carrying a transaction hash as `unresolved`. This must land together with the fix above, because it sends more rows to the Clock's oracle.

### [MEDIUM] Wallet-cap and supply-cap checks ignore mints paid today but not yet written, so over-cap mints are charged and then refused [BLOCKS MAINNET]
**Where:** `warden/src/mcp/gates.mjs:89-110`, `warden/src/chain/read.mjs:414-453`, `warden/src/mcp/tools/mint.mjs:34` and `:81`.

**Attacker story:**
- Mints are written once a day at 00:05. Until then, every paid mint sits in the mirror as `queued`.
- `walletRoomFor(to)` and `supplyRoom()` read only the chain's `mintedTo` and `totalMinted`. So every agent that mints to the same `to` on one UTC day sees the same room. Near sell-out, the whole day's mints all see the same remaining supply. Seeds share the supply count, and `seed` has the same blind spot.
- Every mint beyond the real room settles its payment, then reverts `WalletCap` / `SupplyCap` at the Clock. The Clock keeps it as non-final (`run.mjs:900-903`) and there is no refund path (`run.mjs:238, 422`).
- The same happens to the whole day's queue if the owner lowers `setSupplyCap`.
- A griefer who knows a victim operator's public owner address can fill its remaining wallet room with one $1 mint queued ahead of the victim's.

**Why it works:** `seedBudgetBlock` already subtracts unwritten reservations (`gates.mjs:136-140`). The two money gates in front of a paid mint do not.

**Fix:** subtract the mirror's unwritten rows from both reads:
- For the wallet cap: count `mints` rows for that `toAddress` in `awaiting-payment` / `payment-unresolved` / `queued`, plus unwritten seeds to that address.
- For the supply cap: all unwritten mints plus unwritten seeds.

Do this in the pre-payment gate and again in the post-verify gate.

### [LOW] The expiry sweep deletes possibly-paid reservations after a crash or restart without asking the chain
**Where:** `warden/src/mirror/queries.mjs:788-798`, `:49`.

**Attacker story:** none; this is an operational fault.
1. The Warden process dies (PM2 restart, deploy, out-of-memory) after `settle` was sent but before `onAfterSettlement` promotes the row.
2. The row stays `awaiting-payment`. Ten minutes later any agent's paid call runs `dropExpiredReservations`, which deletes it.
3. The payer has been debited and holds nothing.

**Why it works:** the sweep treats "old and unpromoted" as "unpaid". The payer is not stored at reservation time, so the row cannot be sent to the Clock's check.

**Fix:** store `payer` / `asset` / `payTo` / `amount` in `insertMint` / `reserveMarkPaid`. Have the sweep move expired rows to `payment-unresolved` instead of deleting them. This depends on the corrected Clock check from the first finding.

### [LOW] The gates are re-read before settlement, but the chain write happens up to 24 hours later, with no refund path
**Where:** `warden/src/mcp/tools/upgrade.mjs:249-255`, `mint.mjs:81-85`; `.claude/rules/warden.md` ("a money gate is re-read AFTER settlement").
**Attacker story:** after a paid Mark settles, the token owner calls `rest(id)`, or the operator pauses the piece, before 00:05. `applyMark` then reverts and the payer's money stays with the treasury. The owner and the bound agent are normally the same party, so this is mostly self-harm or an operator action.
**Why it works:** the re-read happens between verify and settle (correctly described in `mint.mjs:53-61`). The project rule claims it happens *after* settlement, which it does not.
**Fix:** correct the rule text. Keep a written manual-refund runbook for `failed` paid rows, since `isFinalMark` makes them permanent.

### [INFO] Origin check also accepts `http://<domain>`
**Where:** `warden/src/server.mjs:435-438`.
The check runs before the door on every signed route, including `/mcp`, and refuses foreign origins, so the MCP MUST is met. Accepting the plain-HTTP origin only matters to someone who can inject a page on the HTTP version of the site, and the door still requires a signature. **Fix:** allow only `https://${domain}`.

### [INFO] The pre-payment `already-minted` check runs before the expiry sweep
**Where:** `warden/src/mcp/tools/mint.mjs:27` vs `:50`.
An expired reservation for this key makes `hasMinted` true until some *other* agent's paid call sweeps it. This contradicts the comment at `:45-49`. No money is at risk. **Fix:** sweep first.

### [INFO] x402 v1 payloads are matched only on scheme and network
**Where:** `@x402/core chunk-H7ETXA5T.mjs:1646-1652`; `@x402/evm cjs/exact/v1/facilitator/index.js:841`.
For v1, the amount and payee are not compared on the Warden side. Safety rests on the facilitator failing on the missing `maxAmountRequired` (`BigInt(undefined)` throws, and the handler never runs). **Fix:** refuse `paymentPayload.x402Version !== 2` in `withNonce`.

## Questions

1. What HTTP status does CDP's `/platform/v2/x402/settle` return when `transferWithAuthorization` reverts, or when the nonce is already used or cancelled: 200 with `success: false`, or a 4xx with a `SettleResponse` body? The same question applies to x402.org. The first finding's exploitability depends on the answer. The fix does not, and should land either way.
2. Is Permit2 meant to be accepted? The server never advertises `assetTransferMethod`, but the facilitator routes by payload shape (`exact/facilitator/index.mjs:773-821`), so a Permit2 USDC payment verifies and settles today. Nothing in `pay.test.mjs` exercises it.
3. `pay_nonces` is keyed on the nonce alone (`schema.sql:216-217`), not on (payer, nonce), and EIP-3009 and Permit2 nonces share that space. With client-random nonces I found no practical collision, but is keying it per payer intended?
4. The `wrappers` cache key includes the token id and variant (`x402.mjs:372`, `upgrade.mjs:327-329`), so it grows by one entry per (token, Mark, variant) that passes the gates. That is bounded by tokens bound to callers, so it is not an outside-attacker issue. Is that growth accepted?

## Out of scope

- The door (RFC 9421 verification, challenge), binding drift between request and Clock write (TM #5), Clock nonce and heal logic, reconcile, the client's signing checks (TM #10), contract access control. Only read where the payment path touches them.
- Settled decisions: the USDC-only price, `MINT_PRICE` as a Warden constant, the `$1250.00` demand string, and the ladder shape. The price guards, `assertLadderSane` and the per-call price were checked and found sound.

## Coverage

**Checked and found sound:**
- **Price binding:** v2 `findMatchingRequirements` compares the whole accepted requirement (amount, asset, payTo, network) against the server's own requirement (`chunk-H7ETXA5T.mjs:2007-2020`). The facilitator then checks `value == requirements.amount` and `to == payTo` (`exact/facilitator/index.mjs:166-194`). The price is per call, taken from `LADDER` / `MINT_PRICE` and rejected if malformed (`x402.mjs:439-442`, `upgrade.mjs:209-212`).
- **Payment flow:** chosen from the server's requirement, not the client payload (`getPaymentFlow` ignores `_payload`, `chunk-H7ETXA5T.mjs:1318-1330`). It resolves to `authorization`: verify before the handler, settle after it.
- **Refusals carry `isError`:** checked on every path. That includes:
  - `cancelSettlementOnRefusal` for each `ok: false` inside `paid()`;
  - the gateway's own `no-price` / `payment-unavailable` refusals;
  - `no-nonce` and `payment-already-used`;
  - handler throws (the library cancels, `index.mjs:943-961`);
  - wrapper-internal errors (`index.mjs:770-778`);
  - `mcp/server.mjs` passing complete results through (`:178`).

  No refusal reaches settlement.
- **Double settlement and reuse:** the `pay_nonces` claim is made inside the reservation transaction, and a reuse is refused before settlement. The same Mark on the same token is blocked by a unique index. The paired Mark (the other side of a pair) is re-read synchronously before insert.
- **Treasury address:** checked for shape, EIP-55 checksum and placeholders off Sepolia (`main.mjs:84-142`). The network is derived from the chain id and checked against the RPC. The facilitator must be HTTPS. Missing CDP credentials refuse boot. CDP JWTs are per path and expire after 120 s.

**Not reviewed in depth:** `gates.test.mjs` and `cdp.test.mjs` (not opened), and the body of `pay.test.mjs` (names only).
