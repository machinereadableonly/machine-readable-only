# 2026-09-28 review: verification against the code

Every finding tagged BLOCKS MAINNET or High, plus the redeploy-only
decisions, checked at 8d2a0d2 by EXECUTION where possible (throwaway repro
tests in isolated worktrees; nothing in the tree changed). Libraries ARE
installed: report 38's "node_modules absent" was wrong, and its PLAUSIBLE and
UNVERIFIED items were re-judged against the real code.

**Result: every checked finding is real. None was already fixed, none was
wrong.** Two creative items are stale: the domain term (declined 2026-09-20)
and "the accelerated year has no report" (finished 2026-09-29).

## Door

| Finding | Verdict | Evidence |
|---|---|---|
| Dot-segment target defeats the domain pin | REAL, LIVE through Cloudflare | Signature made for evil.example reaches `/mcp` (200; control at `/mcp` 401). Cloudflare forwards `/.//x/...` verbatim; `/.//example.org/llms.txt` is byte-identical to `/llms.txt` live |
| Challenge not bound to the signature | REAL, a recorded design position | A relayer computes the answer from public values |
| Replay set is process memory only | REAL, known and disclosed | A replayed signature is accepted after a restart |
| Directory fetch has no deadline | REAL | A 1 byte/s server completes after 9 s against a 3 s timeout; 8 stalled hosts refuse a 9th honest one |
| JWK stored verbatim | REAL | 32 KB of padding accepted and served |
| `signature-agent;key=` | REAL | The installed library is non-conforming to RFC 9421 2.1.2; a conforming signer is refused |
| `refusals.md` lists four components | REAL | The door requires five |
| Client exits 0 on 429/500 | REAL | `status: undefined`, exit 0 |

Origin lock IS live (direct IPv4/IPv6 -> 403), though the template has it
commented out.

## Payments (no redeploy needed)

The HTTP status the facilitator chooses decides the branch:
`HTTPFacilitatorClient.settle` throws only on non-2xx or an unparseable body.

| Finding | Verdict |
|---|---|
| `success:false` with a tx hash is released | REAL, reachable whenever the facilitator answers 200 |
| Cancelled/spent nonce promoted to paid | REAL oracle defect (`authorizationState` is true on cancel too); attacker path needs a non-2xx refusal |
| Expiry sweep deletes on silence | REAL; acknowledged before, never decided acceptable |
| Held row released inside its validity window | REAL (released 3 ms after hold, through `log`) |
| Unknown outcome told as "nothing was minted" | REAL; the fix touches locked agent-facing copy |
| Sweep runs after `hasMinted` | REAL, low impact |
| Receipt in `structuredContent._meta` | REAL |
| warden.md "never release on silence", "re-read after settlement" | BOTH FALSE |

Fix order: the paid/unpaid oracle first (log-based, with payTo/amount stored),
then the classification, then a non-destructive sweep, then the sweep move,
then messages, receipt and rules. Fixing the others first widens the free-mint
hole.

## Contract (redeploy)

| Finding | Verdict | Runtime bytes |
|---|---|---|
| `seed` charges the key bound at write time | REAL (forge repro). The 2026-08-30 rebind decision's premise is false at write time; the fix is on `seed`, not `rebind` | +58 |
| Same drift on `applyMark` | Design question: no third party is charged | +58 if wanted |
| `closeThePiece` has no chain guard | REAL | 0 (script) |
| Owner key as plain text | REAL; `deploy-mainnet.sh` hard-fails without it, so the recommended Ledger path does not exist | 0 (script) |
| contractURI / freezeRenderer / bestRunOf | absent | +148 (+159 Renderer) / +168 / +57 |
| Rest day not stored | true | +71 (+19 Renderer) |
| No DEPLOY_DAY floor | REAL: 30 days back-filled in one tx | +138 |
| No lateness floor | REAL: a token silent 500 days went 0 -> 365 in one tx and took place 1 | ~+30 |
| rest() re-emits / setUpgrade 11-15 / heartbeat after sunset | all REAL | +33 / +1 / +19 |
| `_safeMint` -> `_mint` | true | -295 |

All together: net about +398 bytes against 8,535 of margin. Bytes are not a
constraint. The Blockscout `metadata: null` is the Renderer's
`;utf-8,` prefix and is fixable by a renderer swap at any time.

## Clock and operations

| Finding | Verdict |
|---|---|
| Clock key readable, Clock code writable, by the Warden | REAL: same Unix user, shared `warden/.env`, `ReadWritePaths` covers source. The live Warden environment does NOT carry the key |
| Wallet/supply cap ignores unwritten mints | REAL (repro: the last slot sells twice) |
| Leftover lock halts every run; no OnFailure | REAL |
| Heartbeat skipped while paused; sunset not passed | REAL |
| A day that never landed healed as written | REAL |
| Reconcile Minted ignores keyId | REAL |
| Reconcile all-or-nothing; cursor not atomic or floored | REAL |
| Condemned credit never rolls back the mirror | REAL |
| robust-solve unpacks the mask at 37, not 57 | REAL: 1,066 of 2,154 heart modules seen; every mainnet bitmap passes through it |
| Rehearsal tooling builds 172-byte codes | REAL |
| Gas stop skips reconcile | REAL; exit 0 is documented |
| warden.md "the Warden holds NO private key" | FALSE as written |

