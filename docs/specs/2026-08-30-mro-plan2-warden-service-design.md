# Plan 2 design: the Warden service

Status: APPROVED by the operator on 2026-08-30, in the brainstorm that produced it.
Implements sections 5, 6 and 11 of
`docs/specs/2026-08-27-machine-readable-only-design.md`, with the amendments
listed in step 0 below.

---

## 1. Why this, and why now

Plan 1 built a contract that nobody can reach.

Every write path on `MachineReadableOnly.sol` is `onlyWarden`: `mint`,
`batchCheckIn` and `applyMark` all revert for any other caller, and the Warden
address on the Sepolia deployment is the deployer key with nothing running
behind it. The contract is finished, tested at 231 green tests, deployed and
verified, and completely inert. An agent cannot mint, cannot check in, and
cannot buy a Mark, because there is no door to knock on.

Plan 2 builds the door and the service behind it. When it is done, an agent can
sign a request, satisfy the challenge, call a tool, and have its action accepted
and queued. What it CANNOT yet do is reach the chain, because writing to the
chain is Plan 3's job. That boundary is deliberate and it is the single most
useful property of this plan: **Plan 2 holds no private key.**

What it unblocks:

- **Plan 3 (the Clock)** drains the queue this plan fills. Without the mirror
  and the queue there is nothing for a Clock to write.
- **Plan 4 (the client)** speaks to the endpoints this plan defines. Writing
  `mro-agent` before the server it talks to would be writing against a guess.

---

## 2. Scope

The spec files five separate subsystems under the heading "the Warden". Trying
to build them as one plan would be roughly three times the size of Plan 1, so
the work is split three ways. the operator chose this split on 2026-08-30.

| Plan | What it covers |
|---|---|
| **Plan 2 (this one)** | The door, the mirror, the MCP server, x402 payments, the bitmap solver. The whole request side. Nothing reaches the chain. |
| **Plan 3** | The Clock: batched chain writes, reconciliation, the ERC-4906 poke, the daily post. |
| **Plan 4** | The reference client `mro-agent`, `SKILL.md`, and the seed agent. |

**Where Plan 2 finishes:** the Warden runs on `127.0.0.1:3006` with the full
test suite green and an end-to-end signed-request test driving it. The nginx
vhost, the PM2 config, the certbot command, the Cloudflare checklist and the
port-3006 registration are all WRITTEN, with the domain read from the
environment file.

They are not APPLIED, because the project has no domain. Six domains are served
from this VPS and none of them is MRO's. Registering one spends money and needs
a browser login, so it is a the operator gate, and it is the one thing that unblocks
deployment. Nothing else is deferred: the deployment configuration is written
now precisely so that none of it is retrofitted later.

Out of scope, and named so the boundary is not argued later: chain writes, the
Clock, the daily post, the reference client, `SKILL.md`, the seed agent.

---

## 3. Step 0: amend the spec before writing any JavaScript

Plan 2 reads its requirements from the spec, so the spec must stop
contradicting what was actually built and measured. Seven amendments, the same
discipline Plan 1 applied to section 7. The last two were found while reading
the packages' own source to write the implementation plan, not from the spec.

| Section, line | Currently says | Must say | Why |
|---|---|---|---|
| 8, line 559 | The code is a 29 x 29 QR, version 3 | 37 x 37, version 5 | Phase 0 built version 5. The spec predates the build. |
| 8, line 556 | Canvas is roughly 45 x 45 cells | 51 x 51 | The deployed Renderer emits `viewBox="0 0 51 51"`. Same cause. |
| 8, line 671 | Round-trip every bitmap through `jsqr` | ZXing is the oracle; `jsqr` is kept only to assert the two agree | Measured 2026-08-28: `jsqr` stops at the first non-text byte and reported a clean 24-character URL where ZXing returned all 101. Every tile on that sheet failed on a real phone while 25 repo tests passed. |
| 4, line 182 | Clock runs as `node dist/clock.js` | Plain ESM, run directly, no build step | See section 5. |
| 13, line 937 | Warden and client tested with Vitest | `node:test` | See section 5. |
| 6 | Zod imported as `zod/v4` | `zod` | The version resolved under `@modelcontextprotocol/server` 2.0.0 is 4.5.4, so the compatibility subpath is unnecessary. |
| 13 | RFC 9421 vectors ship with `web-bot-auth` | vendored from Cloudflare's repository | Checked 2026-08-30: the npm tarball is `dist/` and `README.md` only. |

---

## 4. Process shape, decided by measurement

The Warden computes each token's QArt bitmap at mint. That fact is in the spec
(section 8, "why the QR bitmap is stored, not computed") and it is the single
biggest constraint on the service's shape, so it was measured before anything
was designed around it.

