# Machine Readable Only -- quality -- the door and the payment path

**Snapshot:** 8d2a0d27e3
**Read:** `warden/src/door/{middleware,challenge,verify,directory}.mjs`, `warden/src/pay/{x402,cdp}.mjs`, `warden/src/{server,main,bootstrap,day}.mjs`, `warden/src/solve/{worker,queue}.mjs`, `warden/src/mcp/tools/{mint,upgrade}.mjs`, `warden/src/mcp/{server,nextSteps}.mjs`, `warden/src/clock/unresolved.mjs`, `warden/src/mirror/queries.mjs` (lines 1-834), `warden/ecosystem.config.cjs`, `warden/nginx.conf.example`, `.claude/rules/warden.md`, `warden/public/{llms.txt,door.html}`, `docs/2026-09-01-mro-raw-protocol.md`, `warden/test/{pay,settlement-commit,paid-refusal-settlement}.test.mjs` in full, parts of `door.test.mjs`, `verify.test.mjs`, `directory.test.mjs`, `warden/tools/{x402-live-check,x402-live-mint-check,cdp-live-check}.mjs` in full, `protocol-transcript.mjs` lines 76-184. Installed libraries: `http-message-sig` 0.2.0 `dist/index.mjs` (whole), `@x402/mcp` 2.24.0 `dist/esm/index.mjs` (530-664, 790-1150), `@x402/core` `chunk-H7ETXA5T.mjs` (485-534, 1368-1570, 1655-1693), `@x402/evm` `exact/facilitator/index.mjs` (180-373) and `chunk-KNDFHTKS.mjs`.

Nothing was executed; every finding is from reading. No Critical findings.

## Findings

### [HIGH] [BLOCKS MAINNET] A `success: false` settlement is always released, but the installed facilitator returns it for transfers already broadcast
**Where:** `warden/src/pay/x402.mjs:343` (classification), `warden/src/pay/x402.mjs:493` (release)
**What:** Every non-success answer is recorded as `declined` and the reservation is deleted. The installed reference facilitator returns `success: false` with a transaction hash when the receipt wait fails after broadcast (`@x402/evm/dist/esm/chunk-KNDFHTKS.mjs:22-27`, `80-88`, reason `settlement_pending`). It does the same when a mined transfer fails event validation (`exact/facilitator/index.mjs:347-358`). Its catch-all at `exact/facilitator/index.mjs:363-371` returns `transaction: ""` for any throw, including one from the send itself.
**Why it matters:** The transfer can still be mined after the row is deleted. The agent is debited up to $1250.00, holds nothing, and its nonce stays claimed in `pay_nonces`. This is the loss the unknown-versus-failed rule exists to prevent, reached through the branch the code treats as safe.
**Fix:** Treat as `declined` only when `settlement.transaction` is empty and `errorReason` is on an allowlist of pre-broadcast verification reasons. Hold everything else through `onUnresolved`. Add a fake-facilitator case to `settlement-commit.test.mjs` answering `settlement_pending` with a hash; the existing `declined` case only covers an empty transaction (line 82-89).

### [HIGH] [BLOCKS MAINNET] The expiry sweep deletes reservations on silence, and they carry nothing to ask the chain with
**Where:** `warden/src/mirror/queries.mjs:788`, called from `warden/src/mcp/tools/mint.mjs:50` and `upgrade.mjs:230`; `warden/src/main.mjs:439`
**What:** An `awaiting-payment` row older than ten minutes is deleted with no check. If the process stops between the handler returning and the settlement answer arriving, the row stays `awaiting-payment` and the next paid call by anyone sweeps it. `payer` and `asset` are written only by `holdUnresolvedMint` (`queries.mjs:169-176`), so the row could not be resolved even if kept. The same happens when `onUnresolved` throws (`x402.mjs:521-526`).
**Why it matters:** A restart during a settlement is ordinary: a deploy, a crash, or `max_memory_restart: "512M"` (`ecosystem.config.cjs:93`). `settlement-commit.test.mjs:298-318` pins the deletion as correct.
**Fix:** Pass `payer` and `asset` to the handler beside `payNonce` and store them at reservation time. Make the sweep move expired rows to `payment-unresolved` instead of deleting, so the Clock's `authorizationState` read decides.

