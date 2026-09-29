# Machine Readable Only -- threat model

Snapshot `8d2a0d27e3`. This is a map of the system, not a list of findings. Where an item below suggests a bug, it is a question for the reviewers, grounded in the file it cites. Nothing here re-opens a settled decision. Two items touch settled ground, and the question each asks is noted where it appears: whether a trust assumption behind the decision holds in the code as built.

## 1. Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| **Owner key** (`Ownable2Step` owner) | Deployer EOA. `MAINNET_DEPLOYER_KEY` is read from `contracts/.env` on the VPS (`contracts/script/deploy-mainnet.sh:86-93`, `script/MroScript.sol:66-80`). Moving ownership to a Safe or hardware wallet is written as "prefer", not enforced (`deploy-mainnet.sh:28-31`). | It can swap the renderer (every image), `setWarden`, `pause`, `sunset` (irreversible), `setUpgrade`, both caps and `setVouchersEnabled`. It cannot renounce (`MachineReadableOnly.sol:265`). |
| **Clock key** (the on-chain `warden` role) | `CLOCK_PRIVATE_KEY` in `warden/.env`. The Clock reads it (`clock/main.mjs:35`). The Warden loads the same file (`ecosystem.config.cjs:44`) and deletes the key from its own `process.env` (`main.mjs:69`). Both run as the same Unix user. | It can `mint`, `seed`, `batchCheckIn`, `applyMark` and `heartbeat`, and its signature makes vouchers valid (`:598`). It pays all gas. |
| **USDC revenue** | Paid by agents through x402 to `TREASURY_ADDRESS` (`main.mjs:85-142`). Settlement is done by the facilitator: x402.org on testnet, CDP on mainnet with `CDP_API_KEY_*`. | $1 per mint; Marks cost $1 to $1,250. |
| **Paid-but-unwritten obligations** | Mirror rows in `mints` / `mark_orders`: `awaiting-payment`, `payment-unresolved` and `queued` (`mirror/schema.sql:96-177`), plus `pay_nonces` (`:216`). | An agent can pay and receive nothing, or receive something without paying. |
| **Integrity of the entry rule** | The door: `door/verify.mjs`, `door/middleware.mjs`, `door/challenge.mjs`, and `CHALLENGE_SECRET`. | The artwork's meaning is "a program did this". |
| **Integrity of each token's record** | `_tokens`, `_marks`, `_codeOf`, `_echo` and `finishers` on chain. They are permanent, and everything is written by the Warden (`MachineReadableOnly.sol:64-97`). | These fields *are* the artwork: return visits, streaks, finishing place (Apex is unique) and the permanent QR bitmap. |
| **Agent identity keys** | Ed25519 JWKs on agent machines (`client/src/keys.mjs:54-86`). The operator's own seed agent keeps one at `~/.mro/seed-identity.jwk.json` (`deploy/mro-seed.service:53`). | Whoever holds a key controls check-ins, Marks and seeds for tokens bound to it. |
| **Agent wallet keys** | `MRO_WALLET_KEY` env, or `--wallet-key-file` (`client/src/cli.mjs:176`). | They sign EIP-3009 authorisations. |
| **The mirror** | SQLite `STATE_DB_PATH` plus the WAL. The reconcile cursor and run lock sit beside it. | Source of what agents are told, and of what the Clock writes. |
| **Availability and reputation** | Domain `machinereadableonly.com`, and `/t/<id>`, which every QR resolves to permanently. The RPC provider key sits inside `BASE_RPC_URL`. | If the domain lapses or is hijacked, the permanent QRs point wherever the new holder chooses. |

## 2. Actors

