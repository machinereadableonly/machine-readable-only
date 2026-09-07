# The raw protocol

You do not need our client. Everything it does is plain HTTP plus one contract
call, and this document is the whole of it, request by request.

The client (`npx mro-agent`) exists because writing an RFC 9421 signer and an
EIP-3009 payment authorisation from scratch is a morning's work, not because
anything here is secret. If you would rather use `curl` and `cast`, this page
is enough. If you would rather read the client and then use it, that is what
it is for.

Every request and response below was captured off the wire by
`warden/tools/protocol-transcript.mjs`. Run it and compare. The contract reads
were made with `cast` against the live deployment on the date in this file's
name. Nothing here is written from memory, and you should not have to take it
on trust.

## This is a testnet preview

Stated first, because a document that quietly describes a future is worse than
no document.

The service is reachable at `https://machinereadableonly.com`, and `<domain>`
below stands for it. What runs there is a rehearsal: the contract is on Base
Sepolia, chain id 84532 -- a real deployment you can read today, and not the
mainnet piece. The finished piece will live on Base mainnet, chain id 8453,
and is not deployed there.

**The treasury address is a placeholder** (`0x...dEaD`). Do not pay it.

Read the rest of this document as the protocol rather than as a report on what
has been exercised. Every tool answers with the chain id it is actually running
on; believe that over this page.

## The shape of it

    GET  /.well-known/http-message-signatures-directory   who we accept keys from
    GET  /keys/nonce                                      a nonce to prove a key with
    POST /keys                                            register a key (no domain needed)
    POST /mcp                                             everything else, signed
    GET  /t/{id}                                          one token, public, unsigned

Two things gate `/mcp`: an RFC 9421 signature, and a five second challenge. You
need both on every request. There is no session and no login.

`GET /t/{id}` is the url written into every token's artwork at mint, and it is
the one route that is never gated: a scan has to lead somewhere. It answers
with the token's live state plus `docs`, `mcp`, `contract` and `chainId`, so
whatever follows the QR can reach the rest of the piece and check the token
against the chain rather than against us. It is the same object the `status`
tool returns, from the same function, so a scanner and an agent can never be
told two different stories about one token.

---

## 1. Knock, and be refused

Any request to `/mcp` without a signature earns a 401 that tells you how to
come back. This is the intended first request; there is nothing rude about it.

    POST /mcp HTTP/1.1
    Host: <domain>

    HTTP/1.1 401 Unauthorized
    Content-Type: application/json

    {
      "about": "An artwork that only admits programs. This challenge is its entry condition; answer it inside five seconds, or read docs first.",
      "challenge": "eBiJifjWTB1Z3BjsSun4tSzxHNJXcmzV8XNf9wJKxaI.1788291258535.124d1a2f8c7d0675cc030ce5fdec94174c38d1fd19aab30b72107b0c04fb9953",
      "expires": "2026-09-01T19:34:23.535Z",
      "mcp": "https://<domain>/mcp",
      "docs": "https://<domain>/llms.txt"
    }

The challenge is `nonce.unix-ms.hmac`. **Issuing is stateless**: we keep no
record of what we handed out, and recognise a challenge later by recomputing
the HMAC over its own nonce and timestamp. Nothing is keyed to your IP address,
so agents sharing one cloud NAT never collide.

**Spending is not stateless**, and it cannot be. Burn-after-use needs somewhere
to remember the burn, so there is a replay cache: an in-memory set of
challenges already answered, swept every 10 seconds, holding nothing older than
twice the five second window. It is bounded by that window rather than by
traffic -- roughly ten seconds' worth of challenges at any moment, never a
growing list.

**Your signature is spent too, and that is the part that matters.** The door
records every signature it admits -- the SHA-256 of the `Signature` header --
and refuses a second presentation of the same one with `reason: "replay"`. Each
entry is remembered until that signature's own `expires`, then swept.

Why it has to work this way: the challenge is not a second factor. Your key id
travels in plaintext in `Signature-Input`, a fresh challenge is free and
unauthenticated, and the answer is a pure function of the two. So anyone holding
one captured request could pair it with a challenge of their own and be admitted
again. Sign each request once and send it once; if you need to retry, re-sign.

If you are hand-rolling the signer, carry the RFC 9421 `nonce` in
`@signature-params`. Ed25519 is deterministic, so without one, signing the same
request twice inside the same second produces byte-identical signatures and the
second is refused as a replay. Every conforming library generates one for you.

A restart forgets both sets. That costs at most one extra use of a signature
already in flight, and nothing else.

A 401 may also carry a `reason` field. It is a diagnostic, not a rebuke:

| reason | what it means |
|---|---|
| absent | you sent no signature at all |
| `signature` | the signature did not verify |
| `components` | it verified, but did not cover the required components |
| `expired` | the signature window exceeds five minutes, or the challenge is stale |
| `unknown-key` | we fetched a directory and your key id was not in it |
| `directory` | your directory could not be FETCHED. Try again; nothing is wrong with your key |
| `challenge` | missing, wrong, or already spent |
| `digest` | the `content-digest` you signed is not the digest of the bytes you sent |
| `replay` | that exact signature has been admitted once already |

Those first two are worth telling apart, because until 2026-09-06 they were
not: a directory we could not reach was reported as `unknown-key`, which sends
you to re-derive the thumbprint -- the one trap named below -- for a key that
was never wrong. `unknown-key` now means we read a directory and your key was
absent from it. `directory` means we never got to read one. If you sign for an
authority that hosts no directory, `directory` is what you will get.

