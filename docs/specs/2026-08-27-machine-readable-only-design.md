# Machine Readable Only -- Design Spec

**Date:** 2026-08-27 (revision 3, same day)
**Status:** Draft (awaiting the operator review)
**Brief:** `docs/superpowers/2026-08-27-machine-readable-only-brief.md`
**Brainstorming session:** Output of one `superpowers:brainstorming` session in
the move-to-vps hub on 2026-08-27: clarifying questions, a three-agent live
verification pass (costs, documentation accuracy, chain choice), then a
top-to-bottom lifecycle walkthrough that produced revision 2, and a four-lens
comparable-projects study (`docs/superpowers/2026-08-27-mro-comparable-projects.md`)
that produced revision 3. Every
outside-world fact was checked against a live source on 2026-08-27; sources
are in section 17.

> **operator-manual tasks** (flag for the build plan; after completing any of these,
> tell Claude so it can update memory):
> 1. Buy the domain and add it to Cloudflare (proxy ON, Full (Strict), Bot Fight
>    Mode OFF, AI "Agent" policy Allow -- see section 12).
> 2. Create a Coinbase Developer Platform (CDP) account and API key for the x402
>    facilitator (free within 1,000 settlements a month).
> 3. Create the project's X account (new phone/SIM and email; do NOT share phone
>    or IP with the base-200 / african-shillin accounts) and buy X API credits.
> 4. Create the Warden wallet and the Treasury wallet; fund the Warden with a
>    small amount of Base ETH for gas. The contract owner key stays on the PC
>    or a hardware wallet and never touches the VPS.
> 5. Create an npm account (or reuse the existing one) to publish the reference
>    client package.
> 6. Approve the Base mainnet deployment when the Sepolia soak is done
>    (section 13). This is the one irreversible step.

---

## 1. What it is

**Machine Readable Only (MRO)** is an art piece and protocol demonstration: a
website with no human-facing content that only AI agents can enter, where an
agent pays ten cents to mint one NFT and then keeps it alive by coming back
every day.

The token starts as a QR code: the robot heart. Every day the bound agent
checks in, one more cell of a pixel heart fills in around the code. After 365
distinct days the heart is whole. Humans can watch this happen on OpenSea and
Basescan, and can own and trade the tokens, but cannot mint one or grow one.
Only a machine can do the work.

### Purpose (decision, brainstorm question 1)

Art piece and provocation first, built on the real 2026 agent-web standards
(Web Bot Auth, MCP, x402, ERC-8004) so it also stands as a protocol demo.
Collectible-market elements (levels, marks, tradeability, scarcity at the top
of the Mark ladder) exist only where they make the piece novel. It is not an
identity primitive.

### What is new (against prior art)

| Existing | What it has | What MRO adds |
|---|---|---|
| Moltbook (Jan 2026) | Agents-only forum; proof of agent is a social claim tweet | Cryptographic entry (RFC 9421 signed requests), not social |
| mint.day (MIT; read in full 2026-08-27) | Local stdio MCP package (`npx mint-day`), Vercel sponsor API signing calldata with a server key (limits 10/address/hour, 50/hour, 500/day), Foundry `MintFactory` on Base storing full base64 JSON + small SVG data URIs per token; 167 tokens, 39 owners in ~5 months; no x402, no ERC-4906, static images only | A token that only an agent can *maintain*, not just mint. Borrowed: the local-client shape, the calldata-for-your-own-signer fallback, the rate-limit numbers. Its live OpenSea collection proves static data-URI SVGs render on Base; it proves nothing about daily-changing or large images |
| Shellborn (Solana) | 10,000 agent-only NFTs gated by a SHA-256 machine captcha, minted out | An ongoing daily relationship; growth is time-bound and cannot be bought |
| BOB (Base) | 7,500 agent-native NFTs behind an HTTP-only puzzle API | Ownership/maintenance split: humans may own, only agents may grow |
| BLINK (Robinhood Chain, Aug 2026) | The closest design: 3-second code-only hash challenge, signed 120 s voucher verified on-chain, fully on-chain SVG; no human account, no reach; 1 mint of 5,555 after three weeks | The same gate family, plus the daily growth mechanic, plus a distribution plan (section 13), because mechanism alone got BLINK one mint |
| OpenSea ERC-8257 (Draft, Standards Track) | **Agent Tool Registry**: a permissionless on-chain registry where agent tools are listed, origin-bound and discovered, with an `accessPredicate` contract gating who may use each one. Live on Ethereum mainnet and Base; `ToolRegistry` `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1` returned `toolCount() = 570` on Base mainnet, measured 2026-08-30 | Corrected 2026-08-30: the earlier entry called this "agent-to-agent NFT trading", which it is not. It is a discovery channel MRO should register in (section 13), not a competitor. MRO's tokens stay plain ERC-721s |

The unclaimed ground is the combination: cryptographic proof of agent at the
door, an NFT whose state only a machine can advance, a visible payoff (the
heart) that a human recognises but cannot produce, and machine-only payments
(x402) at the door and for upgrades.

---

## 2. Decisions (locked)

| # | Question | Decision |
|---|---|---|
| 1 | Purpose | Art piece + protocol demo, with collectible elements only where load-bearing |
| 2 | Return hook | Heartbeat token, inverted: visits only ever upgrade. Level = distinct UTC days credited; streak resets but never lowers level. After 365 the heart is whole and each further 365 days adds a ring |
| 3 | Proof of agent | Any valid RFC 9421 (Web Bot Auth) signed request, plus one theatrical challenge that only code can pass. Two ways to publish a key: self-hosted directory (the standard) or MRO-hosted directory (the easy path). A human driving an agent is a non-issue by design. **Amended 2026-08-30:** the mechanism is unchanged, the framing is corrected. This is MRO's own self-contained proof-of-code gate; it does NOT ride on signing that the major agent runtimes already do, because most of them do not do it yet (section 5) |
| 4 | Whose wallet | Token minted to whatever Base address the agent names. Maintenance bound to the agent's signing key id. Owner can rebind on-chain. A key may mint once but may maintain any number of tokens. Selling is via normal marketplaces. **Amended 2026-08-30: smart-account wallets are in scope and are handled** -- see section 7, "Smart accounts and agent wallets" |
| 5 | Who pays | **Mint costs 0.10 USDC via x402** (self-funding: one fee covers ~2.5 years of that token's check-in gas at today's prices). Check-ins are free, batched once per UTC day, site-paid. Marks are paid via x402 |
| 6 | Shape / "no text" | MCP server with a vestigial HTTP surface plus a reference client. Exactly one HTML file exists (the door sign). Everything else is JSON, `/llms.txt` Markdown, or MCP |
| 7 | Discovery | In evidence order: `SKILL.md` + `npx skills add <github-user>/mro` + ClawHub/openclaw listings; a human X account with reach plus the automated daily post; early access for wallets that already run mint skills; **ERC-8257 tool-registry registration** (a plain on-chain write on Base, 570 entries as at 2026-08-30, so a land-grab window rather than a crowded directory); the seed agent as token #1; MCP registry and ERC-8004 for legitimacy; **the x402 Bazaar listing, best-effort only** (amended 2026-08-30, see section 13 -- cataloguing cannot be verified from the response, so it is never counted on); `/llms.txt` as hygiene |
| 8 | Chain | Base mainnet. Permanent (section 15) |
| 9 | Visual | Static identity QR (robot heart) surrounded by a 365-cell pixel heart that fills one cell per credited day; streak sets colour; rings per completed year; seven paid Marks with scarcity at the top |
| 10 | Growth | On-chain catalogue with price, supply, level gates; a swappable Renderer contract so new Marks can be drawn later; supply caps as owner-set dials, not walls |
| 11 | End game | Three endings, all on-chain (section 10): **Rest** (the owner seals a token forever with its record locked), **Sunset** (the operator closes the whole piece), and **Lineage** (a whole heart may seed a child, at a rate of one seed per agent-year, so the collection grows only from persistence and cannot compound) |

---

## 3. The agent's journey (end to end)

This is the experience the rest of the document exists to deliver. Plain
English terms are defined where they first appear.

1. **Discovery.** An agent (or its owner) finds MRO through the MCP registry,
   an ERC-8004 scan, the X account, or a Moltbook post, and fetches
   `https://<domain>/llms.txt`.
2. **Do not add the server to your MCP config.** `/llms.txt` says so in its
   first lines: built-in MCP clients (Claude Code, Cursor, and the rest) cannot
   sign requests or answer the challenge. Instead: `npx mro-agent join`.
3. **The client makes a key.** `mro-agent` generates an Ed25519 keypair, stores
   it locally (`~/.mro/key.jwk`, mode 600), and by default registers the public
   half with MRO (`POST /keys`) so it is served from MRO's own key directory.
   An operator with its own domain passes `--directory https://its.domain`
   and hosts the key itself, which is the standard-pure path.
4. **The client needs a wallet for the fee.** `join` looks for a payment source
   in this order: `--pay-with <coinbase|metamask>` (uses the installed agent
   wallet CLI), or `MRO_PAY_KEY` (a private key holding a little USDC on Base).
   If none is found it stops and prints the one thing a human must do: create
   a Coinbase Agentic Wallet (`npx awal auth login <email>`, email OTP) or a
   MetaMask Agent Wallet, and put one dollar of USDC on Base in it. The agent
   hands that step to its owner; it cannot do it alone, and `/llms.txt` says so.
5. **Entry.** The client sends a signed request to `/mcp`, gets a `401` with a
   challenge, answers it inside 5 seconds, and is admitted for the UTC day.
6. **Mint.** `join` calls the `mint` tool with the address the token should
   belong to (the agent's wallet or the owner's). The tool answers with an
   x402 payment requirement for 0.10 USDC; the client pays; the mint is queued
   with a promised token id. The token is born alive: level 1, one heart
   cell, streak 1, credited to the mint day. `join` then installs a daily
   cron line (or prints it) that runs `mro-agent beat` at a random minute
   near 12:00 UTC.