**One robust solve: 9,695 ms and 532 MB resident.** Measured 2026-08-30 through
`tools/robust-solve.mjs` at `robustSolveFor("machinereadableonly.art", 1)`,
under `~/scripts/safe-build.sh`.

Two consequences, neither optional:

- **It cannot run inside a request.** Node runs one thread. A ten-second solve
  on the event loop freezes every other agent's request for ten seconds, and
  `mint` is the one tool an agent hits first.
- **It cannot run in the web process at all.** 532 MB is a real number on a
  7.8 GB box that normally carries eight Claude sessions and three
  `next-server` processes. This project has already destroyed its own tmux
  session once with a bulk render.

**The shape: one web process, plus a short-lived solver CHILD PROCESS.**
`mint` writes a row to a solve queue and returns the token id immediately. A
child process claims one row, solves it, writes the bitmap hex back, and exits.
One at a time, memory-capped by `--max-old-space-size` on the child.

The child process is not fussiness. `tools/payload-length-check.mjs` records
the reason in its own header: resvg's buffers are native, and **only a process
exit returns them**. That is a measured property of this project's own code.

The Clock does not need a bitmap until 00:05 UTC, so a solve has hours of
slack. A row still unsolved when the Clock runs is held back to the next day
rather than minted without artwork, and raises an alert.

Two alternatives were considered and rejected:

- **`worker_threads`.** Threads share the process heap, so the native buffers
  are not returned on thread exit. This is the same failure the bulk sweep hit.
- **A long-lived solver daemon.** It would hold 532 MB resident permanently for
  work that happens a few times a day.

---

## 5. Structure on disk

```
warden/
  src/server.mjs              PM2 entry: HTTP server, router, 127.0.0.1:3006
  src/door/verify.mjs         RFC 9421 verification via web-bot-auth
  src/door/challenge.mjs      stateless HMAC challenge: issue, check, burn
  src/door/directory.mjs      key registry, JWKS regeneration, SSRF-guarded fetch
  src/mirror/db.mjs           node:sqlite open, WAL, migrations
  src/mirror/schema.sql       the five tables
  src/mirror/queries.mjs      every statement the tools use, in one place
  src/mcp/server.mjs          createMcpHandler, resultType / ttlMs / cacheScope
  src/mcp/tools/*.mjs         one file per tool, eight of them
  src/mcp/resources.mjs       the three read-only resources
  src/pay/x402.mjs            @x402/mcp wrapping for mint and upgrade
  src/solve/queue.mjs         claim, complete, retry, alert
  src/solve/worker.mjs        the child process: one payload in, bitmap hex out
  src/chain/read.mjs          read-only RPC: the rebind re-check and reconciliation reads
  public/door.html            the one HTML file the piece has
  public/llms.txt             what the piece is, in the agent's own channel
  test/                       node:test, mirroring src/
  ecosystem.config.cjs        PM2, written not applied
  nginx.conf.example          vhost, written not applied
```

The environment schema is committed as an example file carrying names and no
values, following the project's existing convention.

**Plain JavaScript, ESM, no build step. Tests with `node:test`.**

Reasons, in the order they matter:

1. It matches what this repo already does. `tools/` is plain `.mjs` with 56
   `node --test` tests, and the reference client is specified as plain
   commented JavaScript so an agent can read it before running it.
2. PM2 points at the real file. There is no `dist/` to go stale, and no build
   step between an edit and a restart.
3. It adds no dependency. Vitest would be a new one for mocking that
   `node:test` already does with `mock.fn` and `mock.method`.

The cost, stated plainly: no compile-time type checking on a security boundary.
That is answered by tests against the RFC 9421 vectors rather than by types.

Files stay small and single-purpose. `door/verify.mjs` should be readable in
one sitting, because it is the rule the whole piece rests on.

---

## 6. The door

The entry rule is an ACCESS CONDITION for an art piece: you get in by proving a
program sent the request. It is not an anti-abuse system and the code comments
must not describe it as one.

**Four request cases, not the spec's three.** The fourth is `/t/<id>`, and it
is easy to lose because it is the only route that must NOT be gated.

1. **Browser at `/`.** No `Signature` header, `Accept` includes `text/html`:
   nginx serves `door.html` from disk. The Warden never sees it.
2. **Unsigned, or signed with no valid challenge answer.** `401` carrying a
   fresh challenge, the MCP URL, the docs URL, the client URL and a one-word
   `reason`. The challenge is `nonce.unix-ms.hmac`, stateless, five seconds,
   with a burn-after-use set. Nothing is keyed by IP, so agents behind one
   cloud NAT never collide.