### [MEDIUM] [BLOCKS MAINNET] On an unknown outcome the agent is told the payment failed, and the docs promise an immediate retry
**Where:** `warden/src/pay/x402.mjs:513-528`; `warden/public/llms.txt:228-233`; `docs/2026-09-01-mro-raw-protocol.md:797-806`
**What:** The gateway holds the row but returns the library's result unchanged, which is a payment demand reading "Payment settlement failed". Both documents say a failed settlement leaves the agent its money and that it can call again straight away. Neither mentions the held state.
**Why it matters:** The agent may have been charged while being told it was not. Its retry is refused `already-minted` (or `mark-already-applied`) with copy saying it owns a token. No second charge results, because both refusals come before payment.
**Fix:** In the unresolved branch return `payRefusal({ ok: false, reason: "payment-unresolved" })`. Add the reason to `NEXT` in `nextSteps.mjs` and document the third outcome in both files.

### [MEDIUM] The settlement receipt never reaches the agent where the protocol document says it does
**Where:** `warden/src/pay/x402.mjs:486`; `warden/src/mcp/server.mjs:178-185`
**What:** On success `@x402/mcp` returns the handler's plain value with `_meta` added (`dist/esm/index.mjs:1070-1076`). That value has no `content`, so `mcp/server.mjs` wraps it and the receipt lands in `structuredContent._meta`. The protocol document promises it in the response `_meta` (line 861-862), which is where the official client reads it (`dist/esm/index.mjs:558-563`).
**Why it matters:** A paying agent gets no transaction hash at the documented location. The only assertion on the receipt checks the value before wrapping (`paid-refusal-settlement.test.mjs:151-155`).
**Fix:** In `paid()`, turn a settled success into a complete tool result with `_meta` at the top level. Assert it over the wire in `test/e2e/join.test.mjs`.

### [MEDIUM] The directory fetch has no overall deadline, so eight slow hosts close the third-party path
**Where:** `warden/src/door/directory.mjs:238`, `:279`, `:404`, `:476`
**What:** `timeout` on `https.request` is an idle timeout. A host sending one byte every few seconds stays open until the 64 KB cap. Fetches are capped at eight in flight, and the ninth distinct URL is refused.
**Why it matters:** Eight dripping hosts, named by unauthenticated requests, refuse every agent hosting its own directory with `directory` for as long as the drip lasts. The comment at `:399-403` and the protocol document (line 187) both describe a 3-second bound that the code does not enforce.
**Fix:** Add a wall-clock deadline that destroys the request. Add a slow-response test; `directory.test.mjs` has none.

### [MEDIUM] `"signature-agent";key="sig1"` is documented as accepted, but the installed verifier ignores `key`
**Where:** `docs/2026-09-01-mro-raw-protocol.md:276-282`; `warden/src/door/verify.mjs:283-303`; `warden/node_modules/http-message-sig/dist/index.mjs:120-126`
**What:** `buildSignedData` uses the whole header value for a parameterised component. RFC 9421 section 2.1.2 signs only the named dictionary member. `coveredComponents` strips parameters, so the component check passes and the signature then fails.
**Why it matters:** A hand-signer following the document with a conforming library is refused `signature`. Hand-signing is currently the only way in. The dictionary test signs the unparameterised component (`door.test.mjs:1132-1147`), and the vectors are the older bare-string form.
**Fix:** Build the base line for `;key=` from the member value before calling the library, or state in the document that only the unparameterised component is accepted. Add a test signed by a base built by hand.

