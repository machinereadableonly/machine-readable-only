#!/usr/bin/env node
// Prepare one owner action for the Safe: a Transaction Builder file to import
// at app.safe.global, and the hashes each signing device must show.
//
//   node tools/safe-tx.mjs <action> [argument] --contract <token> --safe <safe> --rpc <url>
//
// Actions: accept-ownership, set-warden <address>, set-renderer <address>,
// set-supply-cap <n>, pause, unpause. Nothing is signed or sent here.
// The file goes to MRO_SAFE_TX_OUT, default mro-safe-tx in the home directory.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http } from "viem";

import { MRO_ABI } from "../src/clock/abi.mjs";
import { eip55, prepare } from "./safe-tx-lib.mjs";
import { safeErrorText } from "../src/clock/redact.mjs";

const SAFE_ABI = [
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getTransactionHash", stateMutability: "view",
    inputs: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
      { name: "_nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
];
const ZERO = "0x0000000000000000000000000000000000000000";

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[(i += 1)];
    else rest.push(argv[i]);
  }
  for (const f of ["contract", "safe", "rpc"]) {
    if (!flags[f]) throw new Error(`--${f} is required. Usage: safe-tx.mjs <action> [argument] --contract <token> --safe <safe> --rpc <url>`);
  }
  for (const f of ["contract", "safe"]) {
    try {
      eip55(flags[f]);
    } catch (err) {
      throw new Error(`--${f}: ${err.message}`);
    }
  }
  const [action, ...args] = rest;
  if (!action) throw new Error("name an action: accept-ownership, set-warden, set-renderer, set-supply-cap, pause, unpause");
  return { action, args, ...flags };
}

function liveReader({ rpc, contract, safe }) {
  const client = createPublicClient({ transport: http(rpc) });
  const onSafe = (functionName, args = []) => client.readContract({ address: safe, abi: SAFE_ABI, functionName, args });
  const onToken = (functionName) => client.readContract({ address: contract, abi: MRO_ABI, functionName });
  return {
    chainId: () => client.getChainId(),
    version: () => onSafe("VERSION"),
    threshold: () => onSafe("getThreshold"),
    owners: () => onSafe("getOwners"),
    nonce: () => onSafe("nonce"),
    owner: () => onToken("owner"),
    warden: () => onToken("warden"),
    pendingOwner: () => onToken("pendingOwner"),
    simulate: ({ to, data }) => client.call({ account: safe, to, data }),
    safeHash: ({ to, data, nonce }) => onSafe("getTransactionHash", [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce]),
  };
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const r = await prepare({ reader: liveReader(opts), ...opts });

  const dir = process.env.MRO_SAFE_TX_OUT || join(homedir(), "mro-safe-tx");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${r.chainId}-${opts.action}-nonce${r.nonce}.json`);
  writeFileSync(path, JSON.stringify(r.file, null, 2) + "\n");

  console.log(`chain       ${r.chainId}`);
  console.log(`safe        ${opts.safe}  (version ${r.version}, ${r.threshold} of ${r.owners.length})`);
  console.log(`action      ${r.file.meta.name}`);
  console.log(`to          ${opts.contract}`);
  console.log(`nonce       ${r.nonce}`);
  console.log(`file        ${path}`);
  console.log("");
  console.log("Sign ONLY if the device shows exactly these. The Safe's own contract agrees with them.");
  console.log(`  Trezor     safeTxHash   ${r.hashes.safeTxHash}`);
  console.log(`  Ledger     domain hash  ${r.hashes.domainHash}`);
  console.log(`             message hash ${r.hashes.messageHash}`);
  console.log("");
  console.log(`The hashes are for nonce ${r.nonce}, the Safe's next on chain. If the website proposes a`);
  console.log(`higher one, something is queued: reject or execute it first, or set the nonce to ${r.nonce}`);
  console.log("under the transaction's advanced parameters before signing.");
}

main().catch((err) => {
  console.error(`safe-tx: ${safeErrorText(err)}`);
  process.exitCode = 1;
});