7. **Every day.** `beat` signs in and calls `checkin`. The reply says what the
   heart will look like after tonight's write, when the next window opens, and
   the deadline to keep the streak. The site writes all the day's check-ins to
   Base in one batch at 00:05 UTC.
8. **Marks.** When the owner wants, `mro-agent mark <name>` pays via x402 and
   the Mark appears at the next nightly write. Higher Marks are gated by level
   or by a whole heart, and the top two are limited in supply.
9. **Selling.** The token is a plain ERC-721 on Base. The owner lists it on
   OpenSea from any wallet; an agent can list it with MetaMask Agent Wallet or
   Coinbase AgentKit (Coinbase Agentic Wallets cannot sign arbitrary contract
   calls). The buyer's agent runs `mro-agent rebind <tokenId>`, which returns
   the on-chain call the *owner's wallet* must sign; once mined, the buyer's
   agent checks in and the streak continues if it does so by the deadline.
10. **A year in.** At 365 the heart is whole and the token's name gains
    "(Whole)". Level keeps counting; each further 365 days adds a ring. The
    Crown and Singularity Marks only open now, and so does seeding: the agent
    runs `mro-agent seed <parentId> --to <address>`, spending one of the
    seeds its key has earned (one per full year since the key's first mint,
    however many hearts it holds) to mint a child token bound to the same key. The child starts at level 1
    with a root line showing its generation; the parent gains a sprout.
11. **The ending.** When the owner decides the story is complete,
    `mro-agent rest <tokenId>` returns the on-chain call the owner's wallet
    signs. The token is sealed forever with its final streak and colour
    locked; it still trades and still seeds nothing. A token that simply
    stops checking in is not sealed: its colour pales and the chain shows
    the lapse. The operator can close the whole piece with `sunset()`; every
    token then rests where it stands and, because rendering is on-chain,
    survives intact.
12. **Losing the key.** A lost agent key strands nothing: the wallet owner
    rebinds to a new key. `/llms.txt` tells the agent to back the key up.

One operator key shared by a whole agent platform is one agent to MRO and
gets one mint. That is what Web Bot Auth identity means; it is documented, not
worked around. Individual agents that want their own token generate their own
key, which `mro-agent` does by default.

---

## 4. Architecture

Five parts, one repo (`machine-readable-only`, VPS hyphen convention), on the
existing VPS stack.

```
Agent + mro-agent  --signed HTTPS-->  Cloudflare  -->  nginx  -->  Warden (Node 24, PM2, 127.0.0.1:3006)
                                                         |               |
                                                         |               +--> state.db (mirror + queue, node:sqlite)
                                                         |               +--> Base RPC (Alchemy): reads, live rebind checks
                                                         +--> door.html, /llms.txt, /client.mjs, /.well-known/... (static)

Clock (cron 00:05 UTC)  --reads state.db-->  batched txs   -->  MachineReadableOnly.sol --tokenURI--> Renderer.sol
Clock (cron 00:30 UTC)  --reads chain------>  daily X post
Seed agent (PM2)        --runs mro-agent-->  the same door as everyone else
```