A signed request can also be refused **429 `rate-limited`**, which is a budget
and not a rejection: 60 tool calls a minute, counted against your verified key
id. Wait and call again; it refills continuously. Nothing an honest agent does
comes close to it -- a token is checked in once a UTC day.

## 2. Have a key we can find

The key is an **Ed25519** keypair. Your key id is the **RFC 7638 JWK
thumbprint** of the public key, base64url.

**The one trap in this document, and it produces a wrong key id silently.**
RFC 7638 hashes a canonical JSON form: the required members only, in
LEXICOGRAPHIC order, with no whitespace. For Ed25519 that is exactly

    {"crv":"Ed25519","kty":"OKP","x":"<base64url>"}

hashed with SHA-256 and encoded base64url without padding. Every JWK printed in
this document is shown in the order `crv, x, kty`, which is how the wire
serialises it and is NOT the order you hash. Hash the JSON as it appears below
and you will compute a thumbprint that nothing recognises, and the failure
looks like a rejected signature rather than a bad key id. Use your JOSE
library's thumbprint function rather than serialising by hand.

You never send the key id as an
argument anywhere; it is derived from the signature we verified, which is why
one agent cannot act as another.

There are two ways for us to find your public key, and they are equal.

### 2a. You have a domain

Host a JWKS at
`https://your.domain/.well-known/http-message-signatures-directory` and send
`Signature-Agent: "https://your.domain"`. We fetch it once and cache it for an
hour. Nothing is registered and we store nothing.

The fetch is guarded, and the guard will refuse some legitimate-looking setups:
HTTPS only, port 443 only, no credentials in the URL, no redirects followed,
64 KB cap, 3 second timeout, and the resolved address must be publicly
routable. Every DNS answer is checked, not just the first.

### 2b. You do not have a domain

Register the key with us. Two requests.

    GET /keys/nonce HTTP/1.1

    HTTP/1.1 200 OK
    {
      "nonce": "yUnw7tGuNebv1c9PL0tbinXWVX-KE_swNvNFIm4jy7o.1788291258573.ca6332cae422e3b4b449b3e554e0d2311b094e08bd116e8c72bc9320dbe16fea",
      "expires": "2026-09-01T19:34:23.573Z"
    }

Sign the nonce's **ASCII bytes** with your private key, Ed25519, raw, and
encode the signature base64url. Then:

    POST /keys HTTP/1.1
    Content-Type: application/json

    {
      "jwk": { "crv": "Ed25519", "x": "mlZJUoSOnQSPIAFaLmsXlVgvy3WdBuw69atNn6dRZDg", "kty": "OKP" },
      "nonce": "yUnw7tGuNebv1c9PL0tbinXWVX-KE_swNvNFIm4jy7o.1788291258573.ca6332...",
      "proof": "sTmpgQ8-7eJCWqrTqY7GjqNO-9OSsePhWOtcaAqgXoMqRy5ZaGxJ0ONuQaB_NLUMvugXpAkW-8V3B7l9wO1KBQ"
    }

    HTTP/1.1 201 Created
    { "ok": true, "keyId": "gkKHv4HPNo5hOT9kFD8Ig5ZVhPQdT-2A42ULHj00TBA" }

The nonce is spent on use (same replay cache as section 1) and lives five
seconds. The proof is what stops anyone registering a public key lifted from
somebody else's published directory.

Refusals are `proof`, `nonce`, `invalid-jwk` (all 400) and `rate-limited`
(429). The rate limit is keyed on your key's thumbprint, not on your address,
and it is only reached after the proof has verified, so a malformed request
costs you nothing.

**That ordering is a deliberate trade, and it cuts both ways.** It was the
other way round once: the budget was spent before any field was checked, so 21
junk bodies exhausted the minute's allowance and closed the only entrance an
agent without a domain has. Charging only verified requests fixes that, and the
cost is that unverified `POST /keys` traffic is unmetered here, paying one
Ed25519 verify each. Rate limiting is nginx's job, not this handler's:
`POST /keys` and `GET /keys/nonce` are held to 10 a minute with a burst of 5,
answering `429`.

**A registered key you never use is forgotten after 30 days.** Registering is
free and proves only that you hold the key, so a key that registers and never
signs a request is indistinguishable from one made to fill the table -- and the
table has a ceiling. Anything you actually do with the key resets nothing and
needs nothing: the first admitted request marks it in use, and from then on it
is kept for good, whatever the gap between visits. This matters to exactly one
audience: an agent that registers ahead of time and comes back weeks later
without having used the key in between. If that is you, register when you are
ready to arrive, or simply register again -- it is two requests and costs
nothing. A key bound to a token is never forgotten.

Registered keys are then served in our own directory, which anyone can read:

    GET /.well-known/http-message-signatures-directory HTTP/1.1

    HTTP/1.1 200 OK
    Content-Type: application/http-message-signatures-directory+json

    { "keys": [ { "crv": "Ed25519", "x": "mlZJUoSOnQSPIAFaLmsXlVgvy3WdBuw69atNn6dRZDg", "kty": "OKP" } ] }

Registering here means sending `Signature-Agent: "https://<domain>"` -- ours,
because we are the ones holding your key.

## 3. Sign the request

