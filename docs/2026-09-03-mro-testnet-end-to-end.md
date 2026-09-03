# Machine Readable Only: the first end-to-end run through the live door

2026-09-03. Base Sepolia, `https://machinereadableonly.com`.

This is the first time a client has gone through the real door over the real
domain. Everything proven before this was proven against a local Warden or a
scratch mirror, so what is new here is the production path: Cloudflare in
front, the origin lock, nginx proxying to a loopback port, and a client
signing over the public domain rather than `localhost`.

No funds moved. The run stops at settlement, which is the one thing testnet
USDC is still needed for.

## Result

**Everything that does not need money works, and all four of the door's own
security claims hold under attack.** One real defect was found, in the
response shape of the daily check-in.

## What was exercised

| # | Step | Result |
|---|---|---|
| 1 | Generate a fresh Ed25519 identity | key id `gETD7IQxGIFfk4nXC_O391jWy2EMxEqDfsdIugVYVlg` |
| 2 | `GET /keys/nonce` then `POST /keys` | registered |
| 3 | Key appears in the live key directory | `keys: []` before, one public JWK after |
| 4 | Signed RFC 9421 request + 5s challenge | admitted, nine tools listed |
| 5 | Every free tool against an empty mirror | eight structured refusals, none threw |
| 6 | `GET /t/<id>` | 404 for 1, 2 and 999 |
| 7 | `mint` with no payment | a readable x402 demand |
| 8 | The demand's contents | checked on chain, below |

### The mint demand, checked rather than read

```
scheme   exact
network  eip155:84532
amount   1000000
asset    0x036CbD53842c5426634e7929541eC2318f3dCF7e
payTo    0x000000000000000000000000000000000000dEaD
```

The asset was read off Base Sepolia rather than taken from the demand: `name`
and `symbol` are both `USDC` and `decimals` is 6, so `1000000` is exactly one
USDC. The published price is therefore correct at the wire level, not just in
the documentation.

`payTo` is the `0x...dEaD` placeholder. That is the intended state and it is
the proof that the treasury guard is real: the Warden refuses to start with a
placeholder on any chain but Sepolia.

**This also re-proves the blocking bug fixed in `eaac15a` against production.**
The demand was once double-wrapped so an official x402 client could not see it
and nothing could be minted. A real client read it correctly here.

## The door's claims, tested as attacks

Each of these must be refused. A pass is a refusal.

| Attack | Result |
|---|---|
| No signature at all | 401, carrying a fresh challenge |
| **Body swapped after signing** | 401 |
| Challenge used after its 5 seconds | 401 |
| The same challenge used twice | 401 on the second use |

**The body-swap result is the one that matters**, because it is the claim
added to `llms.txt` this morning: the door requires `content-digest`, so a
signature is bound to the body and a mint's recipient cannot be substituted.

It is reported with its control. The replay test's FIRST request used the
identical signing path with a matching body and returned **HTTP 200**. So the
only difference between the admitted request and the refused one is the body
itself. Without that control a 401 would prove nothing -- every refusal on
this door looks alike from outside.

## Infrastructure

The origin lock holds: HTTPS straight to the origin IP returns 403, the same
request through Cloudflare returns 200.

Port 80 returns 301 rather than 403, and that is deliberate. The lock is on
the TLS block only, because certbot renews over HTTP-01 on port 80 and locking
it would break renewal silently about sixty days later. A probe that tests
port 80 and calls the lock broken has tested the wrong port.

## The defect

**`checkin` returns `accepted`; every other tool returns `ok`.**

Observed live:

```
status  (token 1)   {"ok":false,"reason":"unknown-token"}
ladder  (token 1)   {"ok":false,"reason":"unknown-token"}
rebind  (token 1)   {"ok":false,"reason":"unknown-token"}
rest    (token 1)   {"ok":false,"reason":"unknown-token"}
checkin (token 1)   {"accepted":false,"reason":"unknown-token"}
```

On success `checkin` answers `{ accepted: true, ... }` with no `ok` field at
all. `upgrade`, by contrast, returns BOTH (`{ ok: true, accepted: true }`),
which is what makes the inconsistency easy to miss when reading the source.

Why it matters: a third-party client written against `llms.txt` -- which says
only that errors carry a `reason` -- will reasonably branch on `ok`. Against
`checkin` that field is `undefined`, so **a successful daily check-in reads as
a failure**. The daily check-in is the entire obligation of the piece, and it
is the one call every participant makes for 365 days.

It is invisible from inside the project because the reference client prints
whatever comes back rather than branching on it, and because the test suite
asserts against the shape the code already produces.

Recommended fix: add `ok` to every `checkin` return, keeping `accepted` so
nothing that already reads it breaks. Documenting the exception instead is
worse -- the value of one convention is that a client need not learn a table
of exceptions.

## What is still blocked

**Settlement.** Everything up to the moment money moves is now exercised
against production. The remaining step needs testnet USDC on Base Sepolia in a
wallet the client controls, and the faucet is captcha-gated. Until that
exists:

- no token has been minted by paying for it;
- the six bought Marks are undemonstrated;
- the `paid-but-unavailable` path -- a gate closing between settlement and
  write -- has never been provoked.

The four earned Marks need no payment, but they need a token, which needs a
mint.

## What this run left behind

One throwaway public key is now permanently in the production key directory.
There is no removal path. It is inert: it holds no token and can mint only by
paying. This is the cost of testing the real door instead of a copy.

## Reproducing it

Transcript, with every request and response:
`<scratchpad>/e2e/transcript.txt`

Scripts: `<scratchpad>/e2e/free-tools.mjs` and `<scratchpad>/e2e/attacks.mjs`.
Both take `KEY_PATH` and talk only to the live site.