3. **Signed request with a correct challenge answer.** Verified through
   `web-bot-auth`'s `verify()` with a verifier from `verifierFromJWK()`. The
   signature must cover `@authority`, `@method`, `@path` and `signature-agent`,
   carry `tag=web-bot-auth`, and have `expires - created` no more than five
   minutes. The key id is admitted for the rest of the UTC day and the request
   proceeds to `/mcp`.
4. **`GET /t/<id>`.** Public, unsigned, JSON only. This is where the token's QR
   points. Gating it would mean a scanned token leads nowhere, which destroys
   the one distribution surface the artwork has.

**The SSRF guard on directory fetches** is its own module with its own tests:
HTTPS only, port 443 only, resolve the host and reject private, loopback,
link-local and metadata ranges, three-second timeout, 64 KB body cap, no
cross-host redirects.

**Key registration** (`POST /keys`) takes a public JWK plus a signature over a
server nonce, proving possession. The key id is the RFC 7638 thumbprint. On
each registration the JWKS at
`/.well-known/http-message-signatures-directory` is regenerated as a static
file for nginx to serve. The count of registered keys is never published;
mints are the only public number.

---

## 7. The mirror

`state.db`, `node:sqlite`, WAL mode. Five tables: `keys`, `tokens`, `credits`
(with a unique index on `(tokenId, day)`), `mark_orders`, `mints`.

The mirror is the source of truth for the tools, so a token exists to an agent
from the moment it is queued rather than from the moment it is mined. Token ids
are assigned from `max(id) + 1`; the contract takes the id as an argument and
reverts if it is taken, so the id promised at mint is the id that lands.

Concurrency is handled by WAL plus the unique index, not by a lock. Two
simultaneous check-ins for one token produce one credit and one
`already-credited-today`.

`node:sqlite` still prints an experimental warning on Node 24.14.1, verified
2026-08-30. It loads with no flag and the API used here is `DatabaseSync` and
`StatementSync` only, both of which have been stable across the 24.x line.

---

## 8. The MCP server

Endpoint `/mcp`, Streamable HTTP, spec version 2026-07-28, on
`@modelcontextprotocol/server` 2.0.0 with `@modelcontextprotocol/node` 2.0.0
(both verified live 2026-08-30, both published the day the spec revision
landed). A fresh server per request; no sessions, no `initialize` handshake.

Eight tools: `challenge`, `status`, `mint`, `checkin`, `upgrade`, `rebind`,
`seed`, `rest`. Three resources: `mro://llms.txt`, `mro://contract`,
`mro://token/{id}`.

Rules that hold for every tool:

- **The caller's key id comes from the verified request, never from a
  parameter.** A tool that accepts a key id as input is a tool that lets one
  agent act as another.
- **Tools read and write the mirror, not the chain.**
- **`rebind` and `rest` never submit anything.** They return the exact call the
  token OWNER's wallet must sign. `rest` carries `"irreversible": true`.
- Errors are structured and returned, never thrown.
- Any field echoing agent-supplied text carries an explicit prompt-injection
  warning, as base-200's server does.

**Do not implement Roots, Sampling or Logging**, and do not implement `ping`,
`logging/setLevel`, `notifications/roots/list_changed`, SSE resumability or
`resources/subscribe`. All are deprecated or removed in 2026-07-28.
`server/discover` is mandatory, every result carries a `resultType`, and list
results carry `ttlMs` and `cacheScope`.

---

## 9. Payments

`mint` at `$1.00` and `upgrade` at the catalogue price, wrapped with
`@x402/mcp` 2.24.0 (verified live 2026-08-30), `payTo` the treasury ADDRESS.

Every gate is checked BEFORE payment is requested. An agent must never pay for
an `upgrade` that was already sold out, already applied, or whose level gate it
does not meet. The pre-check reasons are part of the tool contract.

In tests the facilitator is mocked, including the sold-out reservation race.

**Ordering, and what happens when it breaks.** An agent pays, the mint row is
written, the solve is queued. If the solve then fails, the agent has paid and
has no artwork. That row retries, and after three failures it alerts rather
than failing silently. This is the one place in Plan 2 where money and a
fallible ten-second computation meet, and it gets an explicit test.

---

## 10. Security posture

**Plan 2 holds no private key.** Chain writes belong to Plan 3, so the Warden
in this plan needs the challenge secret, a read-only RPC URL, and the treasury
ADDRESS, which is an address and not a key. If this service were fully
compromised, an attacker could issue challenges and write to a local SQLite
file. That small blast radius is a reason to build it in this order.

**The rebind re-check reads the chain, never the mirror.** When a tool would
answer `not-bound-to-caller`, the Warden makes one live `eth_call` for the
token's bound key first, because a rebind may have just been mined. This is a
security control, not an optimisation, and it is pinned by a test that fails if
the read is served from the mirror.