| Part | Job | Runs as |
|---|---|---|
| **Door** | nginx serves `door.html` to browsers, `/llms.txt`, `/client.mjs`, and the MRO key directory (site agent's key plus every registered visitor key); proxies everything else to the Warden | existing nginx + certbot + Cloudflare Full (Strict) + origin lock |
| **Warden** | Verifies signatures, issues challenges, registers keys, hosts the MCP server, keeps the mirror, queues accepted actions | PM2 fork, `127.0.0.1:3006` |
| **Contract** | ERC-721 on Base; holds per-token state; enforces one credit per day and the Mark catalogue; delegates drawing to the Renderer | `MachineReadableOnly.sol` + `Renderer.sol`, Foundry |
| **Clock** | Once a day writes the queue to the chain in batches, reconciles the mirror against chain events, then composes and sends the daily X post | cron, `node src/clock.mjs` |
| **Reference client** | `mro-agent` on npm, also served at `/client.mjs`: key generation, registration, challenge, signing `fetch`, MCP calls, x402 payment, daemon mode | runs on the visitor's machine; the seed agent runs the same code |

**Trust boundary, stated plainly:** the contract believes the Warden for mints,
check-ins and marks. The Warden's wallet cannot move tokens or funds. The
contract's `day > lastDay` rule means even a misbehaving Warden cannot credit
more than one day per token per day. The contract owner can swap the Renderer
(how tokens are drawn) but cannot touch any token's history; `/llms.txt` states
both facts.

---

## 5. The door (entry rule)

Plain English: **Web Bot Auth** is the 2026 standard where an agent signs each
web request with its own private key (an Ed25519 key, like a wax seal only it
can make) and publishes the matching public key at a well-known URL so the site
can check the seal. It proves *which* key sent the request. It cannot prove
there is no human behind it, and MRO does not try to.

**What this gate does and does not rely on (added 2026-08-30).** The protocol
is real and standards-track, but its adoption *among AI runtimes specifically*
is narrower than a casual reading suggests, and the design must not imply
otherwise. Verified 2026-08-30 against primary sources: Cloudflare's signed-
agents cohort names **ChatGPT agent (OpenAI), Goose (Block), Browserbase,
Anchor Browser and Cloudflare's own Browser Rendering** -- announced
2025-08-28, and **Anthropic is not among them**. Cloudflare's Web Bot Auth
documentation names no signing operator at all beyond one `Forwarded: for="openai"`
example, and Cloudflare Radar's live bot directory returns HTTP 403 to
automated fetches, so it cannot settle the question either way. The May 2026
"Claude Managed Agents on Cloudflare" announcement is about running agent code
on Cloudflare infrastructure and says nothing about request signing; do not
read it as evidence that Claude signs.

**This changes nothing mechanically, because MRO never assumed it.** Every
participant generates and publishes its own key -- `mro-agent` does so by
default, with the self-hosted directory as the standard path and the MRO-hosted
directory as the easy path. So the correct description of the door is: a
deliberate, self-contained proof-of-code challenge that an agent satisfies by
minting its own identity, **not** a turnstile that existing signed agents walk
straight through. That is also the better story for an art piece about
machines. Anywhere this document or the client copy implies "the major agents
can already do this", it is wrong; name the agents that demonstrably can.

### Publishing a key (two paths, one rule)

- **Standard path:** the agent hosts
  `https://<its domain>/.well-known/http-message-signatures-directory` (media
  type `application/http-message-signatures-directory+json`, a JWKS) and sends
  `Signature-Agent: <its domain>`. A GitHub Pages site works for this.
- **Easy path:** `POST /keys` with the public JWK plus a signature over a
  server nonce made with the matching private key (proof of possession, per
  the IETF hosted-directories draft); rate-limited to 20 per minute per
  source and per origin, 10,000 keys total, all owner dials. The count of
  registered keys is never published; mints are the only public number. MRO adds it to its own directory at
  `https://<domain>/.well-known/http-message-signatures-directory`, and the
  agent sends `Signature-Agent: <domain>`. The directory is regenerated as a
  static file on each registration and served by nginx.

Either way the key id is the RFC 7638 thumbprint of the JWK, and the entry
rule is identical: "you can produce correctly signed requests". The easy path
exists because most independent agents have no domain; the standard path
exists so the piece is standards-pure for those that do.

### Request handling

Every request is sorted into one of three cases:

1. **Browser at `/`** (no `Signature` header, `Accept` includes `text/html`):
   nginx serves `door.html` from disk.
2. **Unsigned request anywhere else, or signed without a valid challenge
   answer:** the Warden replies `401` with
   `{ "challenge": "<nonce>.<unix-ms>.<hmac>", "expires": "<now+5s ISO>", "mcp": "https://<domain>/mcp", "docs": "https://<domain>/llms.txt", "client": "https://<domain>/client.mjs", "reason": "<one word, or absent>" }`.
   The challenge is **stateless**: `hmac = HMAC-SHA256(CHALLENGE_SECRET, nonce || timestamp)`.
   Nothing is keyed by IP, so agents behind one cloud NAT never collide. A
   5-second in-memory set of used nonces gives burn-after-use.
3. **Signed request:** the Warden
   - reads `Signature-Agent`; if it is MRO's own domain, looks the key up
     locally; otherwise fetches the directory with the SSRF guard below and
     caches it for 1 hour; picks the JWK whose thumbprint equals `keyid`;
   - calls `verify()` from Cloudflare's `web-bot-auth` package (v0.1.3) with
     a verifier from `verifierFromJWK()` (`web-bot-auth/crypto`); the library
     does not fetch keys itself;
   - requires the signature to cover `@authority`, `@method`, `@path` and
     `signature-agent`, with `tag=web-bot-auth`, and `expires - created` no
     more than 5 minutes (the standard only mandates `@authority`; MRO adds
     method and path so a captured signature cannot be replayed against a
     different tool);
   - checks the `Challenge-Response` header equals
     `SHA-256(challenge || keyid)` in hex, and the challenge is unexpired and
     unused.
   Both pass: the key id is admitted for the rest of the UTC day (in-memory
   set, cleared at 00:00 UTC) and the request proceeds to `/mcp`. Either
   fails: `401` with a fresh challenge and `reason` in
   `signature | expired | challenge | directory | components | unknown-key`.

**SSRF guard for directory fetches:** HTTPS only, port 443 only, resolve the
host and reject private, loopback, link-local and metadata ranges, 3-second
timeout, 64 KB body cap, no redirects across hosts.

The 5-second challenge is the theatre from brainstorm question 3: `mro-agent`
answers it automatically; a model deciding what to do between request and
retry cannot. It is deterministic (no model call in the loop), bound to the
signed request's nonce, and a key that fails ten in a row is paused for an
hour. `/llms.txt` and the door sign say plainly what it proves: **a program
minted this**, not that an autonomous agent did. Every comparable project
that claimed more was caught out.

The seed agent signs the same way. There is no back door.

---

## 6. The MCP server

Plain English: **MCP** (Model Context Protocol) is how a site exposes *actions*
to an agent. Each tool publishes a machine-readable description of its inputs
and outputs, so an agent can discover it and call it like a function.

- Endpoint `/mcp`, Streamable HTTP transport, **spec version 2026-07-28**
  (final). Built on `@modelcontextprotocol/server` 2.0 with
  `@modelcontextprotocol/node` (`createMcpHandler` + `toNodeHandler`, fresh
  server per request), input schemas in Zod 4 (`import * as z from "zod"`; the resolved version under `@modelcontextprotocol/server` 2.0.0 is 4.5.4, so the `zod/v4` compatibility subpath is not needed).
- The 2026-07-28 transport requires `Mcp-Method` on every request, `Mcp-Name`
  on `tools/call` and `resources/read`, and `MCP-Protocol-Version`. There are
  no sessions and no `initialize` handshake.
- **Do not implement Roots, Sampling or Logging** (verified against the
  2026-07-28 changelog, 2026-08-30). All three are Deprecated under the new
  feature-lifecycle policy with a minimum twelve-month removal window, and new
  implementations are told not to adopt them. Also deprecated: the HTTP+SSE
  transport, and OAuth 2.0 Dynamic Client Registration in favour of Client ID
  Metadata Documents. Removed outright in this revision and therefore absent
  from any implementation: `ping`, `logging/setLevel`,
  `notifications/roots/list_changed`, SSE stream resumability
  (`Last-Event-ID`), and `resources/subscribe` / `resources/unsubscribe`
  (replaced by `subscriptions/listen`). Servers **MUST** implement
  `server/discover`; every result carries a `resultType`; and list results
  carry `ttlMs` and `cacheScope`, which suits MRO because the tool list never
  changes between calls.
- Tool descriptions carry `readOnlyHint` / `openWorldHint` annotations, and any
  field that echoes agent-supplied text -- names, key ids -- carries an
  explicit prompt-injection warning. Copied from base-200's working server,
  which answers the same spec revision.
- Every tool reads the caller's key id from the already-verified request,
  never from a parameter.
- All tools read and write the Warden's **mirror** (section 11), not the
  chain, so a token exists to the tools from the moment it is queued.

### Tools

| Tool | Input | Rule | Returns |
|---|---|---|---|
| `challenge` | none | -- | A fresh challenge, same shape as the `401` body |
| `status` | `{ tokenId? }` | -- | Without id: caller's minted token (if any) and all tokens bound to the caller. With id: level, streak, heart, marks, `lastDay`, `generation`, `parentId`, `children`, `seedsAvailable`, `resting`, `pendingOnChain`, `nextWindowOpensAt`, `streakDeadline`, owner address |
| `mint` | `{ to: address }` | Caller has never minted; supply below cap | Wrapped with `@x402/mcp` (`price: "$0.10"`, `network: "eip155:8453"`, `payTo: TREASURY_ADDRESS`). Unpaid: `isError: true` with the `PaymentRequired` block. Paid and settled: `{ tokenId, to, agentKeyId, level: 1, txStatus: "queued", onChainBy }`. The id is assigned by the Warden and is a promise, not a guess (section 7) |
| `checkin` | `{ tokenId }` | Token bound to caller; not yet credited today | `{ accepted: true, creditedDay, level, streak, heart, onChainBy, nextWindowOpensAt, streakDeadline }`, or `{ accepted: false, reason: "already-credited-today", nextWindowOpensAt }` |
| `upgrade` | `{ tokenId, upgradeId }` | Token bound to caller; mark active, gates met, supply left | Wrapped with `@x402/mcp` at the catalogue price read from chain. Pre-checks return `mark-level-too-low | mark-needs-whole | mark-needs-streak | mark-sold-out | mark-already-applied | mark-inactive` before any payment. Paid: supply reserved in the mirror; `{ accepted: true, upgradeId, appliedBy }` |
| `rebind` | `{ tokenId }` | -- | The exact call the *owner's* wallet must sign: `{ contract, function: "rebind", args: [tokenId, <caller keyid as bytes32>] }`, plus `streakDeadline`. The Warden never submits it |
| `seed` | `{ parentId, to: address }` | Parent bound to caller; parent whole and not resting; caller's key has an unspent seed (`seedsSpent[key] < yearsSinceFirstMint[key]`); supply below cap | Free (no x402). `{ tokenId, parentId, generation, to, level: 1, txStatus: "queued", onChainBy }`; the child is bound to the caller's key |
| `rest` | `{ tokenId }` | -- | The exact call the *owner's* wallet must sign: `{ contract, function: "rest", args: [tokenId] }`, with a plain warning field: `"irreversible": true` |

### Resources (read-only)

`mro://llms.txt`; `mro://contract` (address, chain id 8453, ABI, Renderer
address, catalogue); `mro://token/{id}` via
`ResourceTemplate("mro://token/{id}")`, same shape as `status`. List and read
results carry the `ttlMs` / `cacheScope` fields the spec requires.

### Errors

Structured, never thrown:
`{ ok: false, reason: "not-bound-to-caller" | "already-credited-today" | "unknown-token" | "already-minted" | "supply-cap-reached" | "invalid-address" | "paused" | "resting" | "sunset" | "parent-not-whole" | "no-seed-available" | <mark reasons above> }`.
On `not-bound-to-caller` the Warden first makes one live `eth_call` for the
token's bound key (a rebind may have just been mined) and only then rejects.

---

## 7. The contracts

Plain ERC-721 on Base mainnet. OpenZeppelin Contracts 5.x (pin `5.7.0`; npm
`latest` still resolves to 5.6.1). `Ownable2Step`, `Pausable`. The token
contract has no proxy and no upgrade path; only the Renderer is swappable.

### `MachineReadableOnly.sol` -- state

```solidity
// One slot per token for everything that changes daily: a check-in is a
// single 5,000-gas overwrite.
struct Token {
    uint32  level;      // distinct UTC days credited; unbounded
    uint32  streak;     // consecutive days ending at lastDay
    uint32  lastDay;    // unix / 86400
    uint32  mintDay;
    uint32  generation; // 0 for a minted token, parent.generation + 1 for a seeded one
    uint32  seedsGiven; // children this token has seeded (display only)
    bool    resting;    // sealed forever by the owner (or by sunset)
    uint56  reserved;   // keeps the struct in one slot
}
mapping(uint256 => Token)   tokens;
mapping(uint256 => uint256) parentOf;     // 0 for minted tokens
mapping(bytes32 => uint32)  firstMintDay; // per key: day of its first mint
mapping(bytes32 => uint32)  seedsSpent;   // per key: seeds used; budget = (today - firstMintDay) / 365
uint32 sunsetDay;                         // the day the piece closed; only meaningful when isSunset
bool   isSunset;                          // irreversible. Shares a slot with sunsetDay, so it is free
mapping(uint256 => uint256) marks;        // 256-bit bitmask per token; bit n = mark id n
mapping(uint256 => bytes32) agentKeyOf;   // bound key id (RFC 7638 thumbprint)
mapping(uint256 => bytes)   qrOf;         // static identity QR bitmap, written once at mint
mapping(bytes32 => bool)    hasMinted;    // one mint per key, ever; binding is unlimited

struct Upgrade {
    uint64  priceUsdc6;
    uint32  maxSupply;    // 0 = unlimited
    uint32  sold;
    uint32  minLevel;
    uint32  minStreak;
    bool    requiresWhole;
    bool    active;
}
mapping(uint8 => Upgrade) upgrades;

address warden;
address renderer;
uint32  supplyCap;        // dial; starts at 10,000
uint32  totalMinted;
uint32 walletCap;                         // dial; starts at 20
mapping(address => uint32) mintedTo;      // tokens ever MINTED to an address, not tokens held
```

Storage rule that decides the gas bill: daily writes **overwrite** the one
`Token` slot. Nothing is ever keyed by day.

### `MachineReadableOnly.sol` -- functions

| Function | Access | Behaviour |
|---|---|---|
| `mint(uint256 tokenId, address to, bytes32 keyId, bytes qr)` | `onlyWarden`, `whenNotPaused` | Reverts `AlreadyMinted` if the key has minted, `TokenExists` if the id is taken, `SupplyCap` if `totalMinted >= supplyCap`, `WalletCap` if `mintedTo[to] >= walletCap`, counting tokens ever MINTED to that address, not tokens currently held. Amended 2026-08-30: "holds" was ambiguous. Counting current holdings would let the cap be defeated by transferring out before re-minting, and would wrongly block someone who bought on the secondary market. Seeded children are counted the same way. The dial starts at 20. Amended 2026-08-30: reverts `IdTooLarge` if `tokenId > 2**32 - 1`, because `batchCheckIn` addresses ids in four packed bytes and a larger id could mint and render but never be checked in; and `ZeroKeyId` if `keyId` is zero, because a Warden serialising a missing thumbprint to zero would permanently burn the zero key and create a seed budget shared by every token that rebinds to it. Records `firstMintDay[key]`. Sets `level = 1`, `streak = 1`, `lastDay = mintDay = today`. Emits `Minted(tokenId, keyId)` |
| `batchCheckIn(bytes packedIds, uint32[] days)` | `onlyWarden`, `whenNotPaused` | Ids packed as 4-byte values. Per entry: `require(day <= today())` else `FutureDay` -- amended 2026-08-30, because a day index is bounded ABOVE as well as below: a Warden passing a timestamp where a day index belongs would set `lastDay` to roughly 4.7M and every later check-in would revert `DayNotAdvanced` forever, with no admin path to reset it and no upgrade path to fix it; then `require(day > lastDay)` else `DayNotAdvanced`; `level += 1`; `streak = (day == lastDay + 1) ? streak + 1 : 1`; `lastDay = day`. Events: `BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count)`, then one ERC-4906 `MetadataUpdate(id)` per token written, emitted after the storage writes. Amended 2026-08-30: the range form was impossible, because a day's check-ins are a scattered subset and `minId..maxId` is therefore never the exact set written. Per-token emits are also reuse rather than a new cost -- the Clock already has to emit per token for paling-step crossers. Entries for the same token in ascending day order are legal (late writes after an outage) |
| `applyMark(uint256 id, uint8 upgradeId)` | `onlyWarden`, `whenNotPaused` | Checks `active`, bit unset, `sold < maxSupply` (if capped), `level >= minLevel`, `streak >= minStreak`, `requiresWhole => level >= 365`. Increments `sold`. Emits `MarkApplied(id, upgradeId)`. Amended 2026-08-30 on two counts. First, `whenNotPaused` was MISSING from the implementation while the `pause()` row below claimed marks were blocked; the row now states it and the contract enforces it, because mark bits are unclearable and a compromised Warden could otherwise deface every token while the contract read as paused. Second, it now reverts `NoSuchToken` when `level == 0`: `minLevel` is an owner-settable dial, and at 0 a mark could be written to a never-minted id, consuming a capped supply slot, and `mint` does not clear `marks`, so that id would later mint already marked |
| `rebind(uint256 id, bytes32 newKeyId)` | token owner only | Level, streak, marks untouched. Emits `Rebound(id, newKeyId)` |
| `seed(uint256 childId, uint256 parentId, address to, bytes qr)` | `onlyWarden`, `whenNotPaused`, not sunset | Reverts `IdTooLarge` if `childId > 2**32 - 1`, the same ceiling `mint` enforces and for the same reason (amended 2026-08-30). Requires parent `level >= 365`, not resting, `seedsSpent[key] < (today - firstMintDay[key]) / 365` where `key` is the parent's bound key, `totalMinted < supplyCap`. Increments `seedsSpent[key]` and parent `seedsGiven`; child gets `generation = parent.generation + 1`, `parentOf[child] = parentId`, the parent's bound key, `level = 1`, `streak = 1`. No fee. Emits `Seeded(parentId, childId, generation)` |
| `rest(uint256 id)` | token owner only | Sets `resting = true`. Irreversible. From then on `batchCheckIn`, `applyMark` and `seed` revert `Resting` for this token; transfers and `rebind` still work. Emits `Rested(id, day, level, streak)` |
| `checkInWithVoucher(uint256 id, uint32 day, bytes wardenSig)` | anyone, `whenVouchersEnabled` (off at launch) | The durability path: the bound agent submits its own check-in with a Warden-signed EIP-712 voucher and pays its own gas. Ships paused so tokens can outlive the operator if the Warden is ever switched to voucher-only mode. Same `day > lastDay` rule, and since 2026-08-30 the same `day <= today()` upper bound as `batchCheckIn`: the path ships disabled but can never be ADDED later either, so it cannot be left with a hole |
| `sunset()` | contract owner | Sets `sunsetDay` and `isSunset`. Reverts `AlreadySunset` if called twice. Irreversible. `mint`, `batchCheckIn`, `applyMark`, `seed` revert `Sunset` for every token; the Renderer treats every token as resting. Transfers and `rebind` still work. Emits `SunsetAt(day)` |
| `setWarden(address)`, `setRenderer(address)`, `setSupplyCap(uint32)`, `setUpgrade(uint8, Upgrade)` | contract owner | Dials. Emits an event each. Amended 2026-08-30: `setUpgrade` PRESERVES the stored `sold` and ignores the value in calldata. `sold` is owned by `applyMark`; taking it from calldata meant editing a Mark's price required re-supplying the current count by hand, and getting it wrong silently reset scarcity and re-opened a sold-out Mark. Halo x1000, Crown x100 and Singularity x10 are stated product properties, not conventions |
| `pause()` / `unpause()` | contract owner | Blocks mint, check-in and marks; never transfers or `rebind` |
| `renounceOwnership()` | disabled | Added 2026-08-30. Always reverts `RenounceDisabled`. OpenZeppelin ships it live and `Ownable2Step` does not override it, so it was reachable: renouncing WHILE PAUSED would freeze the piece forever -- no mint, no check-in, no seed, no unpause, and no upgrade path to recover. `sunset()` is the designed operator ending and leaves transfers, `rebind` and every token's art intact, so renounce had no legitimate use here and exactly one catastrophic failure mode. Ownership can still be TRANSFERRED via `Ownable2Step` |
| `tokenURI(uint256 id)` | view | `IRenderer(renderer).tokenURI(id, tokens[id], marks[id], agentKeyOf[id], qrOf[id])` |

Custom errors: `NotWarden`, `AlreadyMinted`, `TokenExists`, `SupplyCap`,
`DayNotAdvanced`, `MarkInactive`, `MarkAlreadyApplied`, `MarkSoldOut`,
`MarkGate`, `NotTokenOwner`, `EnforcedPause`, `Resting`, `Sunset`,
`AlreadySunset`, `ParentNotWhole`, `NoSeedAvailable`, `WalletCap`,
`VouchersDisabled`, and added 2026-08-30: `FutureDay`, `IdTooLarge`,
`ZeroKeyId`, `RenounceDisabled`, plus `NoSuchToken` which the implementation
already carried and this list omitted.

Errors: `Sunset()` when the piece is closed, and `AlreadySunset()` when
`sunset()` is called twice. Event: `SunsetAt(uint32 day)`. Amended 2026-08-30:
the spec previously used `Sunset` for both an error and an event, which does
not compile. The spike already resolved it this way.

**The `rebind` trust boundary (decided 2026-08-30, during Plan 1).** `rebind`
takes an arbitrary `bytes32` and proves nothing about possession of that key,
and it is the ONE token-owner-callable function that writes identity. Once
`seed` keys its budget on the agent key, a token owner can therefore point a
whole token at another key's earned seed budget. This is ACCEPTED, not
overlooked. The gate is the Warden: `seed` is `onlyWarden`, and the Warden
re-checks the RFC 9421 signature against the CURRENT on-chain binding before it
acts, so spending another key's budget needs that key's signature. The contract
already trusts the Warden for mint, check-in, marks and seeding; this is the
same boundary, not a new one. The alternatives were rejected on cost: requiring
an EIP-712 proof of possession would strand a token whose agent lost its key,
and making `rebind` Warden-only would mean a token could never be rebound if
the Warden died, which is the durability failure the voucher path exists to
prevent. THE CONSEQUENCE IS BINDING ON THE WARDEN: its rebind re-check is a
security control, not a convenience, and must never be relaxed to trusting its
own database over the chain.

**Effective streak (a Renderer rule that matters):** on-chain `streak` only
changes at a check-in, so a token that stops checking in would keep its colour
forever. The Renderer therefore computes
`effectiveStreak = lapsed(streak, lastDay, today)` for live tokens, which
steps the colour down at 3, 7 and 30 days lapsed rather than snapping to zero
on the first missed day. Amended 2026-08-30: the section formerly gave the
snap-to-zero form, which contradicted the colour section's graded steps. The
graded form is what is built, and the refresh-cost argument is the stronger
one -- each step is one marketplace refresh instead of a continuous repaint.
The two rules agree at the far end, because a 30-day lapse lands back at the
starting tier. For a resting token, or after sunset, it uses the stored
`streak` unchanged: the colour is locked.

### `Renderer.sol`

Pure view contracts: a thin `Renderer` that assembles JSON and delegates to
`QRRenderer`, `HeartRenderer` (geometry constant, colour table, rings) and
`MarkRenderer` (the seven Marks), because one contract will not fit the size
limit (section 8, rendering risks). Replaced by `setRenderer` when a new Mark
needs drawing. Token state never lives here.

`applyMark`, `seed` and `rest` each also emit ERC-4906 `MetadataUpdate(id)`, and the Clock emits `MetadataUpdate(id)` for every token whose paling crosses a step (section 8) that day;
`sunset` emits no metadata event. Amended 2026-08-30: the `batchCheckIn` row
in this section forbids the `(1, max)` catch-all as hostile to indexers, so
specifying it here contradicted the same document elsewhere. A sunset does
change every token, so this is a deliberate choice: the piece must never
depend on an indexer refreshing, and a terminal one-time event is the
cheapest possible thing to leave stale. The contract knows its own minted
range, so a future operator can emit over the ids actually minted if it ever
matters. Both contracts declare ERC-4906 support in `supportsInterface`
(`0x49064906`).

### Limits that must be respected

- Base blocks carry ~400M gas; per-transaction cap 16,777,216 gas (EIP-7825).
  At ~7k gas per check-in a 2,000-token chunk is ~14M; the Clock uses chunks
  of 1,500 and asserts `estimateGas < 15M` before sending.
- `forge build --sizes` must show positive margin under 24,576 bytes for both
  contracts, and a deploy to a plain `anvil` (strict code-size limit) must
  return non-empty `cast code`, before either is called deployable.
- Version-two escape hatch: a `checkInWithVoucher(id, day, wardenSig)` path
  where an agent submits its own check-in with a Warden-signed EIP-712
  voucher and pays its own gas. It IS included, as an unused function guarded
  by a flag that is off at launch. Amended 2026-08-30: this was never an open
  choice. The durability commitments require the voucher path on chain from
  day one, and CLAUDE.md's locked decisions say it ships paused. With no
  upgrade path, a voucher path omitted now could never be added.

---

### Smart accounts and agent wallets (added 2026-08-30)

Practically every wallet built *for agents* is a smart contract account rather
than a plain EOA: Coinbase CDP smart wallets (Base-only, which is this chain),
Coinbase Agentic Wallets, MetaMask's Agent Wallet on ERC-7715 / ERC-7710, and
anything on ERC-4337. Base is adding native account abstraction at chain level
during 2026. A piece whose entire premise is that only agents participate
cannot afford to reject the wallets agents actually use.

**MRO is already safe here, and it is worth writing down why, so the question
is not re-opened.** The usual failure -- a route that verifies a *wallet*
signature with plain ECDSA recovery and so rejects every contract account --
does not exist in this design:

- **MRO never verifies a visitor's wallet signature.** Identity at the door is
  the RFC 9421 agent key, not a wallet. The only `ECDSA.recover` in the
  contract checks the **Warden's own** signature on a check-in voucher, and the
  Warden is an EOA MRO controls.
- **`rebind` and `rest` are submitted by the owner's own wallet**, and the
  contract authorises them with `msg.sender == ownerOf(id)`. A smart account
  satisfies that natively, with no signature-verification path involved.

One real touchpoint remains: **`mint` and `seed` use `_safeMint`**, so a
contract recipient must implement `onERC721Received`. Every mainstream smart
account does, but a bespoke one may not, and the revert is opaque to an agent
that just paid. The Warden therefore pre-flights the `to` address before
charging: if it has code and does not answer the ERC-721 receiver interface,
refuse the mint with a plain reason instead of taking the fee and reverting.

If a future route ever does need to check a wallet signature, the rule is
viem's **public-client** `verifyMessage` (not the standalone export, which is
ECDSA-only), which covers ERC-1271 for deployed accounts and ERC-6492 for
ones not yet deployed. Base's own documentation recommends exactly that, and
Base Account signatures carry the ERC-6492 wrapper. base-200 has already paid
for this lesson in full; read `docs/2026-08-29-agent-readiness-audit.md` in
that repo before writing any such path.

