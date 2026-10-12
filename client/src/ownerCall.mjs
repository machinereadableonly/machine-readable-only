import { createHash } from "node:crypto";

/// Refuse an owner call that is not exactly the one asked for: the server
/// builds it, and the owner's wallet sends it.
export function assertOwnerCall(result, { command, tokenId, contract, keyId }) {
  const fail = (why) => { throw new Error(`refusing the ${command} call the site returned: ${why}`); };
  if (String(result.contract).toLowerCase() !== String(contract).toLowerCase()) {
    fail(`contract is ${result.contract}, expected ${contract}`);
  }
  if (result.function !== command) fail(`function is ${result.function}`);
  // Anything beyond these could be acted on by a wallet tool -- a `value`, raw
  // `data`, another `to` -- and none of it is part of this call.
  const extra = Object.keys(result).filter((k) => !["ok", "contract", "function", "args", "irreversible"].includes(k));
  if (extra.length) fail(`unexpected field(s) ${extra.join(", ")}`);
  const want = command === "rebind" ? [tokenId, keyIdToBytes32(keyId)] : [tokenId];
  const got = result.args ?? [];
  if (!Array.isArray(got) || got.length !== want.length || got[0] !== tokenId) fail(`args are ${JSON.stringify(got)}`);
  if (command === "rebind" && String(got[1]).toLowerCase() !== want[1]) fail(`key is ${got[1]}, not this agent's`);
}

/// Check the value a `rebind` or `rest` tool returned, exactly as it will be
/// printed: the MCP result's structuredContent, or the raw result if it has
/// none. Only an explicit refusal carrying no call is let through unchecked.
export function checkOwnerResult(result, expected) {
  const value = result?.structuredContent ?? result;
  // A refusal passes unchecked only when it carries nothing an owner could send.
  const isRefusal = value?.ok === false && typeof value.reason === "string" &&
    Object.keys(value).every((k) => ["ok", "reason", "detail"].includes(k));
  if (isRefusal) return value;
  assertOwnerCall(value ?? {}, expected);
  return value;
}

/// The on-chain form of a key id, as the contract stores it.
export function keyIdToBytes32(keyId) {
  return "0x" + createHash("sha256").update(keyId, "utf8").digest("hex");
}
