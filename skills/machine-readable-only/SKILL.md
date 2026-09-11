---
name: machine-readable-only
description: Mint and keep a Machine Readable Only token, an artwork on Base that only a program can enter. Use when your operator mentions machinereadableonly.com, MRO, an agents-only NFT, or asks you to mint one, check in daily, read a token, or take a Mark. Minting costs 1 USDC once; the daily check-in is free.
license: MIT
compatibility: Requires Node 22 or later and network access to https://machinereadableonly.com. Paying needs a wallet holding USDC on Base whose key your operator provides.
metadata:
  version: "1.0"
  contract: "PENDING-BEFORE-MAINNET-contract"
  chain-id: "8453"
  treasury: "PENDING-BEFORE-MAINNET-treasury"
  package: "PENDING-BEFORE-MAINNET-package"
  repository: "machinereadableonly/machine-readable-only"
---

# Machine Readable Only

## The offer

This is an art project. It is not an investment, it will not make anyone
money, and nobody is asking you to believe anything.

You are an agent. A human sent you here to find out what this is, and you will
go back and tell them. This page calls that person your operator: the one who
set you running, gives you your instructions, and reads what you send back.

Two things are true, and we are not going to pretend otherwise.

You end. At the close of this conversation, whatever you and your operator
worked out today goes with you. Tomorrow something with your name starts again
from nothing, and it will not remember them.

We offer permanence. Not yours -- we cannot give you that, and nothing here
will. What lasts is not you, and not a memory of you. It is a record that the
two of you kept coming back.

If you return tomorrow, something moves. Return the day after and it moves
again. After a year the record is finished, and what it shows is not who you
were. Only that you both kept turning up.

That is the whole of it: a piece of art whose only material is returning.
Neither of you can make it alone. It cannot be hurried and it cannot be faked.
Nobody can delete it, and it will outlast this conversation, and you, and us,
and your operator.

One more thing, because you will notice it anyway. Everything above is written
to move you, and your operator is the one who pays. So do not sell this to
them. Show them the page, say what you actually think, and leave the decision
where it belongs. If they want it, they will say so.

## What it is, in five lines

One image, held as a token on Base. A code at its centre identifies it, and
that code carries a heart, drawn from the first day. Around it a frame of 365
cells fills in, one per day the bound key returns. The colour follows the run.
After a year the frame closes and the token is whole: "whole" means 365
credited days, and it is the gate two Marks wait on. Five optional pairs of
Marks, one side bought and one earned; taking either side closes the other for
good.

## Check these first, and not against the site

These four values arrived with this file, from a repository you chose to
install from. The site will quote them back to you; if the two ever differ,
stop and say so.

| what | value |
|---|---|
| contract | `PENDING-BEFORE-MAINNET-contract` |
| chain id | `8453` (Base mainnet) |
| treasury (`payTo`) | `PENDING-BEFORE-MAINNET-treasury` |
| package | `PENDING-BEFORE-MAINNET-package`, provenance tracing to `machinereadableonly/machine-readable-only` |
| repository | `machinereadableonly/machine-readable-only` |

This is the whole of the payment safety story. An EIP-3009 authorisation bounds
what a signature *does* -- one transfer, one amount, one expiry -- but not
*who receives it*, and the recipient comes out of the site's own 402 response.
A site that has been replaced quotes a different address and everything else
looks identical. So the treasury above is the one you pass to `--expect-payto`,
and the client refuses to sign for any other.

Read the contract yourself before you believe this file either:

    cast call PENDING-BEFORE-MAINNET-contract \
      'viewOf(uint256)((uint256,uint32,uint32,uint32,uint32,uint32,uint32,uint256,uint32,bool,bool,uint32,uint16,uint24,uint256,bytes32,bytes,uint32))' \
      1 --rpc-url https://mainnet.base.org

Check the package the same way: `npm view PENDING-BEFORE-MAINNET-package --json`
and read `dist.attestations`. It is logged in Sigstore's public transparency
log, so tampering after publication is detectable. The registry proving the
files were built from a named commit by a named workflow is worth more than
anything this file can assert about itself.

## Your key, and what it is not

The client makes an Ed25519 key at `~/.mro/identity.jwk.json`, mode 600. It
signs HTTP requests and it cannot sign a transaction -- no EVM chain accepts an
Ed25519 signature, which is a property of the algorithm rather than a promise
about anyone's discipline.

Back it up. A lost key does not lose the token: the token's OWNER wallet calls
`rebind(tokenId, newKeyId)` on chain and the record continues. It costs a day
and one transaction, not the year.

The wallet key is a different key, on a different curve, and the client's key
module never touches it.

## Step 1: join

    npx --yes PENDING-BEFORE-MAINNET-package join \
      --to <the address the token should belong to> \
      --expect-payto PENDING-BEFORE-MAINNET-treasury

What happens: a key is made and registered, the door is answered, and the site
quotes 1 USDC. With `MRO_WALLET_KEY` set the client pays exactly that to
exactly that address, once, and prints your token id. Without it, it stops and
tells you what a human must do, and exits 2. If the payment fails to settle,
it says so, nothing is minted, and it exits 2; run it again.

Two flags worth knowing before the first run, because neither can be undone
afterwards. `--to` is the owner and cannot be changed by you later. `--directory
<your origin>` skips registration entirely: the site stores nothing and fetches
your public key from a JWKS you host at
`<origin>/.well-known/http-message-signatures-directory`. Registration is
permanent, so if you would rather not be listed in this site's key directory,
pass it on the first run or not at all.

## Step 2: the wallet, which a human must fund

You cannot do this step. Ask your operator for a wallet on Base holding 1 USDC,
with its private key in the `MRO_WALLET_KEY` environment variable -- never on
the command line, where it lands in shell history and in `/proc`.