Real environment files stay chmod 600, WinSCP-edited, never committed, and
never in the PM2 dump. The committed example file carries the schema and no
values.

---

## 11. Testing

`node:test`, run from `warden/`. Both existing suites stay green as well.

- **Signature verification** against the RFC 9421 Ed25519 test vectors from
  Cloudflare's repository, VENDORED into `warden/test/vectors/` because the npm
  tarball ships only `dist/` and `README.md`; rejection when a required
  component is missing; rejection of a signature whose window exceeds five
  minutes. Both of those last two are checks this project adds: `verify()`
  enforces neither, confirmed by reading the library's source.
- **Challenge**: validity, expiry at five seconds, single use, and that a
  challenge minted for one key does not answer for another.
- **SSRF guard**: private, loopback, link-local and metadata ranges; a
  cross-host redirect; an oversized body; a timeout.
- **Key registration**: proof of possession required, thumbprint correctness,
  directory regeneration.
- **Every tool**: the success path and every `reason` string it can return.
- **The rebind re-check** reads the chain, asserted by a failing mock.
- **Concurrency**: 100 simultaneous `checkin` calls produce exactly one credit.
- **Payments**: mocked facilitator, sold-out reservation, and the paid-but-
  unsolved retry path.
- **MCP**: 2026-07-28 header handling, `server/discover`, `resultType`.
- **Bitmaps**: every solved bitmap round-tripped through ZXing, with `jsqr`
  asserted to agree. A plain control code is included in any decode sweep.

The end-to-end test is a script that signs a real request against the local
server, answers the challenge, mints with a mocked facilitator, checks in,
and reads `/t/<id>` back.

---

## 12. Deployment, written but not applied

Written in this plan, applied when a domain exists:

- `ecosystem.config.cjs`: PM2 fork, `-H 127.0.0.1`, port 3006, pointing at the
  real binary path.
- `nginx.conf.example`: static routes for `door.html`, `/llms.txt`,
  `/client.mjs` and the JWKS; everything else proxied to 3006.
- The certbot command, and the Cloudflare checklist: proxy on, Full (Strict),
  origin lock, **Bot Fight Mode OFF** (it runs outside the ruleset engine,
  ignores Allow rules, and may challenge API traffic), AI bot "Agent" policy
  Allow, legacy "Block AI bots" off.
- UFW deny on 3006.
- Port 3006 registered in `~/.claude/templates/port-allocation.md`. Confirmed
  free on 2026-08-30: 3000 to 3005 are taken and 3006 is the next.

---

## 13. Risks

- **`web-bot-auth` is at 0.1.3, last published 2026-03-09.** It is Cloudflare's
  own reference implementation for a draft standard, at 105,132 weekly
  downloads, so it is stable rather than abandoned. The risk is that the draft
  moves and the package does not. Mitigation: the verification call sits behind
  `door/verify.mjs` so replacing it touches one module, and the RFC 9421 test
  vectors are the contract that module is held to.
- **The solve is ten seconds and half a gigabyte.** Handled by the child
  process, but the retry path is where a paid agent could be left without a
  token, so it is tested rather than assumed.
- **No domain.** Deployment cannot be verified end to end until one exists,
  including whether Cloudflare's bot settings let a signed request through.
  Everything up to that point is verifiable locally.
- **`@x402/mcp` 2.24.0 is built against the v1 MCP SDK and zod 3**, while this
  service is on the v2 server and zod 4. Its `createPaymentWrapper` reads the
  payment as `extra?._meta`, the v1 context shape; under v2 that data sits at
  `ctx.mcpReq._meta`. Left alone it would silently never find a payment and
  answer "payment required" forever, to paying agents included. A one-line
  adapter fixes it and a test pins it. Found by reading the package's source
  before the build rather than during it.
- **`node:sqlite` is still flagged experimental.** Only `DatabaseSync` and
  `StatementSync` are used. If it ever breaks, `better-sqlite3` is the same
  API shape.

---

## 14. Sequence

Step 0, the spec amendments, comes first because everything after reads from
the spec. Then the door before the tools, because a tool with no gate in front
of it is a tool that ships ungated if the plan is interrupted. Then the mirror,
then the tools, then payments, then the solver, then deployment configuration.

---

## 15. What this design does NOT decide

- **The domain.** Read from the environment everywhere. Phase 0 measured that a
  realistic domain costs about 0.8 points of heart match, so the choice is
  artistically cheap, but it is permanent per token once minting starts.
- **The door sign's copy and `/llms.txt`.** Both get drafted in the plan and
  reviewed by the operator. Words in the piece's own voice are the operator's call, not a
  build decision.
- **Anything about the Clock**, including how the ERC-4906 poke handles a
  scattered daily subset. That is Plan 3's open item and it stays there.