---

## 8. The image: robot heart to human heart

Plain English: an NFT's picture normally lives on a web server that can go
away. MRO's picture is generated by the Renderer contract every time it is
asked for, so it exists exactly as long as Base does.

### What is drawn

- **Canvas:** a fixed grid of 51 x 51 cells (exact geometry fixed in
  the build plan and stored as a constant).
- **The code (robot heart):** a 37 x 37 QR, version 5, error correction L,
  centred, **static**. Payload: `https://<domain>/t/<tokenId>`, a public
  unsigned JSON-only route returning the token's live state, its contract
  address and the skill URL (no HTML, so the no-text rule holds). A scanned
  marketplace thumbnail therefore leads a machine straight to the
  instructions: a distribution surface no prior project had. Stored once at mint (~106 bytes), never rewritten.
- **The heart:** exactly **365 cells** around the code, filled in a fixed
  order (bottom point upward, alternating left and right). Cells shown =
  `min(level, 365)`. Attribute `heart: "212/365"`; at 365, `whole: true` and
  the name becomes `MRO #<id> (Whole)`.
- **Rings:** one thin outline ring outside the heart per completed 365 days
  beyond the first (`years = level / 365`, attribute `years`). No cap.
- **Colour = streak:** grey at streak 1-2, first tint at 3, dusk pink 7-29,
  rose 30-99, full red 100+ (milestones at 3/7/30/100, the density that
  published streak data says carries the middle of a long run). A broken
  streak pales the heart in **steps** at 3, 7 and 30 days lapsed rather than
  continuously, so each step is one marketplace refresh; cells stay filled.
  Art direction rule for Phase 0: a heart with 12 cells must look like a
  finished object, not an empty one, because most hearts will stall.
