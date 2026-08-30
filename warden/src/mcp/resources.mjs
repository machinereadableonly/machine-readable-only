// The three read-only resources.
//
// List and read results carry ttlMs and cacheScope, which this revision
// requires. The tool list never changes between calls, so a long TTL is honest.
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { tokenView } from "./tokenView.mjs";

export function registerResources(server, { q, contract, chainId, llmsTxt }) {
  server.registerResource("llms.txt", "mro://llms.txt", { title: "What this piece is", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: llmsTxt }] }));

  // The chain id comes from configuration alongside the address, never as a
  // literal. Hardcoded 8453 sat beside an address read from the environment,
  // so a Warden pointed at a Base Sepolia deployment published a mainnet chain
  // id with a testnet address -- a pair that cannot both be right.
  server.registerResource("contract", "mro://contract", { title: "The contract", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, text: JSON.stringify({ address: contract, chainId }) }] }));

  // The `list` callback is required to be specified, even as `undefined` --
  // the SDK's own words for it -- so a caller cannot forget resource listing
  // by accident. This template has nothing to enumerate: a token is looked
  // up by id, not listed.
  server.registerResource("token", new ResourceTemplate("mro://token/{id}", { list: undefined }), { title: "One token", mimeType: "application/json" },
    async (uri, { id }) => {
      const view = tokenView(q, Number(id));
      return { contents: [{ uri: uri.href, text: JSON.stringify(view ?? { ok: false, reason: "unknown-token" }) }] };
    });
}
