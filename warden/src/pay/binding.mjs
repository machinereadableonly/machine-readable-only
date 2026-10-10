// The payment binding (D17): an EIP-3009 nonce that commits to who is paying
// for what, so an authorisation seen in transit cannot buy a stranger's call.
//
//   nonce = keccak256(utf8("mro-pay-v1|" + keyId + "|" + tool + "|" + canonical(args) + "|" + salt))
//
// keyId is the caller's RFC 7638 thumbprint, tool the tool's name, args the
// arguments object exactly as sent, salt 32 random bytes as 0x-hex, carried in
// `_meta["mro/pay-salt"]`. client/src/binding.mjs is the same function.
import { keccak256, stringToBytes } from "viem";

export const PAY_SALT_META = "mro/pay-salt";
const SALT = /^0x[0-9a-f]{64}$/;

/// JSON with every object's keys sorted and no whitespace.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function bindingNonce({ keyId, tool, args, salt }) {
  return keccak256(stringToBytes(`mro-pay-v1|${keyId}|${tool}|${canonicalJson(args ?? {})}|${salt}`));
}

/// Null when `nonce` is the binding of this call, else why not.
export function bindingProblem({ nonce, keyId, tool, args, meta }) {
  const salt = meta?.[PAY_SALT_META];
  if (typeof salt !== "string" || !SALT.test(salt)) return `no ${PAY_SALT_META} in _meta, as 0x and 64 lower-case hex digits`;
  if (typeof nonce !== "string" || nonce.toLowerCase() !== bindingNonce({ keyId, tool, args, salt })) {
    return "the authorisation's nonce is not keccak256 of this key, tool, arguments and salt";
  }
  return null;
}