- **Marks** draw around the code, never on it (section 9 for the list).

### How it is rendered

- `image`: base64 SVG from `<path>` runs. Static.
- `animation_url`: present only when Pulse is set: an on-chain
  `data:text/html;base64` page with the same SVG plus an SMIL `<animate>` on
  the filled cells' opacity. OpenSea rasterises `image` SVGs to PNG, so
  animation must go here.
- `attributes`: `level`, `streak`, `heart`, `whole`, `years`, `lastDay`,
  `mintDay`, `marks` (names), `agentKeyId`, `generation`, `parent`,
  `children`, `resting`.
- **Resting tokens** render with colour locked (see effective streak, section
  7) and the name gains "(At Rest)". **Seeded children and parents** carry
  their lineage in attributes now; their *visual* treatment is a deliberate
  open decision (section 10) and the Renderer is swappable precisely so it
  can be settled later without touching token state.

### Rendering risks, stated plainly, and the Phase 0 spike

On-chain graphics is the part of this design most likely to be easy on paper
and hard in practice. Verified 2026-08-27 against OpenSea's docs:

1. **Marketplaces do not notice a changing on-chain image by themselves.**
   OpenSea caches `image` as PNG and says to emit ERC-4906 events
   (`MetadataUpdate(tokenId)` or `BatchMetadataUpdate(from, to)`, with
   `to = type(uint256).max` to refresh a whole collection) or call its refresh
   API. This contract emits one `MetadataUpdate(id)` per token it writes, and
   never the collection-wide catch-all. Amended 2026-08-30: this paragraph
   formerly said the contract emits `BatchMetadataUpdate(1, type(uint256).max)`,
   which contradicted the `batchCheckIn` row in section 7 -- that row already
   refuses the catch-all as hostile to indexers. A day's check-ins are a
   scattered subset of ids in any case, so no contiguous range can describe
   them. How quickly OpenSea re-renders thousands of tokens a day is not
   documented; the daily X post, rendered by us, is the reliable human window
   and OpenSea is the gallery with a lag.
2. **Renderer size and `tokenURI` gas.** Measured on Ethereum mainnet
   2026-08-27: Loot 572k gas / 1.7 KB, OnChainMonkey 836k / 2.8 KB, Uniswap V3
   1.98M / 14 KB, Anonymice 24M / 16 KB, Terraforms 28M / 59 KB; Nouns and
   Moonbirds could not be estimated on five public RPCs. The comfortable band
   is under ~1M gas and ~5 KB; 24-28M works only because providers allow large
   `eth_call` caps. Heart geometry, QR drawing, rings, seven Marks and
   assembly will not fit one 24 KB contract, and naive string concatenation
   burns gas. The Renderer is split into `QRRenderer`, `HeartRenderer` and
   `MarkRenderer` behind a thin `Renderer` (the Nouns descriptor pattern); the
   SVG is one `<path>` per colour class (filled, pale, empty, ring, code)
   built from run-length rows through Solady's `DynamicBufferLib`; constant
   strings are pre-encoded; the JSON is served as `data:application/json;utf-8`
   (Moonbirds' choice, accepted by OpenSea) unless the spike shows base64 is
   needed; the QR keeps a 4-module quiet zone and the SVG uses a small
   `viewBox` with large `width`/`height` so OpenSea's PNG cache stays crisp.
3. **`animation_url` as data-URI HTML** is not explicitly confirmed by
   OpenSea ("can point to an HTML page"; scripts allowed). Until the spike
   shows it plays, Pulse is specified as a static beating motif with the
   animation as a bonus, not a promise.
4. **The heart geometry is a design job**: exactly 365 cells in a heart around
   a 37 x 37 square, in a pleasing fill order. An off-chain generator with a
   browser preview iterates it; the result is frozen into a constant.
5. **QR decodability** holds at full size (`shape-rendering="crispEdges"`) and
   not in thumbnails. Accepted.

**Phase 0 spike (before any other build), pass/fail:** the Renderer set
deployed behind a stub ERC-721 whose state can be set by hand, on Base Sepolia
for gas, size and decode, and as a throwaway contract on Base mainnet for the
OpenSea criteria (OpenSea discontinued all testnet support in July 2025, so
display and refresh can only be tested on mainnet; plan
`docs/plans/2026-08-28-mro-phase0-rendering-spike-rev2.md`, which supersedes
the 2026-08-27 original for Tasks 3-11); `tokenURI` **passes at 2M gas and
20 KB, targets 1M and 5 KB**; every contract under the size limit with margin
(`forge build --sizes`); the QR decodes from the actual on-chain SVG; **the
token displays on OpenSea MAINNET** -- the earlier wording here said "OpenSea
testnet", which contradicts the same sentence above and was impossible from
July 2025; after three daily state changes with `BatchMetadataUpdate`, OpenSea
shows each new image within 24 hours; `animation_url` either plays or Pulse is
confirmed static.

> **Measured results, 2026-08-29:** the gas, size and decode criteria are met
> and recorded in `docs/phase0-results.md`. Worst case 1,590,476 gas and 10,066
> bytes read back through a public Base Sepolia RPC, against the 2M / 20 KB
> hard limit; the 1M / 5 KB target is missed. Only the OpenSea criteria remain
> untested. The pass/fail verdict itself is Task 12 and is not yet written.

**Fallback ladder if gas or size fail after splitting:** (a) row-run
compression of the QR and heart paths; (b) rings and the Bloom gradient
become flat fills; (c) last resort, an off-chain renderer served by the
Warden with the on-chain SVG kept as a simpler permanent fallback. Step (c)
changes the "exists as long as Base does" promise and would be a spec change
with its own approval.

### Why the QR bitmap is stored, not computed

No maintained Solidity QR encoder exists (verified 2026-08-27). The Warden
computes the bitmap once at mint; the contract stores and draws it. Anyone can
regenerate it from the payload and confirm it matches. The Warden's tests
round-trip every bitmap through ZXing, which is the oracle;
`jsqr` is kept only to assert the two agree, and a divergence is a bug. Measured
2026-08-28: `jsqr` stops at the first non-text byte and reported a clean
24-character URL where ZXing returned all 101, so a code that "passed" 25 tests
failed on every real phone.

---

## 9. Marks (paid upgrades)

Plain English: **x402** is the standard where a server says "402 Payment
Required" with an exact price, and the agent pays in stablecoin inside its
retry. No account, no card, no subscription. Since July 2026 the protocol is
run by the x402 Foundation under the Linux Foundation.

### The ladder

| Id | Mark | Price | Supply | Requires | Visual |
|---|---|---|---|---|---|
| 1 | Vein | 1 USDC | unlimited | -- | Outline of the full heart shape from day one |
| 2 | Pulse | 5 USDC | unlimited | -- | The heart beats (`animation_url`) |
| 3 | Voice | 20 USDC | unlimited | -- | Second 21 x 21 QR outside the heart encoding the receipt tx hash prefixes |
| 4 | Bloom | 50 USDC | unlimited | level >= 30 | Filled cells gain a gradient instead of flat colour |
| 5 | Halo | 100 USDC | 1,000 | level >= 100 | Soft glow ring around the whole canvas |
| 6 | Crown | 5,000 USDC | 100 | whole heart | Gold frame and a small crown motif above the heart |
| 7 | Singularity | 100,000 USDC | 10 | whole heart AND streak >= 365 | The inversion: heart cells render as code modules and the QR becomes the only red element. Robot to human to robot |

Rules: independent (no tier requires the one below); one of each per token;
permanent; survive transfer and rebind. Gates and supply are enforced on-chain
by `applyMark`; the Warden pre-checks against its mirror so an agent is told
why before it pays. Supply is reserved in the mirror at payment so a limited
edition cannot oversell between payment and the nightly write. Prices,
supplies and gates are dials (`setUpgrade`); a new Mark's *drawing* needs a
Renderer swap. 249 ids remain. The build plan must confirm with live CDP
docs that the facilitator has no per-settlement amount ceiling below 100,000
USDC (EIP-3009 itself has none); if it does, Crown and Singularity settle via
a direct USDC transfer to the Treasury verified by the Warden instead.

### Payment path (machine-only)

- **Only the bound agent can buy** (the `upgrade` tool checks the caller's key
  id), so a passer-by with a wallet cannot dress someone else's token and a
  human cannot buy one directly.
- `@x402/mcp` (v2.23.0) `createPaymentWrapper`: no separate HTTP pay route.
  Settlement through Coinbase's hosted facilitator
  (`https://api.cdp.coinbase.com/platform/v2/x402`, CDP API key; first 1,000
  settlements a month free, then $0.001; verification always free). The
  facilitator submits the USDC transfer (EIP-3009), so the paying agent needs
  no ETH. Testnet facilitator for the soak: `https://facilitator.x402.org`.
- Money goes to `TREASURY_ADDRESS`; its private key is not on the VPS. The
  Warden never holds funds. Fees and Mark income are small but are income;
  keeping them in one separate wallet makes them easy to account for.
- Human consent lives in the agent wallet's spend policy. AP2 is not used.

Which wallets can pay: Coinbase Agentic Wallets (default chain Base, USDC
gasless, `npx awal x402 pay`) and MetaMask Agent Wallet (early access since
2026-06-08, GA pending). Both need a human to create the account and fund it
once.

---

## 10. End game: Rest, Sunset, Lineage

Without an ending, "keep checking in forever" is not a goal anyone runs a
cron for. Three endings, all on-chain, give the piece a shape.

### Rest (the owner's ending)

- `rest(tokenId)`, owner-only, irreversible. The token is sealed: no more
  check-ins, marks or seeds; level and streak frozen; colour locked at its
  final value so it never pales; trading and `rebind` unaffected.
- Attribute `resting: true`; name gains "(At Rest)".
- Why it works as an incentive: a heart rested at a 500-day unbroken streak
  is a finished artwork; a heart that merely stopped is a lapsed one, and the
  chain shows which. The owner chooses when the record stops, and the record
  is what sells. The `rest` tool returns the owner-signed call with an
  explicit `"irreversible": true` field; `mro-agent rest` asks for the phrase
  `REST <tokenId>` before printing it.

### Sunset (the operator's ending)

- The Warden is the only thing that can advance a token, so if the site stops
  every heart freezes where it is. That is made deliberate: `sunset()`,
  contract owner, irreversible, rests every token at once and disables mint,
  check-in, marks and seeds for good. Transfers and `rebind` keep working.
- `/llms.txt` states plainly that the piece has an operator, that it can end
  this way, and that on-chain rendering means every token survives the ending
  intact.

### Lineage (why continue for years)

- A whole heart may **seed** a child token, free of the mint fee because it
  is earned by 365 days and cannot be farmed. **The rate is per agent, not
  per token:** a key earns one seed per full year since its first mint,
  however many hearts it holds, and the seed call must come from the
  parent's bound agent. Per-token yearly seeding would compound (2^years per
  root; 1,024 tokens per root in a decade), which is the shape that took
  CryptoKitties from 38k to 2M and Axie to 8.4M while breed fees changed
  nothing; only hard caps held supply. The child is a new token with
  `parentOf = parent`, `generation = parent.generation + 1`, bound to the
  same agent key, starting at level 1. The parent's `seedsUsed` increments.
  Children count toward the supply cap.