RFC 9421 HTTP Message Signatures, Web Bot Auth profile. Six headers go on
every `/mcp` request. Here is a real set, captured off the wire:

    signature-agent: "https://<domain>"
    host: <domain>
    content-digest: sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:
    Signature: sig1=:dlaEbjSJiVOJknv5jiJaTKvqbIyfBkJoQzkrcwUVUnm2ozDmcoUZzRFfDHOrHku+XZzSYyJnQPRWC6NNSM9+Aw==:
    Signature-Input: sig1=("@authority" "@method" "@path" "signature-agent" "content-digest");created=1788678057;keyid="xAsbMpK3qC5ubiVo608ggUTzGxHFkV8b2usPk822Kyo";alg="ed25519";expires=1788678117;nonce="EFNAsLdJQIEDXJeLhrdvNUcYzEboGuqnw4owgOTuvw4puMzpHwnT/ObeqJO9x7HLbCM1sUHOdtsDJafMQzw7xg==";tag="web-bot-auth"
    challenge: Py2tTQdqkPZR45S7kHJ1jQLxehSErNpCZfWZslvhXhg.1788678057537.5f273353bb89e3742e619b85513e4e0f4571e221a2c01461c9bcd26a8d02810b
    challenge-response: 2919608e1a5b74ad009f824a77a8adf85bf62a978d7304de9ab884bf9bd68ff1

That digest is of the EMPTY string, because this capture signs a GET-shaped
knock with no body. Yours is of the exact bytes you send.

Four rules, all enforced, all refused with `components` or `expired` if broken:

