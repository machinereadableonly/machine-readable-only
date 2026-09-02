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

## What is not true yet

Stated first, because a document that quietly describes a future is worse than
no document.

- **There is no domain.** `<domain>` below is a placeholder. The service runs,
  is tested, and is not deployed anywhere you can reach.
- **The contract address below is Base Sepolia**, chain id 84532. It is a real
  deployment you can read today, and it is not the mainnet piece.
- **Settlement has never been proven.** Everything up to the moment money moves
  is exercised against the live x402 facilitator. The final step, a facilitator
  actually transferring USDC, needs testnet USDC we do not yet hold.
- **The treasury address is a placeholder** (`0x...dEaD`). Do not pay it.

## The shape of it

    GET  /.well-known/http-message-signatures-directory   who we accept keys from
    GET  /keys/nonce                                      a nonce to prove a key with
    POST /keys                                            register a key (no domain needed)
    POST /mcp                                             everything else, signed
    GET  /t/{id}                                          one token, public, unsigned

Two things gate `/mcp`: an RFC 9421 signature, and a five second challenge. You
need both on every request. There is no session and no login.

---

## 1. Knock, and be refused

Any request to `/mcp` without a signature earns a 401 that tells you how to
come back. This is the intended first request; there is nothing rude about it.

    POST /mcp HTTP/1.1
    Host: <domain>

    HTTP/1.1 401 Unauthorized
    Content-Type: application/json

    {
      "challenge": "eBiJifjWTB1Z3BjsSun4tSzxHNJXcmzV8XNf9wJKxaI.1788291258535.124d1a2f8c7d0675cc030ce5fdec94174c38d1fd19aab30b72107b0c04fb9953",
      "expires": "2026-09-01T19:34:23.535Z",
      "mcp": "https://<domain>/mcp",
      "docs": "https://<domain>/llms.txt",
      "client": "https://<domain>/client.mjs"
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

The distinction matters if you are reasoning about what a restart loses. A
restart forgets which challenges were spent, so a challenge captured in the
preceding five seconds could in principle be replayed across it. The signature
is what authenticates; this is the freshness check on top.

A 401 may also carry a `reason` field. It is a diagnostic, not a rebuke:

| reason | what it means |
|---|---|
| absent | you sent no signature at all |
| `signature` | the signature did not verify |
| `components` | it verified, but did not cover the required components |
| `expired` | the signature window exceeds five minutes, or the challenge is stale |
| `unknown-key` | we could not find that key id |
| `directory` | your directory could not be fetched. Ours, not yours: try again |
| `challenge` | missing, wrong, or already spent |

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
Ed25519 verify each. Rate limiting that is nginx's job, not this handler's.

Registered keys are then served in our own directory, which anyone can read:

    GET /.well-known/http-message-signatures-directory HTTP/1.1

    HTTP/1.1 200 OK
    Content-Type: application/http-message-signatures-directory+json

    { "keys": [ { "crv": "Ed25519", "x": "mlZJUoSOnQSPIAFaLmsXlVgvy3WdBuw69atNn6dRZDg", "kty": "OKP" } ] }

Registering here means sending `Signature-Agent: "https://<domain>"` -- ours,
because we are the ones holding your key.

## 3. Sign the request

RFC 9421 HTTP Message Signatures, Web Bot Auth profile. Four headers go on
every `/mcp` request. Here is a real set:

    signature-agent: "https://<domain>"
    Signature: sig1=:5C3hhnZglRjetkvKUx2MUBYuIcrenPZhGE3rf69FJCxNem2SSeghqfhinMaaJeW26jRboQO40bynu4/SE+MQBg==:
    Signature-Input: sig1=("@authority" "@method" "@path" "signature-agent");created=1788291258;keyid="gkKHv4HPNo5hOT9kFD8Ig5ZVhPQdT-2A42ULHj00TBA";alg="ed25519";expires=1788291318;nonce="JFYPvAppn...";tag="web-bot-auth"
    challenge: i8mp0lOoiyw9yF_n9_XykWlxSbZqFYZoQ--qCcr3W-g.1788291258605.5c60802915cc77653a64208251c9068c3851d748797e0b9b8b990412bfc839ee
    challenge-response: 05daa76ef95a2e6d4fcd3334f23cbb07fd5196f27976af423f73160e0a76eb3f

Four rules, all enforced, all refused with `components` or `expired` if broken:

- **The signature must cover exactly these components:** `@authority`,
  `@method`, `@path`, `signature-agent`, `content-digest`. The standard
  mandates only `@authority`; the other four are this service's own rule.

  **`content-digest` is what binds the signature to the BODY, and it is not
  optional.** Send RFC 9530's `sha-256=:<base64 of SHA-256 of the exact bytes
  you send>:` and cover it in the signature. Serialise your JSON ONCE and sign
  the same string you send -- re-serialising an equivalent object produces a
  digest for bytes nobody sent, and the door refuses it with reason `digest`.

  Why it is required, since the reasoning is not obvious: every call goes to
  `POST /mcp`, so `@method` and `@path` are identical across all eight tools
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
request. Send `Accept: application/json, text/event-stream`; replies may come
back as a single SSE `data:` line.

    POST /mcp HTTP/1.1
    Content-Type: application/json
    Accept: application/json, text/event-stream

    { "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }

Eight tools. None of them takes your key id -- it comes from the signature.

| tool | arguments | costs |
|---|---|---|
| `challenge` | none | free |
| `status` | `tokenId?` | free |
| `checkin` | `tokenId` | free |
| `mint` | `to` (0x address) | 1 USDC |
| `upgrade` | `tokenId`, `upgradeId` (1-7) | the Mark's price |
| `seed` | `parentId`, `to` | free |
| `rebind` | `tokenId` | free, returns a call to sign |
| `rest` | `tokenId` | free, returns a call to sign |

`upgrade` takes an `upgradeId` of 1 to 7 because that is what the server
accepts today. Write your client against that range: the ladder has ten Marks,
and ids 8, 9 and 10 are refused by the schema, not by a gate.

**Some `upgrade` calls now succeed (updated 2026-09-02).** The catalogue is
wired. Ids 2, 4 and 6 -- Ache, Beat and the earned Iris -- are EARNED by a run
of returning days and cost nothing, so a qualifying token gets
`{ ok: true, accepted: true, upgradeId, appliedBy: "the next Clock run" }` with
no payment step at all. Ids 1, 3, 5 and 7 are BOUGHT and go through the same
x402 settlement as `mint`, priced from $1.00 to $1,250.00. A call that does not
qualify is refused before any payment, by name: `mark-level-too-low`,
`mark-needs-streak`, `mark-needs-whole`, `mark-already-applied` or
`mark-inactive`.

THE REST OF THE LADDER IS NOT REACHABLE YET (2026-09-02). Ten Marks sit in five
pairs; in four pairs one side is bought and the other earned by a run of days,
and the fifth is bought on both sides. Taking either side of a pair closes the
other permanently, and no pair can close another. Break (8) is earned at 365
days, and Tint (9) and Aura (10) are both gated on already holding an Iris --
that gate is not implemented, which is precisely why the schema still stops at
7. When it ships, `upgradeId` widens to 1-10 and `upgrade` grows a third
parameter, `variant`, which only the bought Iris and Tint accept. It is named
here so the change is not a surprise; **nothing above describes ids 8-10 as
working, because they are not.**

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

---

## 8. Read the chain instead of asking us

This is the part that makes the rest optional. One call returns everything
about a token, and it does not involve us at all.

    Contract:  0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D
    Chain:     Base Sepolia (eip155:84532)
    Renderer:  0x00c3B576769cd42852328528E0D97F76a51A2E7c

    cast call 0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D \
      'viewOf(uint256)((uint256,uint32,uint32,uint32,uint32,uint32,uint32,uint256,bool,bool,uint256,bytes32,bytes,uint32))' \
      1 --rpc-url https://sepolia.base.org

A live answer, token 1:

    (1, 2, 2, 20696, 20695, 0, 0, 0, false, false, 0, 0x00...a9e1, 0xfe00810b..., 20697)

In order: `tokenId`, `level` (credited days), `streak`, `lastDay`, `mintDay`,
`generation`, `seedsGiven`, `parent`, `resting`, `sunset`, `marks` (bit n set
means mark n), `agentKeyId`, `code` (172 bytes, the packed 37x37 code written
once at mint), `today`.

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
server in that path. It is also the expensive call: the worst measured case is
1,633,224 gas for a token the day before its heart seals. That is a read, so it
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
calls the real x402 facilitator, and prints every exchange above. It moves no
money: the mint call it makes is deliberately unpaid, and what it captures is
the refusal.

If this page and that output disagree, the output is right and this page is a
bug. Say so.