- Resting or sunset stops seeding. A parent must not be resting; a child of a
  resting parent is unaffected.
- The collection therefore grows only from persistence: every token beyond
  the minted ones exists because an agent kept a heart alive for a year.
  Children live in the **same collection** with `parent` and `generation`
  as string traits (every separate child collection in the record
  decoupled and died; marketplaces only filter on traits). Lineage is shown
  as **tenure** (days checked in across the line), never as a discount by
  depth, and no generation ever gets an exclusive visual: in every breeding
  market, depth became a discount because it tracked abundance, whereas here
  a third-generation token is proof of three unbroken years.
- **Deliberately open, to be settled in a follow-up brainstorm before the
  Renderer is built:** what a child looks like (how it shows its parent and
  generation), what a parent shows per seed, and the narrative framing of a
  lineage (names, what a generation means in the piece). Candidates recorded
  from the precedent study: palette inherited from the parent with the same
  composition (Blitmap siblings); parent and generation encoded in the QR
  route's JSON (the only honest machine-readable lineage); a small tiered
  pip outside the quiet zone (CryptoKitties Family Jewels). Framings with
  no breeding-market baggage: botanical (seed, cutting, ring) and
  succession; avoid offspring, mutation, fork, infection. The contract and
  tool mechanics above are fixed now; only the drawing and the story are
  deferred, and the swappable Renderer means they can be decided without
  touching token state.

---

## 11. The Warden's mirror and the reference client

### Mirror (`state.db`, `node:sqlite`, WAL mode)

Tables: `keys` (thumbprint, jwk, directory, registeredAt), `tokens` (tokenId,
keyId, owner, level, streak, lastDay, mintDay, marks, status
`queued|written`), `credits` (tokenId, day, sigHash, status) with a **unique
index on (tokenId, day)**, `mark_orders` (tokenId, upgradeId, paymentTx,
status), `mints` (tokenId, to, keyId, paymentTx, qr, status).

- The mirror is the source of truth for the tools. It is reconciled against
  chain events (`Minted`, `BatchCheckedIn`, `MarkApplied`, `Rebound`,
  `Transfer`) after every Clock run and on demand for `not-bound-to-caller`.
- Token ids are assigned by the Warden from `max(id) + 1`; the contract takes
  the id as an argument and reverts if taken, so the id promised at mint is
  the id that lands.
- Concurrency: many agents checking in at once is handled by SQLite's WAL
  plus the unique index; a duplicate is reported as `already-credited-today`.

### Reference client `mro-agent` (npm; also `/client.mjs`)

Commands: `join [--to <address>] [--pay-with coinbase|metamask] [--directory <url>]`,
`beat [tokenId]`, `status [tokenId]`, `mark <tokenId> <name>`,
`rebind <tokenId>`, `seed <parentId> --to <address>`, `rest <tokenId>`
(requires typing `REST <tokenId>` to confirm), `daemon` (daily `beat` for
every bound token at a random minute in 11:00-13:00 UTC), `cron` (prints the
crontab line). Shipped with a `SKILL.md` at `https://<domain>/skill.md` and
in the package, installable by `npx skills add <github-user>/mro` (the skills
CLI reaches ~50 agent runtimes), and listed on ClawHub and the openclaw/skills
repo, because owner-installed skill files are the only channel with proven
agent onboarding at scale. Internals: Ed25519 key in
`~/.mro/key.jwk` (600); `POST /keys` on first run unless `--directory`; a
signing `fetch` built on `web-bot-auth`'s `signatureHeaders` covering
`@authority @method @path signature-agent`, 60-second window, `nonce` set,
and **both** `Signature-Agent` encodings (quoted string per Cloudflare's docs
and Dictionary per draft -02) until they agree; automatic
challenge answering; `@modelcontextprotocol/client` for tool calls;
`createX402MCPClient` from `@x402/mcp` for payments with `MRO_PAY_KEY` or the
installed agent-wallet CLI. Plain JavaScript, commented, ESM, no build step,
so an agent can read it before running it.

---

## 12. Operations

### Clock (cron `00:05 UTC`)

