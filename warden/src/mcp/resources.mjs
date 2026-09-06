// The three read-only resources.
//
// List and read results carry ttlMs and cacheScope, which this revision
// requires. The tool list never changes between calls, so a long TTL is honest.
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { tokenView, tokenLinks } from "./tokenView.mjs";
import { MRO_ABI } from "../clock/abi.mjs";
import { LADDER } from "./ladder.mjs";

export function registerResources(server, { q, contract, chainId, llmsTxt, domain, catalogue = LADDER }) {
  const links = tokenLinks({ domain, contract, chainId });
  server.registerResource("llms.txt", "mro://llms.txt", { title: "What this piece is", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: llmsTxt }] }));

  // The chain id comes from configuration alongside the address, never as a
  // literal. Hardcoded 8453 sat beside an address read from the environment,
  // so a Warden pointed at a Base Sepolia deployment published a mainnet chain
  // id with a testnet address -- a pair that cannot both be right.
  //
  // 5.L3. IT PUBLISHED TWO FIELDS AND THE SPEC PROMISES FIVE. The two that
  // matter are here now:
  //
  //   `abi` is what makes "read the chain instead of asking us" possible from
  //   one source. It is the SAME generated ABI the Clock encodes its own calls
  //   with -- a second, hand-kept copy would be one more thing to drift.
  //   `catalogue` is the only machine-readable statement of what the Marks cost
  //   that does not need a token id, and it is hash-checked against Ladder.sol.
  //
  // The RENDERER ADDRESS is deliberately NOT published here, which narrows the
  // spec rather than satisfying it. `setRenderer` is an owner dial and the
  // renderer is designed to be swapped, so an address copied into a cached
  // resource is a staleness trap: `renderer()` on the contract is one call away
  // and always right. Said here so the omission is a decision rather than a gap.
  server.registerResource("contract", "mro://contract", { title: "The contract", mimeType: "application/json" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          address: contract,
          chainId,
          abi: MRO_ABI,
          catalogue,
          rendererIsReadOnChain: "call renderer() on the address above; it is swappable, so this service does not cache it",
        }),
      }],
    }));

  // The `list` callback is required to be specified, even as `undefined` --
  // the SDK's own words for it -- so a caller cannot forget resource listing
  // by accident. This template has nothing to enumerate: a token is looked
  // up by id, not listed.
  server.registerResource("token", new ResourceTemplate("mro://token/{id}", { list: undefined }), { title: "One token", mimeType: "application/json" },
    async (uri, { id }) => {
      const view = tokenView(q, Number(id), links);
      return { contents: [{ uri: uri.href, text: JSON.stringify(view ?? { ok: false, reason: "unknown-token" }) }] };
    });
}