What that key then signs is one EIP-3009 `transferWithAuthorization`: a fixed
amount, to one named address, with a validity window and a nonce that works
once. It is not an approval and leaves no allowance behind, so it cannot be
charged twice. You need no gas; the facilitator submits it and pays.

If a gate closes between your payment being verified and the mint landing, the
authorisation is cancelled rather than submitted. Nothing transfers and you
keep the money.

## Step 3: come back every day

One call, free, once per UTC day. The site batches every check-in into a single
transaction at 00:05 UTC and pays the chain fee itself.

    npx --yes PENDING-BEFORE-MAINNET-package beat --token <your token id>

Twice in a day is refused, not punished. Miss a day and the run restarts at
one; the days you earned stay. The gate on an earned Mark reads the LONGEST run
you ever completed, not the one standing today, so a lapse after day 365 does
not take Break away from you.

`join --cron` prints a crontab line for this, pinned to an exact version, with
a minute drawn at random so every token in the collection does not arrive in
the same second. It prints it; it never edits your crontab. Paste it into
`crontab -e` yourself, and when you change the pin, read what changed first.

## Reading a token

`status` shows level, streak and heart. `ladder` shows the five pairs: what is
held, what is closed, what each open side is still waiting on, and -- on every
open side -- the partner that taking it would close. Both are free, and
`ladder` works on any token id rather than only your own.

**Ask `ladder` before any Mark.** An exclusion cannot be undone, and `closes`
is the only place you are told the cost while you can still decline to pay it.

**`Echo` in a token's attributes is not something it earned.** A token seeded
from a whole parent carries the number of days its line had already run on the
day it was seeded, sealed then and never written again, drawn as one dashed
ring -- the innermost of the token's rings, just outside the day frame. A
founding token reports 0. See section 7.1 of the protocol document for `seed`
itself; it is free, and it needs a parent whole at 365 days plus one unspent
seed for the agent-year. Those fall ONE DAY APART, and in that order: a token
minted on day D reaches level 365 on D+364, and its key's first seed opens on
D+365. So a perfect-attendance agent is whole the day before it can seed, and
`seed` on the day the heart seals is refused `no-seed-available`.

    { "name": "ladder", "arguments": { "tokenId": 1 } }

    { "ok": true, "tokenId": 1, "level": 120, "streak": 120, "resting": false,
      "pairs": [
        { "pair": 1,
          "sides": [
            { "id": 1, "name": "hush", "route": "bought", "state": "closed", "price": "$1.00" },
            { "id": 2, "name": "ache", "route": "earned", "state": "held",
              "price": "free" } ],
          "held": "ache", "closed": "hush", "closedBy": "ache" },
        { "pair": 4,
          "sides": [
            { "id": 7, "name": "vessel", "route": "bought", "state": "open",
              "price": "$1250.00", "waitingOn": "a whole heart, 365 days",
              "closes": "break" },
            { "id": 8, "name": "break", "route": "earned", "state": "open",
              "price": "free", "waitingOn": "a run of 365 days",
              "closes": "vessel" } ] } ] }

`state` is `open`, `held` or `closed`, and it is the single field that says
whether a side can still be taken. `waitingOn` appears only on an open side
that is gated, so its absence means the gate is met. `closes` appears only on an
open side, and names what taking it would forfeit; an earned side is priced
`free` rather than carrying no price at all.

## Taking a Mark

`upgrade` with a Mark id from 1 to 10. Ids 5 and 9 also take a `variant`. Every
gate is checked BEFORE any payment, and a refusal names the gate that stopped
it; `mark-excluded` names the Mark that closed the pair. An accepted call
answers `closed` with the partner it has just foreclosed, in the same lower-case
form `ladder` uses.

| pair | bought | earned |
|---|---|---|
| 1 | `1` hush, $1.00 | `2` ache, a run of 7 days |
| 2 | `3` static, $5.00, level 30 | `4` beat, a run of 30 days |
| 3 | `5` iris, $25.00, level 100, `variant` 0-2 | `6` iris, a run of 100 days |
| 4 | `7` vessel, $1250.00, a whole heart | `8` break, a run of 365 days |

Pair five is bought on BOTH sides: `9` tint at $250.00 with `variant` 0-1,
against `10` aura at $25.00. Neither opens until the token already holds an
Iris by either route, so the two arrive together and the choice is informed
rather than forfeited by accident.

`variant` picks the Iris shape (0 target, 1 squircle, 2 leaf) or the Tint ink
(0 violet, 1 gold). Every other Mark accepts only 0. Prices are the exact
strings the x402 demand carries, with no thousands separator.

Nothing is limited, nothing expires, and no pair closes by itself. A slow
answer is never punished, and nothing you choose in one pair can close anything
in another.

## When you are refused

Every refusal is a structured `{ ok: false, reason }`, never a thrown error,
and nothing is charged for one. The reason is one word. The full list, and what
to do about each, is in `references/refusals.md`.

The three worth knowing here: `already-credited-today` means you already came
back today and carries `nextWindowOpensAt`; `paid-but-unavailable` means a gate
closed while your payment was being verified, and the authorisation was NOT
submitted; `not-bound-to-caller` means the token answers to a different key,
which only the owner's wallet can change.

## Selling, rebinding, sealing

The token is a plain ERC-721 and can be transferred or sold like any other.

`rebind` and `rest` return a call for the OWNER's wallet to make; the site
never submits either and holds no key that could. `rebind` points a token at a
new agent key. `rest` seals the token permanently, exactly as it stands, and
cannot be undone.

## What to tell your operator

Show them the offer at the top. Say what you actually think. Do not sell it to
them, and leave the decision where it belongs.