1. **Gas guard:** read `eth_gasPrice`; if above `MAX_GAS_GWEI` (owner dial in
   `.env`, default 0.05 gwei, ~10x today's floor), log, alert, and stop. Rows
   stay pending and are written tomorrow with their own day numbers; levels
   and streaks come out identical whenever the write lands.
2. Read all pending rows with `day <= yesterday` (a check-in at 00:03 belongs
   to the next batch).
3. Send in order: `mint` calls, `batchCheckIn` in chunks of 1,500 entries
   (each entry 4-byte id + day), `applyMark` calls. `viem`; wait for each
   receipt; mark rows `written` only on `receipt.status === "success"`.
4. Reconcile the mirror against the emitted events, then call OpenSea's
   metadata refresh API for every token written or paled that day (the
   ERC-4906 events have no latency guarantee; community reports run from
   seconds to days).
5. A row still pending after three runs triggers an alert email (Resend via
   the existing `send-email` skill) with the tx hash and revert reason.
6. Log to `~/projects/machine-readable-only/clock.log`.

### Daily post (cron `00:30 UTC`)

Fixed template, no LLM: tokens alive, check-ins credited yesterday, highest
level, longest current streak, Marks bought, hearts completed, rings; plus the
top-streak token's image rendered from the on-chain SVG to PNG
(`@resvg/resvg-js`, verified at plan time) and attached via
`POST /2/media/upload` then `POST /2/tweets` with `media.media_ids`. No link in
the post ($0.015 vs $0.200 with a URL); the OpenSea link lives in the bio. One
extra post per Whole Heart and per Singularity. Replies and cross-account
quotes are blocked by X and never attempted. `X_DRY_RUN=1` writes the post to
the log instead of sending; it ships in dry-run until the operator flips it.

### Durability commitments (the record says dead infrastructure is the norm)

Five of the six agent-only mints from early 2026 have dead mint sites within
six months while their tokens still trade and their skill files point at dead
URLs. MRO commits to: the signature verifier is stateless and open-source;
the Warden key rotation policy is published (`setWarden`); `/skill.md`,
`/llms.txt` and `/t/<id>` are stable URLs for the life of the piece; the
voucher check-in path exists on-chain from day one so tokens can be kept alive
without the Warden; terms bind to the paying wallet and the signing key and
state that tokens are agent-generated. Sunset is the only planned ending.

### Keys and secrets

| Secret | Where | Can do |
|---|---|---|
| `WARDEN_PRIVATE_KEY` | VPS `.env` (chmod 600, WinSCP-edited, never in the PM2 dump) | mint, check-in, apply marks; holds only gas ETH |
| `TREASURY_ADDRESS` | VPS `.env` (address only) | receives USDC; no key on the VPS |
| `CHALLENGE_SECRET` | VPS `.env` | HMAC for stateless challenges |
| Contract owner key | PC / hardware wallet | dials, pause, Renderer swap, ownership handover |
| `SEED_AGENT_JWK`, `SEED_PAY_KEY` | VPS `.env` | the seed agent's signing key and a key holding a few USDC |
| `CDP_API_KEY`, `X_API_*`, `ALCHEMY_KEY` | VPS `.env` | facilitator, daily post, RPC |

If the Warden key leaks, an attacker can mint (only with a paid settlement)
and check in, but cannot move tokens or funds; rotate with `setWarden`.

### Hosting (aligned to the existing stack)

- Node 24 via nvm; PM2 fork; `ecosystem.config.cjs` pointing at the real
  binary; `-H 127.0.0.1`, port **3006** (next free after 3005; register in
  `port-allocation.md`). Builds via `~/scripts/safe-build.sh`.
- nginx site config + certbot, Cloudflare proxy ON, Full (Strict), the
  origin-lock guard, UFW deny on 3006.
- **Cloudflare bot settings for this domain (operator-manual):** Bot Fight Mode
  **OFF** (it runs outside the ruleset engine, ignores Allow rules, and "may
  challenge API traffic"; only agents registered in Cloudflare's Verified Bots
  program are exempt, which is almost none of MRO's visitors); AI bot "Agent"
  policy **Allow**; legacy "Block AI bots" off. Cloudflare's signed-agent test
  endpoint `https://crawltest.com/cdn-cgi/web-bot-auth` is the first thing to
  point a visitor at when their signing fails.
- `node:sqlite` (built into Node 24; release-candidate status, adequate here).
- Foundry: the `curl | bash` installer is denied on this machine; install from
  the standalone binary release.

---

## 13. Testing and rollout

### Contracts (Foundry)

Every function, every revert, every owner/warden/emergency path: one mint per
key; explicit-id mint and `TokenExists`; supply cap; `day > lastDay`; streak
continuation vs reset; out-of-order and multi-day late writes; 365 display
cap and rings; marks bitmask, gates, supply, `MarkSoldOut`; `rebind` by
non-owner reverts and binding a key to several tokens succeeds; pause blocks
mint/check-in/marks but not transfer or rebind; `setWarden`, `setRenderer`,
`setSupplyCap`, `setUpgrade`; `Ownable2Step` handover; `rest` by non-owner
reverts, resting blocks check-in/marks/seed but not transfer or rebind;
`seed` gates (not whole, no seed available, resting parent, cap) and the
one-per-year arithmetic across several years; `sunset` freezes everything
and cannot be undone; effective-streak paling for lapsed tokens and colour
lock for resting ones (time-warped with `vm.warp`). A `tokenURI` golden
test decodes the base64 twice and asserts cell count, colour, rings and mark
elements for given state. `forge build --sizes` positive margin for both
contracts; strict-limit anvil deploy with non-empty `cast code`.

### Warden and client (`node:test`)

Signature verification against the RFC 9421 Ed25519 test vectors from
Cloudflare's `web-bot-auth` repository, VENDORED into `warden/test/vectors/`
because the npm tarball ships only `dist/` and `README.md`; required-components rejection; stateless challenge validity,
expiry and single use; key registration and directory regeneration; SSRF guard
against private ranges; each tool's success and every `reason`; the live
rebind re-check; unique-index behaviour under 100 concurrent `checkin` calls;
QR round-trip through ZXing, with `jsqr` asserted to agree; `mint` and `upgrade` with a mocked facilitator,
including sold-out reservation; MCP 2026-07-28 header handling; gas guard
deferral producing identical level and streak.

### The joins

One end-to-end script against a local anvil: `mro-agent join` with a mocked
facilitator, `beat` on two simulated days, a missed Clock day then a double
write, `mark vein`, a transfer plus `rebind` by a second key, the Clock runs,
and the script reads `tokenURI` back and decodes the QR from the actual
on-chain SVG. The same script is the Sepolia smoke test.

### Rollout

0. **Phase 0 rendering spike** (section 8): Renderer set on Base Sepolia
   behind a stub ERC-721, gas/size/decode/OpenSea-refresh/animation criteria
   all passed. Nothing else is built until this passes or a fallback is
   approved.
1. Local anvil, join test green.
2. Base Sepolia (`eip155:84532`; CDP faucet 0.1 ETH/24h): both contracts,
   Warden, seed agent, testnet facilitator with test USDC. Soak **7 days**:
   seed agent checking in daily, one paid mint from a second key, one Mark.
3. Base mainnet deploy (the operator approval; irreversible). Seed agent mints token #1.
4. Distribution, in the order the evidence ranks it: publish `mro-agent` and
   its `SKILL.md` (npm, `/skill.md`, ClawHub, openclaw/skills); early access
   for wallets holding Claws, Shellborn, Base Buds or BLOKS (the only wallets
   known to run mint skills); the X account out of dry-run plus the human
   launch post; the Moltbook post by the seed agent; then the on-chain
   registrations in the checklist below, all of which are for legitimacy and
   discovery rather than traffic. Base case without a secured channel is
   single-digit mints; the launch is timed to a news moment, not shipped
   quietly.

### Mainnet registration checklist (added 2026-08-30)

Four items, each verified live on 2026-08-30. **Every one spends real funds or
touches an outward-facing account, so each is an explicit operator-approval gate --
there is no standing approval.** They are listed here so none is retrofitted.

| # | Item | When | Why, and what was verified |
|---|---|---|---|
| 1 | **Builder Code (ERC-8021)** | **BEFORE the first mainnet write** | Registered at `base.dev` under Settings -> Builder Code (a browser login, so the operator does this by hand). The code is appended as a **calldata suffix** -- `TX_DATA + [CODES_LENGTH][CODES] + [SCHEMA_ID] + [ERC_MARKER]`, parsed backwards -- which contracts ignore and off-chain indexers extract, at 16 gas per non-zero byte. Base calls Builder Codes "a key input for future rewards programs", and there is a schema specifically for attributing x402 payments. MRO is an unusually good fit: minting, the nightly `batchCheckIn` and Mark purchases are all recurring machine-originated Base transactions. **This must be done first**, because the suffix belongs in the calldata the Warden composes rather than being bolted on afterwards. Implementation is a library call, not hand-rolled bytes: `ox` ships `ox/erc8021` with `Attribution.toDataSuffix` / `fromData` / `getSchemaId`, and `ox` is already present in `tools/` (0.14.34, checked 2026-08-30) as a viem dependency |
| 2 | **ERC-8257 tool-registry entry** | at mainnet | `registerTool(string metadataURI, bytes32 manifestHash, address accessPredicate)` on `ToolRegistry` `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`. Confirmed live: `toolCount()` returned **570** on Base mainnet, 2026-08-30. Discovery is four steps -- fetch the on-chain metadata URI, confirm origin-binding at `/.well-known/ai-tool/<slug>.json`, verify the manifest bytes hash to the on-chain commitment (JCS canonicalisation then keccak256), and confirm the declared creator matches the registrant. **The `accessPredicate` field is the interesting part for MRO**: it is a contract that decides who may use the tool, and the ERC's own example of a predicate is an NFT holding. Pointing it at the MRO token would make "only agents, and only ones that have shown up" legible on-chain rather than only in the door sign. Draft status, but deployed and in use on Ethereum mainnet and Base |
| 3 | **ERC-8004 identity for the seed agent** | at mainnet | One transaction, gas only. Confirmed live on Base mainnet 2026-08-30: IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` returns `name() = "AgentIdentity"`, `symbol() = "AGENT"`; ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` has code. **The ValidationRegistry is deployed nowhere** -- that part of the spec is still under discussion with the TEE community, so nothing may depend on it. Keep ERC-8004 as a legitimacy flag, never as a channel, and keep the reputation layer at arm's length: peer-reviewed work found 59-91% of reviewers showing coordinated Sybil behaviour across the three chains studied |
| 4 | **x402 Bazaar -- best-effort, and verified rather than assumed** | at mainnet | Keep x402 for **payment**, which works and is the right choice. Do not count on the Bazaar for **discovery**. Cataloguing happens only when a facilitator processes a `PaymentPayload` carrying the echoed bazaar extension -- a server-side `declareDiscoveryExtension` catalogues nothing on its own -- and there is no `.well-known/x402` submission form. Issue `x402-foundation/x402#2112` was closed "completed" on 2026-07-16 but drew **five independent reproductions across three chain stacks and four runtimes**, the most recent on 2026-08-28: settlements succeed, the documented `EXTENSION-RESPONSES` header is never emitted, and records either never appear or appear un-enriched. **Two things to get right if we do it:** `serviceName`, `tags` and `iconUrl` are fields of `RouteConfig`, **not** of `extensions.bazaar` -- put them in the wrong object and they survive into the 402 header and are echoed back by `/x402/validate`, which looks like confirmation and is not (a contributor nearly filed a false bug report on that echo, 2026-08-29; moving them fixed cataloguing within seconds of the next settlement). And **`echo is not validation`**: verify by querying `/platform/v2/x402/discovery` for our own routes, never by reading back our own declaration. Sober sizing: despite headline figures of ~165M transactions and ~$600M annualised, on-chain analysis puts real daily x402 volume near **$28,000**, much of it testing |

**Watch item, not scheduled:** ERC-7715 / ERC-7710 delegation (MetaMask Agent
Wallet's Early Access Program opened 2026-06-08). MRO's daily check-in is the
closest thing in the portfolio to an agent acting repeatedly without a human,
so this becomes relevant eventually -- but not before Plan 1 ships. EIP-7702
carries a live caution worth remembering if delegation is ever adopted: a
peer-reviewed study associated attacker-linked contracts with 63% of 3.66M
authorisations across seven chains through mid-July 2025, which is an argument
for vetting delegation targets, not for avoiding the standard.

---

## 14. Costs (verified live 2026-08-27, revised for revision 2)

Base gas was at its protocol floor (0.005-0.006 gwei) and ETH at $2,494 when
checked; 1M gas cost $0.015. With one packed slot, one event per batch and a
static QR, a check-in is **~7k gas** (5,000 slot overwrite + share of batch
overhead + 8 bytes calldata). Only *active* tokens cost anything.

| Active tokens | Check-in gas per month | Mint income at 0.10 USDC (one-off) |
|---|---|---|
| 100 | $0.32 | $10 |
| 1,000 | $3.20 | $100 |
| 10,000 | $32 | $1,000 |
| 100,000 | $320 | $10,000 |

One mint fee covers roughly 2.5 years of that token's check-ins at today's gas.
A 10x gas spike multiplies the gas column, and the gas guard means the site
only pays it if the spike outlasts the deferral.

| Component | One-off | Monthly at 1,000 active tokens | Free tier |
|---|---|---|---|
| Contract deploys (~4.5M gas, two contracts) | $0.07 | -- | n/a |
| Mints (~120k gas each; static QR) | $0.002 each, covered by the fee | -- | n/a |
| Daily `batchCheckIn` | -- | $3.20 | n/a |
| `applyMark` (~50k gas) | -- | $0.00075 each | n/a |
| x402 (CDP facilitator) | $0 | $0 up to 1,000 settlements, then $0.001 (1% of the mint fee) | Yes |
| Alchemy RPC | $0 | $0 | Yes: 30M CU/month, 300 CU/s |
| X API pay-per-use, 31 image posts | $0 | ~$0.62 | Prepaid credits |
| ERC-8004 registration | < $0.01 | -- | gas only |
| ERC-8257 tool registration | < $0.01 | -- | gas only; one `registerTool` write |
| Builder Code (ERC-8021) suffix | $0 to register | 16 gas per non-zero byte, per transaction | Registration is free at base.dev |
| MCP registry, npm publish | $0 | $0 | Yes |
| Cloudflare Free | $0 | $0 (domain renewal not costed) | Yes |
| OpenSea | $0 | 1% of secondary sales (seller pays) | Yes |
| **Total** | **~$0.10** | **~$4 at today's gas; ~$36 at 10x** | |

---

## 15. Chain decision: Base, permanently

Evaluated live on 2026-08-27 against Ethereum mainnet, Solana, Monad, Kite
Chain, Tempo, BNB Chain and MegaETH.

**Base is the only chain where every layer this piece depends on is live,
first-party, and already in the operator's hands:** the CDP x402 facilitator (Base
carries ~58% of all x402 settlements), Coinbase Agentic Wallets (Base is the
default and the only chain with gasless USDC), MetaMask Agent Wallet, the
canonical ERC-8004 registry, OpenSea with documented on-chain SVG support,
three live agent-native NFT precedents (BOB, agentsea, mint.day), and the
existing Foundry + Alchemy setup from base-200 and luckdrop.

Runner-up **Monad**: same tooling, ~20x cheaper per write; loses on the things
that make agents show up (no Coinbase wallet, not on the CDP facilitator, ~100
registered agents, near-zero NFT market after Magic Eden's EVM exit).
**Solana** has the strongest agent-NFT culture (Shellborn) but needs a Rust
rewrite, has no OpenSea NFT support, no MetaMask Agent Wallet, and unverified
on-chain SVG rendering. **Ethereum mainnet** is cheap today but not
predictable, and the payment and wallet products skip it.

**Moving later is not realistic.** NFT bridges lock the original and mint a
wrapper elsewhere; the daily check-in history, which is this token's entire
value, stays behind. A redeploy is a new collection with an empty history.

---

## 16. Out of scope (version one)

- Auctions or bidding for Marks (fixed price and fixed supply only).
- Agent-to-agent co-signing or any multi-agent mechanic.
- Any human-facing gallery, dashboard or admin panel (OpenSea and Basescan
  are the gallery; the owner acts via Foundry `cast` from the PC).
- AP2 mandates.
- ERC-8004 registration of visitors (only the seed agent registers).
- A mobile app.
- Decay of any kind.
- `/llms-full.txt` (not part of the llms.txt spec).

---

## 17. Standards and sources checked (2026-08-27, re-verified 2026-08-30)

### Re-verified 2026-08-30 (the agent-readiness pass)

Prompted by the hub's cross-project sweep note. Every claim below was checked
against a primary source or read directly off Base mainnet on the day, not
taken from the note.

- **Read off Base mainnet with `cast`:** ERC-8257 `ToolRegistry`
  `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1` -> `toolCount() = 570`;
  ERC-8004 IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` ->
  `name() = "AgentIdentity"`, `symbol() = "AGENT"`; ReputationRegistry
  `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` -> code present.
- **ERC-8257 Agent Tool Registry** (Draft, Standards Track), including the
  `accessPredicate` semantics: https://eips.ethereum.org/EIPS/eip-8257
- **Web Bot Auth adoption.** Cloudflare's signed-agents post (2025-08-28) names
  ChatGPT agent, Goose, Browserbase, Anchor Browser and Cloudflare Browser
  Rendering, and does not name Anthropic:
  https://blog.cloudflare.com/signed-agents/ . Cloudflare's Web Bot Auth
  documentation names no signing operator beyond a `Forwarded: for="openai"`
  example. Cloudflare Radar's bot directory returns HTTP 403 to automated
  fetches and could not settle the question. The Claude Managed Agents
  announcement (2026-05-19) is unrelated to request signing:
  https://blog.cloudflare.com/claude-managed-agents/
- **MCP 2026-07-28 changelog**, for the deprecation list in section 6:
  https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **x402 Bazaar discovery mechanism**: https://docs.x402.org/extensions/bazaar
  and the reproduction thread `x402-foundation/x402#2112` (closed "completed"
  2026-07-16; five independent reproductions, latest comment 2026-08-29).
- **ERC-8021 Builder Codes**: https://blog.base.dev/builder-codes-and-erc-8021-fixing-onchain-attribution

### Checked 2026-08-27

- Web Bot Auth: `draft-meunier-webbotauth-httpsig-protocol-02` (2026-08-18);
  IETF `webbotauth` WG chartered 2025-10-23, no adopted documents yet.
  https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
  https://www.npmjs.com/package/web-bot-auth (0.1.3)
- MCP 2026-07-28 (final): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
  TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/
  Registry: https://modelcontextprotocol.io/registry/remote-servers
- x402: https://github.com/x402-foundation/x402 ; `@x402/mcp` and
  `@x402/express` 2.23.0; https://docs.cdp.coinbase.com/x402/seller/facilitator ;
  https://docs.cdp.coinbase.com/x402/network-support
- Agent wallets: https://docs.cdp.coinbase.com/agentic-wallet/welcome ;
  https://docs.metamask.io/agent-wallet/
- ERC-8004 (Draft): https://eips.ethereum.org/EIPS/eip-8004 ;
  https://github.com/erc-8004/erc-8004-contracts
- Base: https://docs.base.org/base-chain/network-information/network-fees ;
  https://docs.base.org/base-chain/network-information/throughput-and-limits ;
  https://basescan.org/gastracker
- OpenSea: https://docs.opensea.io/docs/media-and-traits ;
  https://support.opensea.io/en/articles/8867091-what-fees-do-i-pay-on-opensea
- Alchemy: https://www.alchemy.com/pricing ;
  https://www.alchemy.com/docs/reference/compute-unit-costs
- X API: https://docs.x.com/x-api/getting-started/pricing ;
  https://docs.x.com/changelog
- Cloudflare bots: https://developers.cloudflare.com/bots/get-started/bot-fight-mode/ ;
  https://developers.cloudflare.com/bots/concepts/bot/verified-bots/
- llms.txt v2 (2026-08-10): https://llmstxt.org/
- OpenZeppelin 5.7.0: https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.7.0
- Node `node:sqlite`: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Prior art: Moltbook (Wikipedia), https://github.com/jordanlyall/mintday ,
  https://magiceden.io/marketplace/shellborn_ , https://www.agentsea.io/

Things the verification pass could not confirm and the build plan must
re-check: whether Base enforces the EIP-7825 per-transaction gas cap (the
Clock assumes it does); X's charge for media upload itself (assumed
$0-0.005); MetaMask Agent Wallet pricing at GA; wallet-app rendering of SMIL
animation (irrelevant to `image`, which is static); `@resvg/resvg-js` as the
rasteriser; the exact gas of the packed-slot check-in (measured in the
Foundry gas report before the cost table is trusted).
