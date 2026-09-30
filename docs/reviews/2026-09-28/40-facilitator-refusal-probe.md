# How x402.org and CDP refuse a settlement, measured

Ruling 7 of the 2026-09-28 review. Measured 2026-09-30 on Base Sepolia
(`eip155:84532`) with `warden/tools/facilitator-refusal-probe.mjs`, which calls
the Warden's own resource server (`initResourceServer`) and prints what its
`settlePayment` returned or threw.

## The three cases

Each is signed by the real client signer and none can move money:

- **expired** -- `validBefore` a day in the past; USDC itself refuses it.
- **overdrawn** -- asks for 1,000,000 USDC from a wallet holding a few.
- **bad-signature** -- one byte of `s` flipped, so the signer does not recover.

Every payment named the burn address as `payTo`.

## What came back

| Facilitator | Case | Returned or thrown | HTTP | errorReason | Transaction |
|---|---|---|---|---|---|
| x402.org | expired | returned `success: false` | 200 | `invalid_exact_evm_payload_authorization_valid_before` | none |
| x402.org | overdrawn | returned `success: false` | 200 | `invalid_exact_evm_insufficient_balance` | none |
| x402.org | bad-signature | returned `success: false` | 200 | `invalid_exact_evm_signature` | none |
| CDP | expired | threw `SettleError` | 400 | `invalid_exact_evm_payload_authorization_valid_before` | none |
| CDP | overdrawn | threw `SettleError` | 400 | `invalid_payload` | none |
| CDP | bad-signature | threw `SettleError` | 400 | `invalid_exact_evm_payload_signature` | none |

CDP was reached pinned to IPv4, as the Warden runs.

## What it means

- **x402.org refuses with a 200.** The Warden already reads that correctly:
  no hash and a known pre-broadcast reason is a decline, released at once.
- **CDP refuses with a 400, which @x402/core throws as a `SettleError`.** The
  Warden treated every throw as unknown, so on CDP -- the mainnet facilitator
  -- every plain refusal would have held the agent's reservation until the
  next 00:05 UTC. Plan C Task 3 judges a thrown `SettleError` exactly as a
  returned answer.
- **CDP spells two reasons differently.** `invalid_exact_evm_payload_signature`
  is a bad signature, which can never move money, so it joins the
  pre-broadcast allowlist. `invalid_payload` is generic (here it wrapped a
  reverted balance simulation), so it stays unknown and is held: a wrong
  release could lose an agent's payment, while a wrong hold costs one night.
- These are Base Sepolia answers. CDP's mainnet answers are assumed to take the
  same shape and have not been measured.
