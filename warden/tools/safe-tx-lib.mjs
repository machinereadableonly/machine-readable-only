// One owner action as one Safe transaction. The CLI is safe-tx.mjs; this file
// holds everything it decides, so the tests can reach it without a chain.
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, toHex, concat } from "viem";

import { MRO_ABI } from "../src/clock/abi.mjs";
import { safeErrorText } from "../src/clock/redact.mjs";

// Safe 1.4.1 and 1.5.0 share both, byte for byte (contracts/Safe.sol).
export const DOMAIN_TYPEHASH = "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
export const SAFE_TX_TYPEHASH = "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";

const ZERO = "0x0000000000000000000000000000000000000000";
const CHAINS = new Set([8453, 84532]);
// The versions whose type hashes above were read from source.
const SAFE_VERSIONS = new Set(["1.4.1", "1.5.0"]);

export const eip55 = (value) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || getAddress(value) !== value) {
    throw new Error(`${value} is not an EIP-55 checksummed address`);
  }
  return value;
};

const supplyCap = (value) => {
  if (!/^\d+$/.test(String(value)) || Number(value) > 65_535) {
    throw new Error(`supply cap ${value} is not a whole number from 0 to 65535`);
  }
  return Number(value);
};

export const ACTIONS = {
  "accept-ownership": { fn: "acceptOwnership", parse: [] },
  "set-warden": { fn: "setWarden", parse: [eip55] },
  "set-renderer": { fn: "setRenderer", parse: [eip55] },
  "set-supply-cap": { fn: "setSupplyCap", parse: [supplyCap] },
  pause: { fn: "pause", parse: [] },
  unpause: { fn: "unpause", parse: [] },
};

export function encodeAction(action, args) {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`unknown action ${action}; one of: ${Object.keys(ACTIONS).join(", ")}`);
  const n = spec.parse.length;
  if (args.length !== n) throw new Error(`${action} takes ${n} argument${n === 1 ? "" : "s"}`);
  return encodeFunctionData({ abi: MRO_ABI, functionName: spec.fn, args: spec.parse.map((p, i) => p(args[i])) });
}

/**
 * The three hashes a signer can be shown for a plain CALL from the Safe with
 * no value and no gas refund: a Trezor shows `safeTxHash`; a Ledger that
 * blind-signs shows `domainHash` and `messageHash`.
 */
export function safeTxHashes({ chainId, safe, to, data, nonce }) {
  const domainHash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [DOMAIN_TYPEHASH, BigInt(chainId), safe],
  ));
  const messageHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint8" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" },
      { type: "uint256" },
    ],
    [SAFE_TX_TYPEHASH, to, 0n, keccak256(data), 0, 0n, 0n, 0n, ZERO, ZERO, BigInt(nonce)],
  ));
  const safeTxHash = keccak256(concat(["0x1901", domainHash, messageHash]));
  return { domainHash, messageHash, safeTxHash };
}

// The Transaction Builder's own serialisation (tx-builder src/lib/checksum.ts):
// sorted keys, then each value, undefined as null.
function serialize(json) {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json).sort();
    return `{${JSON.stringify(keys)}${keys.map((k) => `${serialize(json[k])},`).join("")}}`;
  }
  return JSON.stringify(json === undefined ? null : json);
}

/// The Transaction Builder's `calculateChecksum`. Without a matching checksum
/// it warns on import that the file was modified.
export function txBuilderChecksum(file) {
  return keccak256(toHex(serialize({ ...file, meta: { ...file.meta, name: null } })));
}

/// A Transaction Builder file with ONE call: two or more would be wrapped in a
/// MultiSend delegatecall, and the hash above would describe nothing.
export function batchFile({ chainId, safe, to, data, name }) {
  const file = {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name, description: `Machine Readable Only: ${name}`, createdFromSafeAddress: safe },
    transactions: [{ to, value: "0", data }],
  };
  file.meta.checksum = txBuilderChecksum(file);
  return file;
}

/**
 * Check the chain, then build the file and the hashes. `reader` is the chain
 * as the tool sees it; see safe-tx.mjs for the live one.
 */
export async function prepare({ reader, action, args, contract, safe }) {
  const data = encodeAction(action, args);
  const chainId = Number(await reader.chainId());
  if (!CHAINS.has(chainId)) throw new Error(`chain ${chainId} is neither Base (8453) nor Base Sepolia (84532)`);

  let version;
  try {
    version = await reader.version();
  } catch {
    throw new Error(`${safe} does not answer VERSION(), so it is not a Safe`);
  }
  if (!SAFE_VERSIONS.has(version)) throw new Error(`Safe version ${version} is not one whose hash this tool was checked against`);

  const threshold = await reader.threshold();
  if (threshold < 2n) throw new Error(`the Safe has threshold ${threshold}: one signer could act alone`);
  const owners = (await reader.owners()).map((a) => getAddress(a));
  const warden = getAddress(await reader.warden());
  if (owners.includes(warden)) throw new Error(`the Clock key ${warden} is one of the Safe's signers`);
  if (action === "set-warden") {
    const next = getAddress(args[0]);
    if (next === getAddress(safe) || owners.includes(next)) {
      throw new Error(`${next} is the Safe or one of its signers; the Clock key must be separate`);
    }
  }

  if (action === "accept-ownership") {
    const pending = await reader.pendingOwner();
    if (getAddress(pending) !== getAddress(safe)) throw new Error(`the Safe is not the pending owner (${pending} is)`);
  } else {
    const owner = await reader.owner();
    if (getAddress(owner) !== getAddress(safe)) throw new Error(`the Safe is not the owner (${owner} is)`);
  }

  try {
    await reader.simulate({ to: contract, data });
  } catch (err) {
    throw new Error(`${action} would revert if the Safe sent it now: ${safeErrorText(err)}`);
  }

  const nonce = await reader.nonce();
  const hashes = safeTxHashes({ chainId, safe, to: contract, data, nonce });
  const onChain = await reader.safeHash({ to: contract, data, nonce });
  if (onChain !== hashes.safeTxHash) {
    throw new Error(`the local hash ${hashes.safeTxHash} does not match the Safe's own ${onChain}`);
  }
  return {
    chainId, version, nonce, threshold, owners, hashes,
    file: batchFile({ chainId, safe, to: contract, data, name: [action, ...args].join(" ") }),
  };
}
