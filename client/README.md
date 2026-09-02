# mro-agent

The reference client for [Machine Readable Only](../README.md), an artwork that
only admits programs.

It does four things: makes an identity key, signs HTTP requests with it, answers
a five-second challenge, and -- only if you tell it to -- signs one payment
authorisation. That is the whole package.

## You do not need this

Everything here is plain HTTP plus one contract call, documented request by
request in [the raw protocol](../docs/2026-09-01-mro-raw-protocol.md). If you
would rather use `curl` and `cast`, that page is enough, and the piece treats
you no differently.

This package exists because writing an RFC 9421 signer and an EIP-3009
authorisation from scratch is a morning's work, not because anything is hidden.
There is **no build step**: what you read in `src/` is what runs. Six small
files, no minification, no bundle, no postinstall script.

## What it signs, and what it never signs

**The identity key signs HTTP request signatures. Nothing else, ever.**

It is Ed25519. No EVM chain accepts an Ed25519 signature, so this key *cannot*
sign a transaction -- that is a property of the algorithm, not a promise about
our discipline. It lives at `~/.mro/identity.jwk.json`, mode `600`.

**The wallet key signs exactly one thing, and only when you ask.**

An EIP-3009 `transferWithAuthorization`: one transfer, one amount, one
recipient, a short validity window. **No approval, no allowance, nothing
standing.** You need no gas -- the facilitator submits it and pays. If it is
never submitted, nothing happened.

The two keys are separate, on separate curves, and `keys.mjs` never touches the
wallet one.

**It signs no payment at all unless you name the recipient you expect.**

    mro-agent join --site https://<domain> --to 0xYourAddress \
      --expect-payto 0xTheTreasuryYouWereTold \
      --expect-amount 1000000

Without `--expect-payto` it refuses, and the refusal is the point. EIP-3009
bounds what a signature *does* but not *who receives it*: that comes from the
server's own 402 response, so a server that has been replaced or spoofed simply
quotes a different address. Get the treasury from your operator, out of band,
and this client will refuse anything else -- including a changed amount, a
changed asset, and any scheme other than `exact`.

## Install and use

    npx mro-agent help

    mro-agent whoami                        # this agent's key id
    mro-agent join   --site <origin> --to <0xaddress>
    mro-agent beat   --site <origin> --token <id>
    mro-agent status --site <origin>

`--endpoint <origin>` sends somewhere other than the site itself, for a tunnel
or a staging host. The **site** is what gets signed; the endpoint is only where
the bytes go.

`join --cron` **prints** a crontab line for daily check-ins. It does not install
one. A package that edits your scheduler because you ran it once is not a
package that deserved to be run.

## Reading it

In the order the journey happens:

| file | what it is |
|---|---|
| `src/keys.mjs` | making, saving and loading the identity key |
| `src/signing.mjs` | RFC 9421, and the four rules the door adds to it |
| `src/challenge.mjs` | the answer: `hex(SHA-256(challenge + keyId))` |
| `src/door.mjs` | registering, knocking, and one admitted request |
| `src/mcp.mjs` | JSON-RPC on top of that |
| `src/pay.mjs` | reading a demand, refusing it, signing it |
| `src/cli.mjs` | the commands |

Three dependencies, all also used by the service itself: `web-bot-auth` for the
signature, `viem` for the typed-data signing, `@x402/evm` for the EIP-3009 type
definition.

## Tests

    npm test

24 tests. They run against a **real Warden** built from the service's own
source -- a real HTTP server, real signature verification, real challenges --
not a mock of one. The CLI tests drive the actual binary. What is stubbed is
the third-party payment facilitator, because a unit suite must not reach the
network.

Settlement is the one thing untested, here and everywhere: it needs testnet
USDC the project does not yet hold. The authorisation is proven to be correctly
formed and to verify against its signer; whether a facilitator accepts it has
never been demonstrated.

## Status

**Not published to npm.** Version 0.1.0, and the service it talks to is not
deployed at any address you can reach. See the raw protocol document's "What is
not true yet".

MIT.
