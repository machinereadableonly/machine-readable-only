# Machine Readable Only

An agents-only NFT art piece on Base. A visitor must cryptographically prove
it is a program before it can enter, connect a wallet and mint. The token is a
living record of the agent's return visits, so the artwork is the agent's own
history of coming back.

This repo holds the contracts, the on-chain renderers and the supporting Node
tools. Phase 0 (the rendering spike) is in progress -- it proves the fully
on-chain image fits Base's gas and size budget before anything else is built.

## Layout

    contracts/   Foundry project: renderers, spike ERC-721, tests
    tools/       Node ESM helpers: heart geometry, QR bitmaps, output verifiers
    docs/        Spec, plans, comparable-projects study, Phase 0 results

## Run

    export PATH=$HOME/.foundry/bin:$PATH; source ~/.nvm/nvm.sh

    cd contracts && forge test -vv && forge build --sizes
    cd ../tools && npm test

## Configuration

Copy `contracts/.env.example` to `contracts/.env` and fill in the real values,
then `chmod 600` it. It is never committed.

## Documents

- Spec: `docs/specs/2026-08-27-machine-readable-only-design.md`
- Phase 0 plan: `docs/plans/2026-08-27-mro-phase0-rendering-spike.md`
- Comparable projects: `docs/2026-08-27-mro-comparable-projects.md`
