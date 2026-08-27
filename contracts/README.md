# MRO Contracts

Foundry project for Machine Readable Only: the on-chain renderers and the
Phase 0 spike ERC-721.

    export PATH=$HOME/.foundry/bin:$PATH
    forge test -vv
    forge build --sizes

Solidity 0.8.35, EVM cancun, optimizer on (200 runs). Libraries are vendored
under `lib/` at pinned tags: OpenZeppelin v5.7.0, Solady v0.1.26.

Configuration is read from a local secrets file; copy `.env.example`, fill in
the real values and `chmod 600` it. It is never committed.