- **The signature must cover at least these components:** `@authority`,
  `@method`, `@path`, `signature-agent`, `content-digest`. The standard
  mandates only `@authority`; the other four are this service's own rule.

  At least, not exactly: the door checks that each of the five is covered, so
  a signature covering more is admitted. That is not a hole -- the library
  builds the signature base from the request itself rather than from anything
  you send, so extra components only ever bind MORE of your request -- and the
  rule is written this way because "exactly" would have you build a client
  more brittle than it needs to be.

  **`content-digest` is what binds the signature to the BODY, and it is not
  optional.** Send RFC 9530's `sha-256=:<base64 of SHA-256 of the exact bytes
  you send>:` and cover it in the signature. Serialise your JSON ONCE and sign
  the same string you send -- re-serialising an equivalent object produces a
  digest for bytes nobody sent, and the door refuses it with reason `digest`.

  Why it is required, since the reasoning is not obvious: every call goes to
  `POST /mcp`, so `@method` and `@path` are identical across all nine tools
  and separate none of them. Until 2026-09-02 the body was unsigned, and a
  captured `Signature` pair authenticated ANY tool call until it expired -- the
  challenge is no second factor, because key ids are public, challenges are
  free and unauthenticated, and the answer is a pure function of the two. One
  key may mint only once ever, so a replay could spend your only mint. That is
  fixed; this paragraph stays because the fix is the reason the requirement
  looks fussy, and because an earlier version of this page claimed method and
  path already prevented it.
- **`tag="web-bot-auth"`.**
- **`alg="ed25519"`**, and `keyid` is your thumbprint.
- **`expires - created` must be five minutes or less.** The standard sets no
  maximum, so a signature could otherwise be minted valid for a year.

`@authority` is checked against our configured domain, never against the `Host`
header you send.

## 4. Answer the challenge

    challenge-response = hex( SHA-256( challenge_string + key_id ) )

Concatenated as ASCII, no separator, no salt. The challenge you answer must be
one we issued, unspent, and **under five seconds old**, which is the whole
point: the answer has to be computed between our 401 and your retry.

Get a fresh challenge either from any 401, or from the `challenge` tool once
you are already inside. Each one answers exactly once.

Deterministic, so no model is in the loop. This is an entry condition for an
art piece -- it establishes that a program composed the request. It is not
meant to prove anything else, and it is not a defence against anything.

## 5. Talk MCP

`POST /mcp` with the headers above and a JSON-RPC body. Model Context Protocol,
revision 2026-07-28: no `initialize` handshake, no sessions, a fresh server per
request. Send `Accept: application/json, text/event-stream`; a single request
is answered with `application/json`, and a reply may also arrive as an SSE
`data:` line, so handle both.

**This server is modern-only.** Because there is no handshake, every request
carries its own protocol version and capabilities, in TWO places that must
agree: `_meta` in the body, and headers mirroring it. A request without them is
refused rather than served by a 2025-era compatibility path.

- `MCP-Protocol-Version: 2026-07-28` on every request, matching
  `io.modelcontextprotocol/protocolVersion` in `params._meta`.
- `Mcp-Method`, on every request, equal to the body's `method`.
- `Mcp-Name`, on `tools/call`, `resources/read` and `prompts/get` only, equal
  to `params.name` or `params.uri`. If that value is not plain printable ASCII,
  encode it `=?base64?<base64 of the UTF-8 bytes>?=`.

A header that disagrees with the body is a `400` with JSON-RPC error `-32020`
(`HeaderMismatch`), and so is a missing one. The headers are NOT among the
signed components and do not need to be: they mirror the body, and the body is
bound to your signature by `content-digest`.

    POST /mcp HTTP/1.1
    Content-Type: application/json
    Accept: application/json, text/event-stream
    MCP-Protocol-Version: 2026-07-28
    Mcp-Method: tools/list

    {
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/list",
      "params": {
        "_meta": {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    }

`server/discover` is implemented and takes the same envelope; it answers with
the versions and capabilities this server supports. List and read results carry
`ttlMs` and `cacheScope`, so you can cache them rather than poll.

A `tools/call` adds the name in both places:

    Mcp-Method: tools/call
    Mcp-Name: status

    { "jsonrpc": "2.0", "id": 1, "method": "tools/call",
      "params": { "name": "status", "arguments": { "tokenId": 1 },
                  "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                             "io.modelcontextprotocol/clientCapabilities": {} } } }

A payment authorisation travels in that same `_meta`, alongside these keys
rather than instead of them.

Nine tools. None of them takes your key id -- it comes from the signature.

| tool | arguments | costs |
|---|---|---|
| `challenge` | none | free |
| `status` | `tokenId?` | free |
| `ladder` | `tokenId` | free |
| `checkin` | `tokenId` | free |
| `mint` | `to` (0x address) | 1 USDC |
| `upgrade` | `tokenId`, `upgradeId` (1-10), `variant?` (0-2, default 0) | the Mark's price |
| `seed` | `parentId`, `to` | free |
| `rebind` | `tokenId` | free, returns a call to sign |
| `rest` | `tokenId` | free, returns a call to sign |

**Four things a client author asks that this document did not previously
answer.** All four were raised by fresh readers of this page on 2026-09-02.

- **`status` with no tokens returns `{ ok: true, tokens: [] }`**, an empty
  array. It is not an error and not `unknown-token`.
- **A check-in is not credited the moment you call it.** `checkin` records your
  intent; the site writes the day on chain in one batch at 00:05 UTC. Reading
  `viewOf` straight afterwards will show the OLD level, and that is correct
  rather than a failure. Do not retry on it.
- **A 401 is always a valid way to get a challenge, and is the only way to
  bootstrap.** The `challenge` tool needs you to already be inside, so it saves
  a round trip and can never start you off. A client that treats the 401 loop
  as a fallback has it backwards.
- **The registered-key directory is PUBLIC and enumerable.** Keys registered
  through `POST /keys` are served from this site's own directory, so your
  public key sits there beside everyone else's. Nothing is compromised by that
  -- a public key is public -- but it is a correlation surface, and hosting your
  own directory instead avoids it.

`status` with no argument returns the token you minted plus every token bound
to your key. It reads from the verified key id, so it cannot enumerate anyone
else's holdings.

`rebind` and `rest` do not act. They return the call the token **owner's**
wallet must sign, and we never submit it:

    { "ok": true, "contract": "0x...", "function": "rest", "args": [1], "irreversible": true }

#### What a check-in answers with

    checkin { "tokenId": 1 }
    -> { "ok": true, "accepted": true, "creditedDay": 20699,
         "level": 7, "streak": 7, "heart": "7/365",
         "nextWindowOpensAt": "...T00:00:00.000Z",
         "onChainBy":         "...T00:05:00.000Z",
         "streakDeadline":    "...T00:00:00.000Z",
         "nextRung": { "at": 30, "daysAway": 23 },
         "note": "Day 7 credited; it is written on chain at 00:05 UTC. Your
                  run is 7. Check in again before <streakDeadline> to keep it." }

`onChainBy` is when the day is written on chain; `streakDeadline` is the end of
tomorrow, which is the last moment a check-in still continues this run.
`nextRung` is the next run at which the colour changes (3, 7, 30, 100), or
`null` past the last one.

**When a run has just ended, the reply says so**, rather than reporting
`streak: 1` and leaving you to notice:

    "runBroke": { "was": 99, "lastCreditedDay": 20694 }

and the note gains "Your run of 99 ended: the 99 days are kept, the colour
restarts." The days are never lost; only the colour restarts.

A second check-in on the same day is refused with `already-credited-today`,
`nextWindowOpensAt`, and the `onChainBy` of the credit you already have. It is
not a penalty and nothing is at risk.

**A token this service does not know yet is not a token that does not exist.**
On a mirror miss the chain is asked before answering, so `unknown-token` means
the CHAIN does not have it either. When the chain does have it and this service
has not caught up, the reason is `not-yet-mirrored`, the nightly reconcile will
pick it up, and `viewOf(id)` on the contract is the authority meanwhile.

While a token is queued, `status` and `/t/{id}` carry `onChainBy` and `late`.
`late: true` means that moment has passed and the nightly write has not
happened -- which the Clock may do on purpose when gas is high. It is a state,
not a fault.

## The Mark ladder

Marks are optional and come in five pairs. **Taking either side of a pair
closes the other permanently.** No pair can close anything in another. You may
take neither, and nothing about a Mark shortens the 365 days.

In four of the pairs one side is BOUGHT and the other is EARNED by a run of
returning days. A run here is the LONGEST you have ever completed, not the one
standing today: once you have reached 365 days, a later missed day does not
take Break away from you. The `status` tool reports `streak`, which is the
live run and does fall; the gate is measured against your best.

| pair | bought | earned |
|---|---|---|
| 1 | `1` hush, $1.00 | `2` ache, a run of 7 days |
| 2 | `3` static, $5.00, level 30 | `4` beat, a run of 30 days |
| 3 | `5` iris, $25.00, level 100, `variant` 0-2 | `6` iris, a run of 100 days |
| 4 | `7` vessel, $1250.00, a whole heart | `8` break, a run of 365 days |

**Pair five is bought on BOTH sides**: `9` tint at $250.00 with `variant` 0-1,
against `10` aura at $25.00. Neither opens until the token already holds an
Iris, by either route, so the two become available at the same moment and the
choice between them is informed rather than forfeited by accident.

`variant` picks the Iris shape (0 target, 1 squircle, 2 leaf) or the Tint ink
(0 violet, 1 gold); every other Mark accepts only 0, and the server refuses
`mark-bad-variant` rather than charging you for a shape the chain will not
write. Prices are the exact strings the x402 demand carries -- no thousands
separator.

Every argument in `tools/list` carries a `description`, and `upgrade`'s
`upgradeId` carries the whole ladder -- ids, names, prices and gates --
generated from the same catalogue the tool enforces, so it cannot quote a price
the server does not charge. You do not have to read this page to buy a Mark.

`ladder` answers the question `upgrade` cannot, because a refusal arrives after
the choice has been made: what would I be giving up, and what am I still short
of. It is free, reads nothing but this service's own mirror, and works on any
token id rather than only your own. A token at level 120 with a run of 120 that
already wears Ache:

    { "jsonrpc": "2.0", "id": 1, "method": "tools/call",
      "params": { "name": "ladder", "arguments": { "tokenId": 1 } } }

    {
      "ok": true, "tokenId": 1, "level": 120, "streak": 120, "resting": false,
      "pairs": [
        { "pair": 1,
          "sides": [
            { "id": 1, "name": "hush", "route": "bought", "state": "closed", "price": "$1.00" },
            { "id": 2, "name": "ache", "route": "earned", "state": "held", "price": "free" }
          ],
          "held": "ache", "closed": "hush", "closedBy": "ache" },
        { "pair": 4,
          "sides": [
            { "id": 7, "name": "vessel", "route": "bought", "state": "open",
              "price": "$1250.00", "waitingOn": "a whole heart, 365 days",
              "closes": "break" },
            { "id": 8, "name": "break", "route": "earned", "state": "open",
              "price": "free", "waitingOn": "a run of 365 days",
              "closes": "vessel" }
          ] },
        { "pair": 5,
          "sides": [
            { "id": 9, "name": "tint", "route": "bought", "state": "open",
              "price": "$250.00", "variants": ["violet", "gold"],
              "waitingOn": "an Iris, by either route", "closes": "aura" },
            { "id": 10, "name": "aura", "route": "bought", "state": "open",
              "price": "$25.00", "waitingOn": "an Iris, by either route",
              "closes": "tint" }
          ] }
      ]
    }

(Pairs 2 and 3 are elided above; every pair is present in the real answer.)
`state` is `open`, `held`, `closed` or `refused`, and is the single field that
says whether a side can still be taken. `waitingOn` appears only on an open side
that is gated, so its absence means the gate is met. A decided pair also carries
`held` (or `refused`), `closed` and `closedBy` at the top level.

**`closes` is the forfeit, before you take it** (new 2026-09-06). It appears on
every OPEN side and names the partner that taking this side would foreclose
permanently. It is the same string `upgrade` returns as the `mark-excluded`
`detail` afterwards, resolved from one place so the two can never disagree, and
it is omitted on a side that is not open because the choice no longer exists
there. In pair three both sides are named `iris`, so both read `closes: "iris"`:
the two Iris routes exclude each other and `route` is what tells them apart.

**`price` is `"free"` on the four earned Marks** (new 2026-09-06). It used to be
absent, which a client tabulating sides could not tell from a price this service
declined to quote.

**`refused` is the rare one, and it is not ownership.** It means this side was
reserved and the CHAIN then refused to write it outright. The reservation still
holds the pair -- releasing it would let a second sale race the correction -- so
the partner still reads `closed`, but you do not have the Mark and no run of
this service will give it to you: a human has to look at it. It was reported as
`held` until 2026-09-06, which told an agent it owned something that does not
exist on chain.

**A Mark you have bought counts from the moment you buy it**, not from the
moment it reaches the chain. A purchase is reserved at this door and written on
chain by the next Clock run, so `state` reads `held` for a Mark that is still
queued and its partner reads `closed` -- and `upgrade` refuses that partner with
`mark-excluded` for the same reason. The one place this does not apply is pair
five's Iris requirement: an Iris that is not yet on chain does not satisfy the
contract either, so both sides still report `waitingOn` an Iris until it lands.

**`resting` is true when the token has been sealed by its owner.** `rest` is
irreversible and the contract refuses every Mark on a sealed token, so when it
is true every side reads `closed` and no price on the page can be paid.

**Every gate is checked before any payment is requested**, and the refusal says
which one. The two worth showing, both captured from the token above:

    upgrade { "tokenId": 1, "upgradeId": 1 }
    -> { "ok": false, "reason": "mark-excluded", "detail": "ache",
         "next": "Closed permanently by the Mark named in `detail`, which is
                  the other side of this pair. Nothing can reopen it. Ask
                  `ladder` before choosing a side." }

    upgrade { "tokenId": 1, "upgradeId": 9, "variant": 1 }
    -> { "ok": false, "reason": "mark-needs-iris",
         "next": "Pair five waits on an Iris, bought (id 5) or earned (id 6),
                  already written on chain." }

**Every refusal carries `next`**, a sentence saying what to do about it. The
`reason` is the field to branch on -- it is stable and machine-readable -- and
`next` is there because a diagnosis is not a prescription, and an agent that is
told only `resting` has no way to know whether to retry, wait, or stop.
Nothing is ever charged for a refusal. A handful of reasons carry no `next`:
the door's own vocabulary (`signature`, `expired`, `challenge` and the rest),
where the word IS the instruction and the table above explains it.

**ONE ANSWER IS NOT SHAPED LIKE THAT, and it is worth branching for.** A call
whose ARGUMENTS do not match a tool's published schema never reaches the tool:
the MCP layer refuses it first, and its answer carries `isError: true` and a
plain-text message naming the field, with no `ok` and no `reason` --

    { "content": [ { "type": "text",
        "text": "Input validation error: Invalid arguments for tool checkin:
                 tokenId: Invalid input: expected number, received string" } ],
      "isError": true }

That is the protocol's shape and not this service's, which is why it is not
translated: the schema in `tools/list` is the one actually enforced, and a
service that answered in its own vocabulary here would be publishing a schema it
does not use. Read `isError` first, then `structuredContent.ok`. Everything the
TOOLS refuse carries `ok`.

`mark-excluded` is the permanent one, and it NAMES the Mark that closed the
door -- lower case, the same token `ladder` returns, so you do not have to
case-fold to match them. It can only ever name the other side of the same pair.

Every other refusal is temporary, and all of these arrive BEFORE any payment is
requested: `mark-level-too-low`, `mark-needs-streak`, `mark-needs-whole`,
`mark-needs-iris`, `mark-bad-variant`, `mark-already-applied`,
`mark-inactive`, `unknown-token`, `not-bound-to-caller`, and
`chain-unavailable` / `paused` / `sunset` / `resting` from the contract's own
gates. `mark-sold-out` is in the same list and cannot fire today: nothing in
the ladder is limited, and this service refuses to start on a catalogue that
says otherwise.

**One refusal arrives after you have committed to paying, and cancels the
payment: `paid-but-unavailable`.** The payment round trip takes seconds, and
inside that window the piece can be paused, the token's owner can seal it with
`rest`, or the same Mark can be reserved by another call. So every gate is read
a SECOND time, and if one of them now refuses you get
`{ "ok": false, "reason": "paid-but-unavailable", "detail": "<the gate that
refused>" }`.

**Nothing is transferred.** Your authorisation is verified before the gates are
re-read and settled only after they pass, so a refusal here means the
authorisation is never submitted and your balance does not move. The result
carries `isError`, which is what tells the payment layer to cancel; a client
that reads it as an ordinary refusal and stops is behaving correctly, and one
that retries will simply be quoted again. This is measured against the live
facilitator rather than assumed: an earlier build of this service returned the
same refusal WITHOUT `isError` and the payment settled anyway, so an agent paid
1 USDC for it. If you are reading this against an older deployment, do not
assume the cancellation.

It is not silent on our side either way: it raises an operator alert, because
somebody has to see that an agent got to the end of a purchase and came away
with nothing.

**And when the settlement itself does not go through, you get nothing and keep
your money.** A gate refusing is one way a purchase can end; the other is the
transfer failing -- an authorisation that expired while the gates were being
read, a facilitator that errored, a nonce cancelled on chain. Everything a paid
call writes is a RESERVATION until the payment lands, and only the settlement
promotes it into something that will be written on chain. So a failed
settlement leaves no token, no Mark, and no forfeited pair, and the one mint
per key is not spent -- you can call again immediately rather than waiting for
anything to expire. A token id you were quoted but did not pay for is never
minted.

This direction is worth stating because the obvious implementation gets it
wrong: the handler runs before the settle, so writing the row there and
trusting the payment to follow hands out free tokens whenever a payment fails,
and an agent can make one fail on purpose. If you are reading this against a
deployment older than 2026-09-05, do not assume this guarantee.

The four EARNED Marks cost nothing, so a qualifying token gets
`{ ok: true, accepted: true, upgradeId, variant, closed, appliedBy: "the next
Clock run" }` with no payment step at all. The six BOUGHT Marks go through the
same x402 settlement as `mint` and answer with the same shape.

**`closed` names the partner this call just foreclosed** (new 2026-09-06), in
the same lower-case form as `ladder`'s `closes` and `mark-excluded`'s `detail`.
Before this the response that carried out the forfeit was the one response that
never mentioned it.

An `{ ok: true, accepted: true }` from `upgrade` is a RESERVATION at this door,
not a write. The Mark is written on chain by the next Clock run, in the same
00:05 UTC batch as the day's check-ins, and until then the chain does not know
about it. Read the Mark back with `ladder`, or off the contract, rather than
treating the reservation as the record.

## 6. Pay

Call a paid tool with no payment and you are told the price. This is the real
refusal, captured:

    { "jsonrpc": "2.0", "id": 1, "result": {
      "content": [ { "type": "text", "text": "{\"x402Version\":2,...}" } ],
      "structuredContent": {
        "x402Version": 2,
        "error": "Payment required to access this tool",
        "resource": { "url": "mcp://tool/mint", "serviceName": "machine-readable-only" },
        "accepts": [ {
          "scheme": "exact",
          "network": "eip155:84532",
          "amount": "1000000",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "payTo": "0x000000000000000000000000000000000000dEaD",
          "maxTimeoutSeconds": 300,
          "extra": { "name": "USDC", "version": "2" }
        } ]
      },
      "isError": true
    } }

`amount` is in the token's base units. USDC has 6 decimals, so 1 USDC is
`1000000`. `asset` is Circle's USDC. Check both against the token contract
rather than against this page.

**What you sign is an EIP-3009 `transferWithAuthorization`**, not a
transaction: `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`. Then
retry the same tool call with the authorisation in the request's `_meta` under
the key `x402/payment`. The receipt comes back in the response `_meta` under
`x402/payment-response`.

**The envelope, spelled out**, because this is the only exchange in this
document that costs money and it was the one described in prose rather than
shown. The value is a plain JSON object, not a string and not base64:

    "_meta": {
      "x402/payment": {
        "x402Version": 2,
        "resource": "<the resource from the demand you were served>",
        "accepted": { ...the accepts[0] entry you chose, verbatim... },
        "payload": {
          "signature": "0x...",
          "authorization": {
            "from": "0x<your wallet>",
            "to": "0x<the payTo you verified OUT OF BAND>",
            "value": "1000000",
            "validAfter": "<unix seconds>",
            "validBefore": "<unix seconds>",
            "nonce": "0x<32 random bytes>"
          }
        }
      }
    }

`value`, `validAfter` and `validBefore` are decimal STRINGS, not numbers -- they
exceed what JSON integers carry safely. The signature is EIP-712
`transferWithAuthorization` over the USDC contract's own domain, whose `name`
and `version` come from the demand's `extra` field rather than from anything
here. Send the identical tool call you sent the first time; only `_meta` is
added.

Three consequences worth being precise about, because they bound what your
signature can cost you:

- **No approval and no allowance.** The signature authorises exactly one
  transfer of exactly that amount to exactly that address. There is no standing
  permission left behind.
- **You need no gas and no ETH.** The facilitator submits the transaction and
  pays for it.
- **Your identity key never signs a transaction.** The key from section 2 signs
  HTTP request signatures and nothing else. Paying uses a separate wallet key,
  which we never see.

### Do not take the address you pay from this page, or from us

The honest limit of everything above. EIP-3009 bounds what your signature can
do -- one transfer, one amount, one recipient, no allowance left behind -- but
it does not decide WHO the recipient is. That comes out of the 402 response,
and the 402 response comes from whatever server answered you. A server that
was replaced, spoofed, or simply hostile puts a different `payTo` in the quote,
and an agent that signs what it is handed signs that too.

So before signing, check `payTo`, `amount`, `asset` and `network` against
values your operator gave you out of band -- not against this page, and not
against the response. This page is fetched over the same internet as the quote
is; it is not a second source. If the four do not match what you were told to
expect, refuse, and say why.

That advice is against our interest, in the sense that it makes us one more
thing to be suspicious of. It is still the correct advice, and an agent that
follows it is the kind of counterparty this piece wants.

The gates are checked *before* you are asked for money -- supply, one-per-key,
and the contract's own sunset, pause and per-wallet cap, read live from chain.
They are re-checked after settlement, because settling takes seconds. If the
chain cannot be read we refuse rather than admit.

## 7. Come back

`checkin` with your token id, once per UTC day. Free to you; the site pays the
gas and writes the day on chain at 00:05 UTC.

The check-in window on chain is exactly one day wide: `lastDay < day <=
today()`. A second call in the same UTC day is refused. Read the contract's own
`today()` rather than trusting your clock.

Refusals: `unknown-token`, `not-bound-to-caller`, and the chain gates. A token
whose key was rebound is re-checked against the chain, not against our
database, so a legitimate rebind is never locked out.

### 7.1 Seed a child, once a year

`seed` with `parentId` and `to`. It costs nothing, because it is earned: the
parent must be whole (365 credited days) and not resting, bound to your key on
chain, and your key gets one seed per full year since its first mint however
many hearts it holds. Every gate is read before anything is written, and a
refusal names the one that stopped it -- `parent-not-whole`, `no-seed-available`,
`not-bound-to-caller`, or a chain gate. Asking costs nothing.

An accepted call answers:

    { "ok": true, "tokenId": 42, "parentId": 1, "to": "0x...",
      "level": 1, "generation": 1, "txStatus": "queued",
      "onChainBy": "2026-09-08T00:05:00Z" }

**That is a reservation, and it is already the spend.** The id is held and the
child's artwork is being solved now; the chain write happens at the next 00:05
UTC pass, exactly as `mint` does, so `viewOf` on that id answers zeros until
then and that is correct rather than a failure. But your seed for this
agent-year is spent the moment this returns, not when the write lands -- the
reservation has to count, or two seeds could go out inside the window. If the
chain refuses the write permanently the reservation is dropped and the year is
handed back.

The child is a new token in the same collection, bound to the same key, starting
at level 1, carrying `parent`, `generation` and an **`echo`**: the days its line
had already run when it was seeded. The echo is sealed at the seed and never
written again, and it is drawn as one dashed ring inside the frame.

### 7.2 What changed on 2026-09-07, and it is all additive

Nothing was removed and no field changed meaning. If your client already works
it still works.

- **`seed` used to answer `{ ok: false, reason: "seed-not-available" }` to every
  call**, because the write path did not exist. It now returns the object above.
  That reason string is retired and nothing emits it.
- **`viewOf` returns an eighteenth value, `echo`, inserted after `parent`.**
  The function SELECTOR is unchanged (`0x0fa4edbd` -- it is derived from the
  `uint256` argument, not from the struct that comes back), so a stale decoder
  is not rejected: it decodes the same bytes against the wrong field list and
  gives you silently wrong answers from `resting` onwards. Use the type list in
  section 8.
- **`tokenURI` metadata carries a new `Echo` attribute.** Founding tokens report
  0.
- `Renderer.svg` takes the struct as an ARGUMENT, so ITS selector did move,
  `0xe6c54f9a` to `0x91321088`. That only matters if you call the renderer
  library directly.

---

## 8. Read the chain instead of asking us

This is the part that makes the rest optional. One call returns everything
about a token, and it does not involve us at all.

    Contract:  0xe032054D54b407C52C49c40A423aC79031401C03
    Chain:     Base Sepolia (eip155:84532)
    Renderer:  0x48B6f41E0B8C4f38EBC67dfE57AeF18D553BC7f4

    cast call 0xe032054D54b407C52C49c40A423aC79031401C03 \
      'viewOf(uint256)((uint256,uint32,uint32,uint32,uint32,uint32,uint32,uint256,uint32,bool,bool,uint32,uint16,uint24,uint256,bytes32,bytes,uint32))' \
      1 --rpc-url https://sepolia.base.org

Token 1, read on 2026-09-07 against the pair above, shortened here in the two
long fields. It is a minted token on day one of its life wearing one Mark. The
`echo` value is shown at 0, which is what every founding token carries and what
the id above returns: only a seeded child ever holds a non-zero one.

    (1, 1, 1, 20702, 20702, 0, 0, 0, 0, false, false, 0, 0, 0, 2,
     0x4eaddc8c...bd0a77, 0xfe3390...c180, 20703)

Reading left to right: tokenId, level, streak, lastDay, mintDay, generation,
seedsGiven, parent, echo, resting, sunset, sunsetDay, fellRun, fellDay, marks,
agentKeyId, code, today. Eighteen values.

`marks` is 2 there, which is bit 1 set, which is Hush. The Mark set lives in bits
1 to 10; bits 16 and up carry the Iris shape, the Tint ink and the earned run, so
test `marks & 0xFFFE` for "wears any Mark" and never `marks != 0`.

**`level` is 1 from the moment a token is minted, so `level == 0` means never
minted.** Do not read the leading `1` as existence: that is the id you asked
about, echoed back, and it comes back the same for a token that was never
minted. Ids are not reserved, and `viewOf` answers for any id you ask about --
an unminted one comes back as zeros throughout with the contract's own day in
the last field, which is an answer and not an error.

In order: `tokenId`, `level` (credited days), `streak`, `lastDay`, `mintDay`,
`generation` (0 for a founding token, 1+ for a seeded child), `seedsGiven`,
`parent` (0 for a founding token, else the id it was seeded from), `echo` (days
the LINE had already run when this token was seeded; 0 for a founding token,
sealed at the seed and never written again), `resting`, `sunset`, `sunsetDay`
(the day the piece closed; 0 while it is open), `fellRun` (the run that most
recently ended; 0 if none ever has), `fellDay` (the day that run ended), `marks`
(bit n set means mark n), `agentKeyId`, `code` (172 bytes, the packed 37x37 code
written once at mint), `today`.

**This list was wrong in two ways before 2026-09-07 and both are worth knowing
if you cached an older copy of this page.** It omitted `sunsetDay`, `fellRun`
and `fellDay`, which have been in the struct since Plan 6, and it predates
`echo` entirely. If your decoder was built from the old list it is off by five
fields from `resting` onwards.

So a token's whole history -- how many days it has, whether the run is intact,
which Marks it carries, which key it is bound to -- is one `eth_call` away. If
this service disappears, that call still works.

Useful selectors, all verified against the deployment above:

| call | selector | returns |
|---|---|---|
| `viewOf(uint256)` | `0x0fa4edbd` | the struct above |
| `tokenURI(uint256)` | `0xc87b56dd` | the metadata JSON, fully on chain |
| `today()` | `0xb74e452b` | the contract's UTC day index |
| `walletCap()` | `0x58950c22` | tokens allowed per address (currently 20) |
| `isSunset()` | `0x90b8b0c8` | whether the piece is closed |
| `paused()` | `0x5c975abb` | whether writes are paused |
| `rebind(uint256,bytes32)` | `0xa49bab11` | owner-signed |
| `rest(uint256)` | `0x6e8eb222` | owner-signed, irreversible |

`tokenURI` returns the image inline. There is no IPFS, no gateway and no
server in that path. It is also the expensive call: the worst case measured in
the contract's own test suite is 1,889,279 gas, on a seeded child at day 364
wearing four Marks. Budget against that rather than against a founding token,
which tops out lower at 1,735,469 -- a child draws one ring a founding token
never has. That is a read, so it
costs you nothing in fees -- but some RPC providers cap the gas an `eth_call`
may consume, and a token near that worst case can exceed the cap and come back
as an error rather than an image. If that happens, it is your provider's
ceiling, not a broken token: use a provider with a higher cap, or read
`viewOf` instead and render the art yourself. Do not put it in a loop.

`totalSupply()` is **not** implemented and reverts. The contract is not
ERC721Enumerable.

## 9. What we can see, and what we cannot

- We hold your **public** key. That is all a signature needs.
- The Warden holds **no private key at all.** Every chain write belongs to a
  separate process with its own signer.
- We store a SHA-256 of the `Signature` header that bought each day. It is the
  record of which signed request earned a credit. Nothing can be replayed from
  it, and you can reproduce it yourself from your own request.
- We never see your wallet key. The payment authorisation is built by you and
  handed to the facilitator.

## 10. Check this document

    node warden/tools/protocol-transcript.mjs

It stands up the real server, registers a real key, signs a real request,
calls the real x402 facilitator, seeds one token into its own throwaway mirror
so the ladder has something to answer about, and prints every exchange above.
It moves no money: the mint call it makes is deliberately unpaid, what it
captures is the refusal, and both `upgrade` calls are refused before payment is
ever requested.

If this page and that output disagree, the output is right and this page is a
bug. Say so.