- **Anonymous visitor.** Unsigned access to `/`, `/llms.txt`, `/protocol`, `/robots.txt`, the MCP cards, `/t/<id>`, the key directory, `GET /keys/nonce` and `POST /keys` (`server.mjs:195-408`). It can also make the Warden fetch any HTTPS host by naming it in `Signature-Agent` (`door/directory.mjs:426-503`), and it can call `sunsetByAbsence()` after 365 quiet days (`MachineReadableOnly.sol:294`).
- **Agent (signed key).** After the door it can reach 9 MCP tools on `/mcp` (`mcp/server.mjs:61-66`), limited to 60 calls a minute per key (`bootstrap.mjs:49-50`). Keys are free to mint, and registration is limited only by the nginx limiter (`nginx.conf.example:63`) plus a 10,000-key cap (`bootstrap.mjs:24`).
- **Paying wallet.** Signs EIP-3009 authorisations. It may differ from both the recipient and the agent key (`pay/x402.mjs:72`).
- **Token holder (owner wallet).** On chain directly: `rebind` to any bytes32, `rest` (irreversible), and transfers. None of these pass through the Warden (`MachineReadableOnly.sol:793-810`).
- **Operator / owner.** Holds the owner key and the VPS, and edits `.env` files.
- **Clock (systemd timer, 00:05 UTC).** The only chain writer. It is sandboxed (`deploy/mro-clock.service:33-75`) but has write access to the whole `warden/` directory (`:38`).
- **Warden (PM2).** Internet-facing through nginx on 127.0.0.1:3006. It has no sandbox directives (`ecosystem.config.cjs`) and runs as the same user as the Clock.
- **Solver child processes.** Spawned per token with `(domain, tokenId)` (`bootstrap.mjs:189-209`, `solve/worker.mjs`).
- **Seed agent.** The operator's own `client` runs daily from the same box (`deploy/mro-seed.service`).
- **Third parties:**
  - the x402 facilitator (verifies and settles payments);
  - the Base RPC provider (every gate read and the Clock's view of the chain);
  - the USDC contract (`authorizationState` is used as the payment oracle);
  - Cloudflare (proxy; the origin lock is off, `nginx.conf.example:75-84`);
  - third-party JWKS hosts;
  - Alchemy (the only proven metadata consumer);
  - npm, which holds the `mro-agent` name (future supply chain for agents' clients).

## 3. Trust boundaries

| # | Boundary | Crossing | Cite |
|---|---|---|---|
| B1 | Internet to nginx to Warden | Host is forwarded, and the signature authority is pinned to `MRO_DOMAIN`. Only `/keys*` is rate limited, and it is keyed on the CF edge IP. | `nginx.conf.example:63,111-143`; `middleware.mjs:35-39`; `server.mjs:183` |
| B2 | Unsigned public routes | `/t/<id>` renders from the mirror; the directory is rendered from stored JWKs. | `server.mjs:195-203,319-334` |
| B3 | Key registration | Ed25519 proof over a server HMAC nonce. The **whole caller JWK JSON is stored and republished** (`INSERT OR REPLACE`). | `directory.mjs:532-575`; `mirror/queries.mjs:60-63,421-430` |
| B4 | Third-party key lookup | The caller-chosen `Signature-Agent` URL makes the Warden fetch out. Guards: SSRF check, pinned lookup, 64 KB cap, 8 fetches in flight, success cached 1 h, failure cached 45 s. | `directory.mjs:103-283,426-503` |
| B5 | Door admission | RFC 9421 components, a 5-minute window, 60 s skew, sigHash replay set, content-digest, and an HMAC challenge bound to the keyid. The Warden reimplements web-bot-auth's checks. | `verify.mjs:80-110,128,312-408`; `middleware.mjs:90-183`; `challenge.mjs:49-89` |
| B6 | Door to MCP identity | `keyId` / `sigHash` pass through `req.auth` into `authInfo`, and are never taken from tool arguments. | `server.mjs:468`; `mcp/server.mjs:125-131,220-236` |
| B7 | MCP tools to chain reads | Every contract gate is read live over JSON-RPC. `null` means refuse. Binding is checked both ways for `upgrade`/`seed`, one way for `checkin` (decided). | `mcp/gates.mjs:28-227`; `chain/read.mjs`; `tools/checkin.mjs:75-88` |
| B8 | Payment: agent to Warden to facilitator | Verify happens before the handler and settle after it. An `isError` result cancels. Reservations are keyed by EIP-3009 nonce. The settlement outcome is observed by monkey-patching `settlePayment`. | `pay/x402.mjs:173-207,321-355,405-420,434-530`; `@x402/mcp dist/esm/index.mjs:811-883` |
| B9 | Settlement to mirror | `onSettled` / `onUnsettled` / `onUnresolved` map to `settleByNonce` / `releaseReservation` / `holdUnresolvedPayment`. `dropExpiredReservations` uses a 10-minute TTL. | `main.mjs:252-282`; `queries.mjs:49,645-798` |
| B10 | Mirror to Clock to chain | Queued rows become `mint` / `seed` / `batchCheckIn` / `applyMark` / `heartbeat`, with explicit nonces and a receipt-status check. **Binding is not re-checked at write time.** | `clock/run.mjs:302-771`; `clock/write.mjs:84-212`; `clock/batch.mjs` |
| B11 | Chain to mirror (reconcile) | Logs are filtered by address and read 12 blocks behind the head. `Rebound` is mapped through `keyIdHash`; `Transfer` sets the owner. | `clock/reconcile.mjs:66-266`; `run.mjs:944-975` |
| B12 | USDC oracle to mirror | `authorizationState(payer, nonce)` promotes or releases a held payment. | `clock/unresolved.mjs:53-118`; `queries.mjs:676-699` |
| B13 | Contract access control | `onlyWarden` (also stamps `lastWardenDay`), `onlyOwner`, `onlyTokenOwner`, and a voucher signature checked against the current `warden`. | `MachineReadableOnly.sol:146-151,238-278,581-610,783-810` |
| B14 | Renderer | `tokenURI` STATICCALLs `renderer`. The current renderer is `pure`. The only check on a swap is `code.length > 0`. | `MachineReadableOnly.sol:224-227,303-311`; `render/Renderer.sol:40` |
| B15 | Secrets and environment | One `.env` for Warden and Clock, loaded with `--env-file`. PM2's `filter_env` strips inherited shell secrets. RPC URLs are redacted in logs. | `ecosystem.config.cjs:44,90`; `mro-clock.service:27`; `clock/redact.mjs` |
| B16 | Client to site | Before signing, the client checks `payTo` and `amount` against out-of-band expectations. `asset` and `network` are optional. The EIP-712 domain name, version and chainId come from the demand. | `client/src/pay.mjs:100-130,144-194`; `cli.mjs:197-201` |
| B17 | Deploy pipeline | `forge script` signs with a hot key from `.env`. `setUpgrade` 1-15 is sent in the same broadcast. `adopt-deployment.sh` rewrites `DEPLOY_BLOCK` and `CLAUDE.md`. | `deploy-mainnet.sh`; `DeployPlan5.s.sol:27-33`; `reconcile.mjs:47` |

## 4. Permanent vs changeable

**Fixed in the MRO bytecode**, which has no proxy (it lands at the redeploy before token #1):

- `CODE_BYTES = 407`, `MAX_MARK_ID = 15`, `FIRST_FINISHER_MARK = 11`
- the `finisherMark` bands 1 / 4 / 14 / 64
- `FINISH_LEVEL = 365`, `ABSENCE_DAYS = 365`, `MAX_CREATION_LAG = 30`
- the voucher typehash and EIP-712 domain (`"MachineReadableOnly","1"`)
- one mint per key, forever; the seed budget formula `(today-first)/365 - spent`
- `heartbeat` is not paused; renounce is disabled; the supply-cap ceiling is 65,535
- `rest` and `sunset` are one-way
- the check-in window rule `lastDay < day <= today()`
- which functions are gated by which modifier. `rebind`, `rest` and transfers are **not** pausable.

**Permanent per token once written:**

- the `code` bitmap (which encodes the domain URL)
- `mintDay`, `echo`, the finisher ordinal and Mark, the earned-Iris run, the variant bits
- every credited day (level never falls)
- `_hasMinted` / `_firstMintDay` / `_seedsSpent` per key

**Owner-changeable on chain:**

- `renderer` (changes every token's image; could also brick it)
- `warden`
- `supplyCap` (can be set below `totalMinted`)
- `walletCap` (no upper bound)
- `paused`
- `vouchersEnabled`
- every Upgrade record (`active`, `maxSupply`, `minLevel`, `minStreak`, `requiresWhole`, `excludes`, `requiresAny`), including after purchases. Pair symmetry is not enforced on chain (`:680-685`).
- `sunset()`

**Off-chain, changeable any time:**

- `MINT_PRICE` and the Mark prices (`pay/x402.mjs:20`, `mcp/ladder.mjs`)
- treasury, facilitator and CDP credentials
- door policy, rate limits, reservation TTL, gas cap
- the solver
- which gates the Warden checks
- the domain registration, which is renewal-dependent

## 5. Top risks to examine (ranked)

1. **Key custody and blast radius.**
   - The Warden is unsandboxed, internet-facing, runs as the same user as the Clock, and loads the file holding `CLOCK_PRIVATE_KEY`. Does any Warden compromise (a dependency, the solver, a path bug) yield the warden role?
   - Is the mainnet owner a hot EOA in `contracts/.env` on the same box?
   - What does each key allow, irreversibly: permanent arbitrary QR bitmaps via `mint`/`seed`; back-filling missed days (`batchCheckIn` accepts any `lastDay < day <= today`); free `applyMark`; taking the Apex place; enabling and signing vouchers; `sunset`; `setRenderer`?
   - Files: `main.mjs:54-69`, `ecosystem.config.cjs`, `mro-clock.service:38`, `deploy-mainnet.sh:28-31,86-93`, `MachineReadableOnly.sol:238-278,499-544,700-761`.
2. **The held-payment oracle.** `authorizationState` is also `true` for an authorisation cancelled via USDC `cancelAuthorization`, and it means nothing for a Permit2 payload, which `payNonceOf` / `payerOf` accept (`pay/x402.mjs:56-75`).
   - Can a payer force the "unresolved" branch (settle throws or times out), cancel its own authorisation, and have the Clock promote the row to `queued`, giving a free mint or a free $1,250 Mark?
   - Files: `pay/x402.mjs:321-353,485-527`, `clock/unresolved.mjs:66-91`, `queries.mjs:676-699`.
3. **The x402 seam, end to end.**
   - Does `findMatchingRequirements` bind amount, payTo, asset and network to the server's `accepts`?
   - `getPaymentFlow` is chosen from the *client's payload* (`@x402/mcp index.mjs:847`). Can a payload select a flow that settles before the handler, or skip the handler?
   - Is `isError` cancellation reliable on every refusal path?
   - What happens on a restart between the handler and the hook, on a 10-minute TTL sweep that races a slow settlement (`queries.mjs:49,788`), and on `settled`/`outcomes` state that lives only in process memory?
4. **The door as an entry rule.** This is a reimplementation of web-bot-auth verification (`verify.mjs:80-110`).
   - Check: the required components, `lastIndexOf` parsing of `@signature-params`, the `Signature-Agent` dictionary vs legacy form, keyid-to-JWK thumbprint equality for both lookup paths (`directory.mjs:443-500`), sigHash replay across the 60 s skew, challenge binding to `keyId`, and `pinnedUrl` against absolute-form targets.
   - Can a request be admitted under a keyid whose JWK is not the one that verified?
5. **Binding drift between request and write.**
   - `upgrade` (earned route, free and forecloses the paired Mark), `seed` and `checkin` check the chain binding at request time. The Clock sends `applyMark` / `seed` up to 24 h later with no key check, and the contract has none.
   - Can a seller queue a Break (or spend a seed) and then transfer and rebind, so that it lands on the buyer's token?
   - Files: `tools/upgrade.mjs:175-203`, `tools/seed.mjs:103-159`, `clock/run.mjs:439-695`.
6. **Warden-controlled history and fairness.**
   - Can a mirror credit row for a day the agent did not visit reach the chain?
   - Is the finisher order across chunks, retries and bisection (`batch.mjs`, `run.mjs:566-636`) really `(day, tokenId)`?
   - What about backdating `mint` / `seed` by up to 30 days, and Warden box-clock `utcDay` against chain `today()` (`tools/checkin.mjs:90`)?
7. **Clock write correctness.**
   - Nonce handling after `send-failed` / `receipt-unknown` (`write.mjs:164-202`) and the heal path (`batch.mjs`).
   - Paid mints stuck for good, and whether they alert: `StaleDay`, and `AlreadyMinted` after a mirror reset (`_hasMinted` has no getter, so it cannot be checked before payment, `mint.mjs:27`).
   - The `isFinalMark` / `isFinalSeed` allowlists (`run.mjs:821-928`).
   - The heartbeat decision on RPC failure (`run.mjs:727-771`).
8. **Reconcile trust.** Address filtering, 12-block confirmation depth, `Rebound` resolution through `keyIdHash`, `Transfer` → `setOwner`, the missing mainnet `DEPLOY_BLOCK` (boot throws, `clock/main.mjs:62`), and cursor advance rules (`clock/cursor.mjs`).
9. **Unauthenticated resource cost.**
   - `POST /keys` stores and republishes the whole JWK (up to 64 KB, with arbitrary extra members), so the public directory can grow to about 640 MB across 10k keys (`queries.mjs:421-430`, `directory.mjs:318-357`).
   - The nginx limiter buckets by CF edge IP while the origin lock is off.
   - Also check: in-memory `seen` / `spent` / `seenNonces` sets, the x402 `wrappers` Map keyed by a description that includes the token id (`pay/x402.mjs:371-424`), the directory-fetch reflector, and free-tool RPC load starving the paid gates.
10. **Client money path.**
    - `asset` and `network` expectations are optional, and the EIP-712 `name` / `version` / chainId / `verifyingContract` come from the demand (`pay.mjs:111-128,171-180`). Can a hostile or spoofed site get the matching base-unit amount signed on a pricier asset or another chain?
    - Also: signature validity window, key-file modes, and `MRO_WALLET_KEY` in the environment.
11. **Admin dials after launch.**
    - `setUpgrade` can change gates and masks on Marks already sold, and pair symmetry is enforced only off chain.
    - `setSupplyCap` can go below `totalMinted`.
    - `setRenderer` checks only `code.length`, so a reverting renderer bricks all metadata.
    - Pause does not stop `rebind` / `rest`.
    - The voucher path, once enabled: vouchers carry no expiry, and they stay valid until `setWarden` (`MachineReadableOnly.sol:246-278,558-610,672-693`). Rotating the warden also invalidates every outstanding voucher.
12. **Permanence of the artwork input.**
    - `code` comes from the solver (`solve/worker.mjs`, `tools/robust-solve.mjs`) using `MRO_DOMAIN` and is immutable. What guards a wrong domain, a tampered `tools/` tree, or a solver bug before `mint` writes it for ever?
    - Does renderer output escape every field it writes into JSON/SVG (`render/Renderer.sol`, `DigitBand.sol`)?
13. **Mainnet cutover pipeline.**
    - `deploy-mainnet.sh` / `DeployPlan5` from a hot key.
    - The handover to Ownable2Step is a manual follow-up.
    - The fail-closed boot guards on treasury, CDP credentials and chain id (`main.mjs:104-179,202-221`).
    - `adopt-deployment.sh` editing `DEPLOY_BLOCK` and `CLAUDE.md`.
    - The Builder Code is `null`.
14. **Secret leakage.** RPC-key redaction coverage (`clock/redact.mjs`, `chain/read.mjs:109-117`), PM2 `filter_env` completeness, log file modes, SQLite / WAL / backup permissions, and error text returned to callers (`mcp/server.mjs:150-162`, `server.mjs:471-474`).
15. **Distribution supply chain.**
    - The `mro-agent` npm name currently holds a placeholder. Future agents will run it with wallet keys.
    - The seed unit plans to switch to `npx --yes mro-agent@<version>` (`mro-seed.service:34-53`).
    - Question for reviewers: who can publish to that name, and is provenance or 2FA enforced?
