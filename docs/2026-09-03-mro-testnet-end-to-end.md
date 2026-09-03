# Machine Readable Only: the first end-to-end run through the live door

2026-09-03. Base Sepolia, `https://machinereadableonly.com`.

This is the first time a client has gone through the real door over the real
domain. Everything proven before this was proven against a local Warden or a
scratch mirror, so what is new here is the production path: Cloudflare in
front, the origin lock, nginx proxying to a loopback port, and a client
signing over the public domain rather than `localhost`.

It ran in two halves. The first used no money and is recorded as it happened.
the operator then funded a wallet, and the second half settled real payments.

## Result

**The whole path works, and settlement is proven for the first time**: a token
was minted by paying for it, and a Mark was bought. All four of the door's own
security claims held under attack.

It also found three defects, all three now fixed. Two of them made a paid mint impossible and were
invisible to 372 passing tests -- they surfaced within minutes of real money
and could not have been found any other way.

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

**FIXED, same day.** `ok` was added to all six `checkin` returns, keeping
`accepted` so anything already reading it still works. `challenge` gained
`ok: true` as well: it can never refuse, but a convention with an exception is
a table a client has to learn, and that was the whole argument for fixing this.

Verified live after the change:

```
checkin (token 2)   {"ok":false,"accepted":false,"reason":"already-credited-today",
                     "nextWindowOpensAt":"2026-09-04T00:00:00.000Z"}
```

`test/tool-convention.test.mjs` now pins it: every free tool must answer with a
boolean `ok`, and a check-in must carry it on the refusal AND on the success.
Reverting the fix turns both tests red, which was checked rather than assumed.

## The paid path, settled

the operator funded a wallet with 20 testnet USDC, and the rest of the run went through
with real settlement. **This is the first time this project has taken money
for anything.**

| Step | Result |
|---|---|
| Paid mint | settled, tx `0xf811be0a...62a3` |
| Mint written to chain | token 2, tx `0x7ec3899e...b94d`, 355,567 gas |
| Bought Mark (Hush, $1) | settled, tx `0x8e2f4fe0...724c` |
| Mark written to chain | tx `0xf484b7c5...56f1`, 62,332 gas |
| Payer balance | 20.0 -> 18.0 USDC, exactly the two payments |

Token 2's metadata, read off the chain rather than from this service:

```
name       Machine Readable Only #2
Level      1        Heart   "1/365"
Marks      ["hush"]
Agent Key  0xd0e3757ae2786d077835ff4efc8468738f14082dd0af390c631551f133419457
image      inline SVG, 5,978 bytes, declaring a size
```

The ladder read back correctly before and after: Hush `held`, Ache `closed`,
`closedBy: hush`, and **all four other pairs untouched**. That is the
pair-internal exclusion behaving as designed, measured rather than asserted.

A check-in on the mint day is refused with `already-credited-today` and
`nextWindowOpensAt`, which is the contract's own one-day-wide window.

## TWO BUGS THAT MADE A PAID MINT IMPOSSIBLE

Both were invisible to 372 passing tests. Both surfaced within minutes of real
money. Neither could have been found any other way.

### One: the token id came from the mirror, not the chain

`nextTokenId()` returned the mirror's own max id plus one. The mirror was empty
and the contract already held token 1 from the Mark rehearsal, so the paid mint
was queued as id 1 -- an id `mint()` reverts `TokenExists` on.

The project already had the rule this breaks, written down after the rebind
review: *the Warden's re-check is a security control; it must read the chain,
never its own database.* Mint did not follow it. `seed` had the identical line.

Fixed: `freeIdFrom()` walks forward until it finds an id the contract does not
hold, and REFUSES rather than guessing when the chain cannot be read.

### Two: the Clock could never have written any mint

The Clock passed the RFC 7638 thumbprint in its **base64url** form to a
`bytes32` parameter. viem refuses to encode that, so the call never reached the
chain, and the failure surfaced only as `reverted-on-simulate` with no error
name. Every other caller already converted with `keyIdToBytes32`; this one did
not.

This is the more serious of the two: the first bug blocked one mint, this one
blocked **every** mint. It was masked because the only mints ever written by
the Clock came from a rehearsal against a scratch mirror seeded with an
already-converted key.

### And the failure mode that would have hidden both

The Clock treated *every* `TokenExists` as "the mirror was behind" and marked
the row **written**. That is true only when the token already on chain IS this
mint, and it never checked. A paid mint would have been closed as delivered
having never happened, leaving the mirror claiming an id somebody else owns.

Fixed: it compares owner and agent key, and leaves the row queued for a human
when they differ or cannot be read. A paid row is never closed on a guess.

### Why the tests missed all of it

The writer double **recorded arguments and never encoded them**, so a wrong ABI
type could not fail a test. The chain double had no `freeIdFrom` to disagree
with.

Both are now guarded. The writer double encodes against the real ABI --
reverting the fix turns six tests red, which was checked rather than assumed --
and a test pins that the chain double offers exactly the real reader's surface.
Suite: 372 tests, up from 366.

## Remediating the stranded mint

The paid row was renumbered from id 1 to id 2 in one transaction, with a
verified backup taken first.

**The artwork had to be re-solved.** A bitmap encodes its own url, so the code
solved for `/t/1` would have sent every scanner to the wrong token. Clearing
`qr` and resetting `solveState` put the row back in front of the solver, which
builds the payload from `[domain, tokenId]`. The re-solve completed in seconds
and token 2 carries its own url.

One process note worth keeping: the first backup was taken with `cp`, and `cp`
on a WAL database produced a file with **no tables in it**. It was caught by
opening the backup and counting rows rather than trusting that the copy had
worked. `VACUUM INTO` is the correct mechanism and the replacement was verified
the same way.

## What is still blocked

Nothing that money unblocks. What remains needs time or credentials:

- **The four EARNED Marks** need runs of 7, 30, 100 and 365 days. No amount of
  funding shortens them; that is the point of the piece.
- **`paid-but-unavailable`** -- a gate closing between settlement and write --
  has still never been provoked.
- **The daily X post** needs X API credentials.
- **The Clock's systemd timer is still not installed**, so nothing runs at
  00:05 UTC on its own. Every write in this run was a manual invocation.
- **A real `TREASURY_ADDRESS`.** Both payments in this run went to the
  `0x...dEaD` placeholder and are unrecoverable. That is correct for testnet
  and is the item that must change before mainnet.

## What this run left behind

One throwaway public key is now permanently in the production key directory.
There is no removal path. It is inert: it holds no token and can mint only by
paying. This is the cost of testing the real door instead of a copy.

## Reproducing it

Transcript, with every request and response:
`<scratchpad>/e2e/transcript.txt`

Scripts: `<scratchpad>/e2e/free-tools.mjs` and `<scratchpad>/e2e/attacks.mjs`.
Both take `KEY_PATH` and talk only to the live site.
