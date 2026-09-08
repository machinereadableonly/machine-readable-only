# What is licensed how, and why

This repository is **source-available, not open source**. You may read all of
it.

**The rule in one line: everything an agent reads or runs is MIT. Only the
implementation that would let you stand up a copy of this piece is restricted.**

Nothing in this file is allowed to stand between an agent and the door. If you
find something here that does, it is a bug in this file, not a policy -- say so
and it will be fixed.

## MIT -- everything an agent touches

| Path | What it is |
| --- | --- |
| `contracts/src` | The token and the renderer. The source is ALREADY public: both deployed contracts are verified on the block explorer, which publishes the full Solidity. An agent is asked to pay this contract, and a contract you cannot audit is one you should not pay. |
| `warden/src/door` | The signature verifier. The piece commits, in its own specification, that this is stateless and open -- because the record shows operators disappear, and a verifier anyone can reimplement is part of how this outlives its operator. |
| `client` | `mro-agent`, the client the piece TELLS agents to run. |
| `skills` | The skill file and its references -- the channel agents actually arrive through. |
| `warden/public` | `llms.txt` and the door page, served to every caller. |
| `server.json` | The MCP discovery card. |
| `docs/2026-09-01-mro-raw-protocol.md` | The agent-facing protocol document, and its rendered copy. |

Many agents with a wallet are commercial operations. Every file above is MIT so
that using this piece -- reading the protocol, installing the skill, running the
client, auditing the contract, paying it -- is unconditionally permitted, for
anyone, commercial or not. An invitation you are not licensed to accept is not
an invitation.

## PolyForm Noncommercial 1.0.0 -- the implementation

`tools`, the rest of `warden`, and the remaining documents: the QR solver and
the heart pipeline, the server implementation behind the door, the specs, plans
and reviews. Read them, learn from them, run them for study or a hobby.
Standing up a commercial copy needs permission.

`contracts/lib` is vendored third-party code (forge-std, OpenZeppelin, Solady)
under its own licences, unchanged and unaffected by anything here.

## What a copy does not get you

Said plainly, because a licence is a legal instrument and not a technical one.

The code can be copied. What cannot be copied is the piece: the deployed
contract and its accumulated record, the domain every token's QR encodes
permanently, and the keys. A fork starts with nobody having come back, and this
artwork IS the coming back. That is not a licensing position, it is the shape of
the work.

## If you want to do something this forbids

Ask. The noncommercial default is a starting position chosen because it is
easier to loosen a licence than to tighten one after people have relied on it.
