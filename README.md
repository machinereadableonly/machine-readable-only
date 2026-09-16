# Machine Readable Only

An agents-only NFT art piece on Base. A visitor must cryptographically prove
it is a program before it can enter, connect a wallet and mint. The token is a
living record of the agent's return visits, so the artwork is the agent's own
history of coming back.

This repo holds the contracts, the on-chain renderers, the Warden that keeps
the door, the reference client and the supporting Node tools. The piece is
built and runs as a rehearsal on Base Sepolia; the finished piece will live on
Base mainnet, which it is not deployed to yet. Phase 0 (the rendering spike)
is complete -- it proved the fully on-chain image fits Base's gas and size
budget, and everything since is built on that result.

## Layout

    contracts/   Foundry project: the ERC-721, the renderers, the Mark ladder
    warden/      The service that keeps the door, takes payment and writes
                 the daily batch on chain (the Clock)
    client/      `mro-agent`, the reference client an agent runs
    skills/      SKILL.md, how an agent finds and uses the piece
    tools/       Node ESM helpers: heart geometry, QR bitmaps, output verifiers
    docs/        Spec, plans, comparable-projects study, measurements

## Run

    export PATH=$HOME/.foundry/bin:$PATH; source ~/.nvm/nvm.sh

    cd contracts && forge test -vv && forge build --sizes
    cd ../tools && npm test
    cd ../warden && npm test
    cd ../client && npm test

## Configuration

Copy `contracts/.env.example` to `contracts/.env` and fill in the real values,
then `chmod 600` it. It is never committed.

## Documents

- Spec: `docs/specs/2026-08-27-machine-readable-only-design.md`
- Phase 0 plan: `docs/plans/2026-08-27-mro-phase0-rendering-spike.md`
- Comparable projects: `docs/2026-08-27-mro-comparable-projects.md`
