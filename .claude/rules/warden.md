---
paths:
  - "warden/**"
  - "client/**"
---

# Warden, Clock and client rules

Loaded only when working under `warden/` or `client/`.

## Architecture invariants

- **The Warden holds NO private key.** Every chain write is the Clock's. The
  signer is separated on chain and proven in both directions.
- **`BASE_RPC_URL` is load-bearing for EVERY write**, not just the rebind
  re-check, because the gates are read live from the chain.
- **A gate is read from the CHAIN, never from the mirror.** WalletCap, Resting,
  notSunset, whenNotPaused and SupplyCap. Cache a gate only in the direction the
  contract makes one-way; an unreadable RPC **REFUSES rather than admits**; a
  money gate is re-read AFTER settlement. Five gates have been found this way,
  the fifth two review waves after a document declared the set complete -- so
  read the contract's modifiers, not the design doc.
- **The Warden's rebind re-check is a SECURITY CONTROL**: it must read the
  chain, never its own database.
- **Read the contract's `today()`, never the box's clock.** The check-in window
  is one UTC day wide on chain (`lastDay < day <= today()`), so a second run in
  a UTC day gets `FutureDay`.

## The database

- **`schema.sql` is exec'd WHOLE on EVERY open**, not only at creation. So
  **nothing in `schema.sql` may reference a column `migrate()` adds** -- that
  ordering crash-looped production once. A conditional index belongs in
  `migrate()`.
- **`cp state.db` IS NOT A BACKUP.** WAL means the main file can be stale
  against newer WAL data. Use `VACUUM INTO`.

## Payment

- **A paid row is a RESERVATION.** It lands as `awaiting-payment` carrying the
  EIP-3009 nonce; only `hooks.onAfterSettlement` promotes it to `queued`. There
  is NO settlement-failure hook in `@x402/mcp`, so the gateway watches whether
  the success hook fired for its own nonce.
- **A refusal must carry `isError`**, or x402 settles it anyway and the agent
  pays for nothing.
- **One payment authorisation buys exactly one thing** (`pay_nonces`, written
  BEFORE the claim).
- The testnet facilitator is `https://x402.org/facilitator`. The spec's
  `https://facilitator.x402.org` DOES NOT RESOLVE. Mainnet is CDP's and needs a
  key -- **the key on the box is currently REFUSED**, so mainnet payment is
  impossible until that is fixed.
- The mint price is the Warden constant `MINT_PRICE`, **not** an on-chain value.

## Deploying

- **Rehearse every deploy** with `warden/tools/rehearse-start.sh`: it runs the
  real `main.mjs` against a COPY of production state, which is the only thing
  that catches a bad boot check. Green tests cannot -- every suite opens a fresh
  in-memory database, so the one ordering that matters is unreachable from them.
- **Every deploy script must STATE its chain.**
- A tool that seeds rows no agent paid for runs against a SCRATCH mirror, never
  the Warden's own.

## Tests

`cd warden && npm test`, and `cd client && npm test`. The client's suite runs
against a real Warden built from `warden/src`, so a door change can break it.
A double that only RECORDS cannot catch a wrong interface -- make it ENCODE
against the real ABI, and verify a guard by breaking the fix.
