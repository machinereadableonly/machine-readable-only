// The year's own chain adapter: the reads the checker needs and the sends the
// runner makes, none of which pass through the Warden.
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MRO_ABI } from "../../src/clock/abi.mjs";

/// Base Sepolia only. The run deploys a 5-minute-day contract; mainnet days are
/// permanent and nothing here may reach one.
export const CHAIN_ID = 84532;

/// Circle's published USDC on Base Sepolia: public, and fixed by the chain.
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const USDC_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/**
 * One token view, as the runner and checker read it.
 *
 * `bestRun` is the contract's `_effectiveRun`: the longest run ever completed,
 * which is what a Mark gate is measured against. TokenView carries no
 * `bestRun`, only the run that MOST RECENTLY fell, so this is a lower bound --
 * a token whose second lapse ended a shorter run reads low, and a Mark it has
 * earned looks not yet due rather than falsely due.
 */
export function decodeView(v) {
  const marks = BigInt(v.marks);
  return {
    level: Number(v.level),
    streak: Number(v.streak),
    lastDay: Number(v.lastDay),
    mintDay: Number(v.mintDay),
    generation: Number(v.generation),
    parent: Number(v.parent),
    echo: Number(v.echo),
    resting: v.resting,
    marks,
    bestRun: Math.max(Number(v.streak), Number(v.fellRun)),
    // Bits 64-95. Bits 32-63 hold the earned Iris's run.
    finisherPlace: Number((marks >> 64n) & 0xffffffffn),
  };
}

/**
 * Build the adapter.
 *
 * `publicClient` and `walletClient` are injectable so every call shape here can
 * be driven without a node or a key.
 */
export function makeChain({ rpcUrl, contract, chainId = CHAIN_ID, publicClient, walletClient }) {
  if (chainId !== CHAIN_ID) {
    throw new Error(`the accelerated year runs on Base Sepolia (${CHAIN_ID}) only, not ${chainId}`);
  }
  const pub = publicClient ?? createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletFor = (fromKey) =>
    walletClient ??
    createWalletClient({ account: privateKeyToAccount(fromKey), chain: baseSepolia, transport: http(rpcUrl) });

  /// viem RESOLVES a reverted transaction, so nothing is a send until the
  /// receipt says success.
  async function confirm(hash) {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted (status ${receipt.status})`);
    return receipt;
  }

  const read = (functionName, args) => pub.readContract({ address: contract, abi: MRO_ABI, functionName, args });

  return {
    viewOf: async (id) => decodeView(await read("viewOf", [BigInt(id)])),
    today: async () => Number(await read("today", [])),
    seedsAvailable: async (parentId) => Number(await read("seedsAvailable", [BigInt(parentId)])),

    usdcBalance: async (address) =>
      BigInt(await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [address] })),

    sendUsdc: async (fromKey, to, amount) =>
      confirm(await walletFor(fromKey).writeContract({
        address: USDC, abi: USDC_ABI, functionName: "transfer", args: [to, BigInt(amount)],
      })),

    sendEth: async (fromKey, to, wei) =>
      confirm(await walletFor(fromKey).sendTransaction({ to, value: BigInt(wei) })),

    /// The call a `rebind` or `rest` tool answered with, sent by the wallet the
    /// tool said must send it.
    ownerCall: async (fromKey, { function: functionName, args }) =>
      confirm(await walletFor(fromKey).writeContract({ address: contract, abi: MRO_ABI, functionName, args })),

    transfer: async (fromKey, from, to, id) =>
      confirm(await walletFor(fromKey).writeContract({
        address: contract, abi: MRO_ABI, functionName: "safeTransferFrom", args: [from, to, BigInt(id)],
      })),
  };
}
