// Read-only chain access. There is no signer here and no private key in this
// process: every write belongs to the Clock (Plan 3).
//
// One JSON-RPC eth_call, hand-composed, because pulling a whole client library
// in for a single view function would be the larger dependency.

/// viewOf(uint256), selector 0x0fa4edbd. Read off the deployed ABI at build
/// time in Task 6:
///   cd contracts && forge inspect MachineReadableOnly abi | grep -i viewOf
/// There is no single-field "agentKeyOf" accessor on the contract -- the only
/// view that exposes a token's bound agent key is viewOf, which returns it as
/// one field of the TokenView struct (src/render/TokenView.sol). That struct
/// ends in a dynamic `bytes code` field, so the whole return is ABI-encoded as
/// a dynamic tuple: a leading 32-byte offset word, then the tuple's static
/// fields in order, then the dynamic field's bytes. agentKeyId is the 12th
/// field (index 11) of that tuple, counting from tokenId:
///   tokenId, level, streak, lastDay, mintDay, generation, seedsGiven,
///   parent, resting, sunset, marks, agentKeyId, code, today
const SELECTOR = "0x0fa4edbd";
const AGENT_KEY_ID_FIELD_INDEX = 11;
const WORD_HEX_CHARS = 64; // 32 bytes, as hex

/**
 * Pick the `agentKeyId` field out of a `viewOf` return.
 *
 * `hex` is the full `eth_call` result, "0x" + the ABI-encoded return data.
 * Returns null if the data is too short to contain the field -- this is
 * distinct from "not bound"; the caller in boundKeyOf() below treats any null
 * the same way, as "could not be read".
 */
function decodeAgentKeyId(hex) {
  const data = hex.slice(2);
  const offsetWord = data.slice(0, WORD_HEX_CHARS);
  if (offsetWord.length !== WORD_HEX_CHARS) return null;
  const offsetBytes = parseInt(offsetWord, 16);
  if (!Number.isFinite(offsetBytes)) return null;
  const start = offsetBytes * 2 + AGENT_KEY_ID_FIELD_INDEX * WORD_HEX_CHARS;
  const field = data.slice(start, start + WORD_HEX_CHARS);
  if (field.length !== WORD_HEX_CHARS) return null;
  return "0x" + field;
}

export function makeChainReader({ rpcUrl, contract, fetchImpl = fetch }) {
  return {
    /**
     * The key id currently bound to a token, straight from the chain.
     *
     * Returns the 32-byte value as a lowercase hex string, or null if the call
     * fails or the response cannot be decoded. A failure is NOT treated as
     * "not bound": the caller refuses on null rather than admitting on it.
     */
    async boundKeyOf(tokenId) {
      const data = SELECTOR + BigInt(tokenId).toString(16).padStart(64, "0");
      let res;
      try {
        res = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: contract, data }, "latest"],
          }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      const body = await res.json();
      // A JSON-RPC error is an object on the response, not a thrown exception.
      // Checking it is the difference between "not bound" and "we could not ask".
      if (body.error || typeof body.result !== "string") return null;
      const agentKeyId = decodeAgentKeyId(body.result);
      return agentKeyId ? agentKeyId.toLowerCase() : null;
    },
  };
}