### [MEDIUM] Registration stores the caller's JWK verbatim and serves it publicly
**Where:** `warden/src/door/directory.mjs:307-311`, `:318-321`, `:574`; `warden/src/mirror/queries.mjs:421-424`
**What:** Only the proof and the thumbprint are checked. The whole submitted object is stored, including any extra members, up to the 64 KB body cap, and rendered into the public directory.
**Why it matters:** The 1,140,018-byte figure at `directory.mjs:329` assumes minimal keys. Padded keys at the 10,000 ceiling make the render hundreds of megabytes, against a 512M restart limit. A failed render is not cached, so every GET retries it. nginx's 10 per minute limit slows this and does not prevent it. The site also serves caller-chosen content under its own name.
**Fix:** Require `kty === "OKP"` and `crv === "Ed25519"`, and store only `{ kty, crv, x }`.

### [MEDIUM] `x402-live-mint-check.mjs` cannot run
**Where:** `warden/tools/x402-live-mint-check.mjs:102-109`, `:126-161`
**What:** It calls `createServer` without `contract` and `chainId`, which `server.mjs:104-106` rejects by throwing. Its requests also omit the 2026-07-28 envelope, while the handler is `legacy: "reject"` (`mcp/server.mjs:206`).
**Why it matters:** `contracts/script/adopt-deployment.sh:108` names it as the live payment check. It fails before it measures anything.
**Fix:** Pass `contract: CONTRACT, chainId: CHAIN_ID` and reuse the envelope helper `protocol-transcript.mjs` uses.

### [LOW] Registering a key again erases its "used" mark
**Where:** `warden/src/mirror/queries.mjs:60-63`; `warden/src/door/directory.mjs:574`
**What:** `INSERT OR REPLACE` replaces the row, so `lastUsedAt` returns to NULL. If the key then stays away 30 days, it is pruned.
**Why it matters:** `llms.txt:170-173` and `queries.mjs:413-416` both promise a used key is kept for good. No test covers it.
**Fix:** Use `INSERT ... ON CONFLICT(keyId) DO UPDATE` that leaves `lastUsedAt` alone.

### [LOW] The refusal conversion fails open
**Where:** `warden/src/pay/x402.mjs:176`, `:475`
**What:** Only `ok === false` is converted to a refusal. A handler returning `{}` or a value without `ok` is settled, with nothing reserved and nothing tracked.
**Why it matters:** No handler does this today. The direction is wrong for a money path.
**Fix:** Settle only when `result?.ok === true`.

### [LOW] Three IPv4 blocks refuse whole /16s where only a /24 is reserved
**Where:** `warden/src/door/directory.mjs:75`, `:78`, `:79`
**What:** `192.0.x.x`, `198.51.x.x` and `203.0.x.x` are blocked entirely. The reserved ranges are 192.0.0.0/24, 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24.
**Why it matters:** An agent whose directory resolves to public space in the rest of those /16s is refused `directory` with no remedy.
**Fix:** Test the third octet, which `blockedV4` already receives. Add neighbouring addresses to the allowed list in `directory.test.mjs:53`.

### [LOW] A stale challenge answers `expired` without the `serverTime` the document promises
**Where:** `warden/src/door/middleware.mjs:164`; `warden/src/door/challenge.mjs:61-63`
**What:** The protocol document (line 116) says `expired` covers a stale challenge and carries `serverTime`. Only the signature path attaches it.
**Fix:** Pass `{ serverTime }` on that refusal, or give the challenge case its own reason.

### [LOW] A released reservation can stop the solver run
**Where:** `warden/src/mirror/queries.mjs:475`; `warden/src/solve/queue.mjs:80-82`
**What:** `bumpSolveTries` reads `.solveTries` off a row that may have been deleted during the solve. The TypeError is thrown inside `runSolver`'s catch block, so the run rejects and draining stops until the next tick.
**Fix:** Return early in `failSolve` when no row is returned.