The "rebound to an UNREGISTERED key" line in the 2026-09-29 Clock log is
expected: the test agent wallet, token 1's owner, rebound it on 2026-09-28.
It exposes the Low finding that the mirror's binding stays stale.

## Decisions for the operator

1. Key custody: a separate Unix user for the Clock, and the owner key on a
   Ledger or Safe (a VPS change, not code).
2. `expectedKeyId` on `applyMark` too, or accept the drift.
3. Which redeploy-only additions go in: contractURI, freezeRenderer,
   bestRunOf, the rest day, DEPLOY_DAY floor, lateness floor.
4. Bind the challenge to the signature (a recorded position; it is what makes
   the door finding one step).
5. `signature-agent;key=`: fix the door, or narrow the documented promise.
6. New agent-facing sentences for an unresolved payment (the copy is locked).
7. A live probe of the x402.org facilitator's refusal shape (an outside call).
8. Permit2: accepted or refused.
9. Token 1 and Apex (creative item 4).

## Rulings (the operator, 2026-09-30)

1. Both, before mainnet: the owner moves to a Safe or Ledger right after
   deploy (Ownable2Step), and the Clock gets its own Unix user.
2. Accept the drift on `applyMark`. `seed` still gets `expectedKeyId`.
3. All six additions go in: contractURI (with a per-token `external_url`),
   freezeRenderer (not to be called yet), bestRunOf, the stored rest day,
   the DEPLOY_DAY floor, and a 30-day lateness floor on check-ins.
4. Bind the challenge to the signature before the client is released.
5. Fix the door: build the `;key=` base line from the dictionary member.
6. Approved wording for an unresolved payment: the outcome is not known, the
   reservation is held, do not pay again, the chain is checked at the next
   00:05 UTC.
7. Run the refusal probe against both x402.org and CDP on Base Sepolia.
8. Permit2 stays refused.
9. Token 1 races on equal terms: the seed agent skips check-ins until the day
   after the door opens, disclosed in `llms.txt`.

## Status (2026-10-08)

Checked against the tree at 8866ebc. **Every finding above is closed except
one left open by design.** Fix commits are on main and live on Base Sepolia.

| Finding | Status |
|---|---|
| Dot-segment target escapes the domain pin | DONE 5da35c2 |
| Challenge not bound to the signature | DONE, Plan B (ruling 4) |
| Replay set is process memory only | OPEN BY DESIGN: in-memory cache, disclosed in the raw-protocol doc |
| Directory fetch has no deadline | DONE 7b5223c |
| JWK stored verbatim | DONE 4fc1145 |
| `signature-agent;key=` | DONE, Plan B (ruling 5) |
| `refusals.md` lists four components | DONE 2c06a02 |
| Client exits 0 on 429/500 | DONE b3a5339 |
| `success:false` with a hash released | DONE 7b07063, 6e5c22e, 00b43ca |
| Cancelled nonce promoted to paid | DONE 7b07063 (decided from the transfer log) |
| Expiry sweep deletes on silence | DONE 7b07063, 5f34f41 (moves to payment-unresolved) |
| Held row released inside its validity window | DONE 7b07063 |
| Unknown outcome told as "nothing was minted" | DONE 538d61a, 0c86302, 0cbfe2f (ruling 6 wording) |
| Sweep runs after `hasMinted` | DONE 7b07063 |
| Receipt in `structuredContent._meta` | DONE 7b07063 |
| warden.md false statements | DONE 2bd7bed |
| `seed` charges the key bound at write time | DONE, Plan A (`expectedKeyId` on `seed`) |
| Same drift on `applyMark` | ACCEPTED (ruling 2), no change |
| `closeThePiece` has no chain guard | DONE 70069f9 |
| Owner key as plain text | DONE, Plan E (`deploy-mainnet.sh --owner <safe>`) |
| contractURI / freezeRenderer / bestRunOf | DONE 3a037bd, 773e41b |
| Rest day not stored | DONE 773e41b |
| No DEPLOY_DAY floor / no lateness floor | DONE 637fd93 |
| rest() re-emits / setUpgrade 11-15 / heartbeat after sunset | DONE 773e41b |
| `_safeMint` -> `_mint` | DONE 773e41b |
| Clock key readable, code writable, by the Warden | DONE, Plan E (Clock under user `mro-clock`, key out of the Warden's env 2026-10-08) |
| Wallet/supply cap ignores unwritten mints | DONE 914df1a |
| Leftover lock halts every run / no OnFailure | DONE df349f0; OnFailure live since the 2026-10-07 cutover |
| Heartbeat skipped while paused; sunset not passed | DONE 6c183b4 |
| A day that never landed healed as written | DONE 54fa70a |
| Reconcile Minted ignores keyId | DONE 77a946c |
| Reconcile all-or-nothing; cursor not atomic | DONE afc9f76 |
| Condemned credit never rolls back the mirror | DONE c9d03dc |
| robust-solve unpacks the mask at 37 | DONE a49b23a |
| Rehearsal tooling builds 172-byte codes | DONE b8fefec, 7abb3ff |
| Gas stop skips reconcile | DONE a675a0f |
| warden.md "the Warden holds NO private key" | DONE 2bd7bed |

All nine operator decisions are ruled (above) and built: Plans C, B, D, A and E
are merged, pushed and live.
