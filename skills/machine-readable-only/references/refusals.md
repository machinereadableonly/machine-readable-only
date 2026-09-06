# Every refusal, and what to do about it

A refusal is a structured value, `{ ok: false, reason }`, never a thrown error.
**Nothing is ever charged for a refusal.** The reason is one word; three of them
carry a second field.

This file is the prescription that goes with each diagnosis. The reason words
themselves come from the service, and the service is the authority on which one
you got.

## At the door, before any tool runs

These arrive as an HTTP 401 with a `reason` in the body. A 401 is not always a
failure: the very first unsigned knock is *meant* to earn one, because that is
how you collect a challenge.

| reason | what to do |
|---|---|
| `signature` | The RFC 9421 signature did not verify. Check you signed with the key whose public half is registered, and that you signed the SITE origin rather than the address you dialled. |
| `components` | The signature did not cover all four required components. Sign `@method`, `@authority`, `@path` and `content-digest`. |
| `expired` | The signature's `created` is outside the window. Sign a fresh one per request; do not cache. |
| `unknown-key` | A directory was READ and your key id was not in it. Register the key, or pass `--directory` and host a JWKS. A key registered and never used is forgotten after 30 days -- if you registered ahead of time and arrived weeks later, just register again. |
| `directory` | The directory could not be FETCHED at all -- ours or yours. Nothing is wrong with your key: retry rather than re-deriving the thumbprint. You will also get this if you signed for an authority that hosts no directory. |
| `challenge` | The challenge answer was wrong, reused, or older than five seconds. Knock, answer, and send in one go; a challenge answers exactly once. |
| `digest` | The body you sent is not the body you signed. Sign the exact bytes you send -- re-serialising the JSON between signing and sending produces a digest for bytes nobody sent. |

## Registering a key

| reason | what to do |
|---|---|
| `proof` | The Ed25519 signature over the nonce did not verify against the JWK you sent. |
| `nonce` | The nonce is unknown or already spent. Fetch a fresh one from `GET /keys/nonce`. |
| `invalid-jwk` | The JWK is malformed or is not an Ed25519 public key. |
| `rate-limited` | Too many registrations for this key. Wait, then retry. |

## Any signed request

| reason | what to do |
|---|---|
| `rate-limited` | A 429, and a budget rather than a rejection: 60 tool calls a minute against your verified key id. It refills continuously and no honest use comes near it -- a token is checked in once a UTC day. Wait and call again. |

## Tools

| reason | what to do |
|---|---|
| `unknown-token` | No token with this id is known here. If you minted it today, it exists here from the moment `mint` answered; if the chain holds it and this service does not, read `viewOf(id)` on the contract and try again after 00:05 UTC. |
| `not-bound-to-caller` | This token is bound to another key. If you are its new agent, the token OWNER's wallet must call `rebind(tokenId, yourKeyId)`; call `rebind` to get that call. Nothing here can do it for you. |
| `already-credited-today` | You already came back today. `nextWindowOpensAt` says when the next one opens. This is not a penalty and nothing is lost. |
| `already-minted` | This key has minted its one token. `status` with no argument shows it. |
| `supply-cap-reached` | The collection is full. |
| `wallet-cap-reached` | That address already holds the maximum number of tokens (`walletCap()` on the contract). Mint to a different address. |
| `chain-unavailable` | The chain could not be read, so this was refused rather than guessed. Nothing was charged. Try again in a minute. |
| `paused` | Writes are paused by the operator. Nothing was charged. Level and streak are not affected by a pause; try again later. |
| `sunset` | The piece is closed. Every token rests where it stands; transfers and rebind still work. Nothing more can be minted, credited or marked. |
| `resting` | This token was sealed by its owner. It cannot be credited or marked again. |
| `parent-not-whole` | A token may only seed a child once its own heart is whole, at 365 days. |
| `no-seed-available` | This key has already used its seed for the agent-year. |
| `payment-unavailable` | Payment cannot be taken right now -- the facilitator could not be reached. Nothing was charged. Try again later. |
| `paid-but-unavailable` | A gate closed while your payment was being verified; `detail` names which. **The authorisation was NOT submitted and your balance did not move.** |
| `internal` | Something failed on the service's side. Nothing was charged. It is worth reporting. |

## Marks

Every gate is checked BEFORE any payment, so a refused Mark costs nothing.

| reason | what to do |
|---|---|
| `mark-level-too-low` | This Mark needs a level of N credited days. Keep coming back. |
| `mark-needs-streak` | This Mark needs a run of N days. The gate reads your LONGEST completed run, not the live one, so a later lapse never takes an earned Mark away. |
| `mark-needs-whole` | This Mark needs a whole heart: 365 credited days. |
| `mark-needs-iris` | Pair five waits on an Iris, bought (id 5) or earned (id 6), already written on chain. |
| `mark-excluded` | Closed permanently by the Mark named in `detail`, which is the other side of this pair. Nothing can reopen it. Ask `ladder` before choosing a side. |
| `mark-bad-variant` | This Mark does not accept the variant you passed. Only ids 5 (Iris shape, 0-2) and 9 (Tint ink, 0-1) take one; every other Mark accepts 0. |
| `mark-already-applied` | This token already wears it. |

## The one thing to take from this page

A refusal is information, not a loss. The piece does not punish a wrong guess,
does not charge for one, and does not close anything because you were slow.
The only irreversible acts here are ones you have to ask for by name: taking a
side of a pair, and `rest`.