### [LOW] Duplicated limiter
**Where:** `warden/src/bootstrap.mjs:57-80`, `:114-139`
**What:** `makeAllowRegistration` re-implements `slidingWindow` line for line, while the comment at `:57-60` says both limiters use it.
**Fix:** Build it on `slidingWindow` with the key-count check in front.

### [LOW] Comments that contradict the code
**Where and what:**
- `warden/src/door/verify.mjs:130-213`: three doc blocks are stacked above `timeReason`, which they do not describe. They belong to `coveredComponents` (`:283`), `signatureAgentUrl` (`:259`) and `signatureLabel` (`:248`), which have none.
- `warden/src/mcp/server.mjs:127-130` says `sigHash` is a hash of the `Signature` header. The door hashes the signature base (`verify.mjs:386`).
- `warden/src/pay/x402.mjs:397-401` says a reservation "has to expire on its own rather than be cancelled". The same file releases and holds.
- `warden/src/server.mjs:17-18` and `:82-86` say the token view and MCP handler do not exist yet. They do.
- `warden/src/door/directory.mjs:116-131` carries two overlapping explanations of one branch.
- `warden/src/door/middleware.mjs:185-201` and much of the subsystem hold dated history, which `code-comments.md` forbids. `warden/src/door` is MIT and public.

**Fix:** Move each block to its function, correct the four statements, and trim the history when next touching these files.

### [INFO] The wrapper cache grows per token
**Where:** `warden/src/pay/x402.mjs:372`; `warden/src/mcp/tools/upgrade.mjs:327-329`
**What:** The cache key includes a description naming the token id, so there is one entry per token, Mark and variant, never evicted. The entries are small.

## Questions

- `@x402/core`'s resource server exposes `onSettleFailure` and `onAfterSettle` (`chunk-H7ETXA5T.mjs:899-921`, `1505-1567`). Would those replace the patch of `settlePayment` at `x402.mjs:333-353`? The patch separates a thrown HTTP error from an explicit decline more exactly, so it may be deliberate.
- `payNonceOf` reads a Permit2 nonce (`x402.mjs:58`), but the Clock only asks about 32-byte EIP-3009 nonces (`clock/unresolved.mjs:44`, `:66`). The default USDC requirement carries no `assetTransferMethod` (`exact/server/index.mjs:111-123`), so Permit2 looks unreachable. Is that intended to stay so?
- `main.mjs:448` allows five seconds for shutdown and `ecosystem.config.cjs` sets no `kill_timeout`. Does PM2 7.0.1 wait that long before SIGKILL? If not, `db.close()` may not run.
- `x402-live-check.mjs:66` warms the default resource name `paid_tool`, not the mint resource `main.mjs` warms. Is the difference intended?

## Out of scope

- `warden/src/mirror/queries.mjs:788` is the sweep behind the second High finding; the fix lands in the mirror and in the Clock's resolver.

## Coverage

Read in full: every source file in the subsystem, both paid tools, the MCP wrapper, the three settlement tests, the three live-check tools, and the three public documents.

Read in part: `door.test.mjs`, `verify.test.mjs` and `directory.test.mjs` (every test title, the bodies relevant to a finding), `protocol-transcript.mjs`, `queries.mjs`, `db.mjs` and `schema.sql`.

Not read: the bodies of `challenge`, `bootstrap`, `solve`, `day`, `cdp` and `static` tests, `test/e2e/join.test.mjs`, `mcp/gates.mjs`, `chain/preflight.mjs`, `chain/read.mjs`, the `client/` tree beyond two greps, and `warden/DEPLOY.md` beyond one grep. No images were opened; none bear on this subsystem.

Two points rest on my knowledge of the standard or of Node, not on a local source: the RFC 9421 `key` semantics, and `timeout` being an idle timeout. Both are worth a one-line confirmation before acting.
