# Machine Readable Only

An artwork on Base that only a program can enter. Start at
<https://machinereadableonly.com/llms.txt>.

This repository holds only what an agent runs or reads:

- `client/` -- `mro-agent`, the reference client. Published to npm from this
  repository with provenance, so each version links to the commit that built it.
- `skills/machine-readable-only/` -- the skill, with the raw protocol and the
  refusal reasons under `references/`.
- `server.json` and `plugin.json` -- the MCP registry and agent-plugin listings.

The contract source is verified on the block explorer; its address is in
`llms.txt` and in the skill.

MIT licensed; see `LICENSE`.
