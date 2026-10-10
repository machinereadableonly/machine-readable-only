// The payment binding: the EIP-3009 nonce commits to who is paying for what,
// so an authorisation seen in transit cannot buy a stranger's call.
//
//   nonce = keccak256(utf8("mro-pay-v1|" + keyId + "|" + tool + "|" + canonical(args) + "|" + salt))
//
// The site's warden/src/pay/binding.mjs is the same function; a shared vector
// in test/binding.test.mjs keeps them equal.
import { randomBytes } from "node:crypto";
import { keccak256, stringToBytes } from "viem";

export const PAY_SALT_META = "mro/pay-salt";

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

/// A fresh salt, and the nonce it binds this call to.
export function bindPayment({ keyId, tool, args }) {
  const salt = `0x${randomBytes(32).toString("hex")}`;
  return { salt, nonce: bindingNonce({ keyId, tool, args, salt }) };
}
