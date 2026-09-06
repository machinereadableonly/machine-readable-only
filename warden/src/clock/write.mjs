// The Clock's chain writer. THE ONLY MODULE IN THIS REPOSITORY THAT SIGNS.
//
// The Warden process must never import this file. It is not a style rule: the
// Warden is internet-facing through nginx, and any bug that dumps process.env
// or a module's state would hand out the key that can mint. main.mjs deletes
// CLOCK_PRIVATE_KEY from its own environment at startup for the same reason.
//
// Four behaviours here are load-bearing, and each is a mistake this project has
// already paid for somewhere:
//
//   1. THE GAS GUARD RUNS FIRST. Above the cap, nothing is sent at all. Pending
//      rows keep their own day numbers, so levels and streaks come out
//      identical whenever the write eventually lands -- waiting costs nothing
//      but a day's latency.
//   2. GAS IS ESTIMATED SEPARATELY FROM THE SIMULATION. simulateContract's
//      `request` carries NO gas field (measured 2026-08-31, it is `undefined`),
//      so the spec's "assert estimateGas below 15M" reads as `undefined < 15M`
//      -- which is false, and would have silently disabled the assertion.
//   3. receipt.status === "success" OR IT DID NOT HAPPEN. viem RESOLVES on a
//      reverted transaction rather than throwing. A row marked `written`
//      because a promise resolved is a lie, and it is unrecoverable: the row
//      is never retried and that day is lost from the token's record forever.
//   4. NONCES ARE EXPLICIT. A batch is a sequence of sends; letting the node
//      assign nonces lets two in-flight transactions reorder, and `mint` before
//      `batchCheckIn` is not the same as the reverse when the check-in is for
//      the token being minted.
import { createPublicClient, createWalletClient, http, parseGwei, formatGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { MRO_ABI } from "./abi.mjs";
import { safeErrorText } from "./redact.mjs";

/// Base's per-transaction gas cap is 16,777,216 (EIP-7825). The spec asserts
/// below 15M, leaving room for the estimate to be optimistic.
export const MAX_TX_GAS = 15_000_000n;

/// The chains this piece can run on, by id. Not a lookup that falls back to a
/// default: an unknown chain id must stop the Clock, because signing against
/// the wrong chain's parameters is how a transaction lands somewhere it was
/// never meant to.
const CHAINS = { 84532: baseSepolia, 8453: base };

export function chainFor(chainId) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`unsupported chain id ${chainId}: expected 84532 (Base Sepolia) or 8453 (Base)`);
  return chain;
}

/**
 * Build the writer.
 *
 * `publicClient` and `walletClient` are injectable so the whole of this module
 * can be driven in tests without a node, a key, or a network.
 */
export function makeWriter({
  rpcUrl,
  contract,
  chainId,
  privateKey,
  maxGasGwei = "0.05",
  publicClient,
  walletClient,
  log = console.log,
}) {
  const chain = chainFor(chainId);
  const account = walletClient?.account ?? privateKeyToAccount(privateKey);
  const pub = publicClient ?? createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet =
    walletClient ?? createWalletClient({ account, chain, transport: http(rpcUrl) });
  const maxGasWei = parseGwei(String(maxGasGwei));

  // The nonce this process believes it is on. Read once per run from the chain
  // and then incremented locally: asking the node between sends returns the
  // pre-transaction value until the previous one is mined, which hands two
  // sends the same nonce and silently drops one.
  let nonce = null;

  async function startRun() {
    nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    return nonce;
  }

  /**
   * Is gas cheap enough to write today?
   *
   * Returns `{ ok, gasPrice, capWei }`. The caller stops the whole run on a
   * false rather than skipping individual writes: a run that wrote the mints
   * and abandoned the check-ins would leave the mirror half-applied.
   */
  async function gasOk() {
    const gasPrice = await pub.getGasPrice();
    return { ok: gasPrice <= maxGasWei, gasPrice, capWei: maxGasWei };
  }

  /**
   * Simulate, estimate, send, and confirm ONE call.
   *
   * Never throws for an on-chain reason. Returns a structured result so the
   * caller can decide -- a thrown error here would be indistinguishable from a
   * bug, and the difference between "the chain refused this entry" and "the
   * Clock is broken" decides whether a row is retried or a human is paged.
   *
   *   { ok: true,  hash, receipt, gasUsed }
   *   { ok: false, reason: "reverted-on-simulate", errorName, detail }
   *   { ok: false, reason: "gas-estimate-too-large", gas }
   *   { ok: false, reason: "reverted-on-chain", hash, receipt }
   *   { ok: false, reason: "send-failed", detail }
   */
  async function send(functionName, args, { label = functionName } = {}) {
    if (nonce === null) {
      throw new Error("startRun() must be called before send(): the nonce is unknown");
    }

    // A simulation that reverts names the contract's own custom error, which is
    // what makes the re-chunk rule implementable rather than a bisect.
    try {
      await pub.simulateContract({ address: contract, abi: MRO_ABI, functionName, args, account });
    } catch (err) {
      const decoded = decodeContractError(err);
      return {
        ok: false,
        reason: "reverted-on-simulate",
        errorName: decoded?.name ?? null,
        errorArgs: decoded?.args ?? [],
        detail: shortMessage(err),
      };
    }

    // SEPARATELY, because the simulate result has no gas on it.
    let gas;
    try {
      gas = await pub.estimateContractGas({ address: contract, abi: MRO_ABI, functionName, args, account });
    } catch (err) {
      return { ok: false, reason: "gas-estimate-failed", detail: shortMessage(err) };
    }
    if (gas > MAX_TX_GAS) {
      return { ok: false, reason: "gas-estimate-too-large", gas };
    }

    // 4.L2. HEADROOM ON THE ESTIMATE, because the estimate is made against a
    // state that is one block old and the transaction executes against a newer
    // one. An under-estimate is not a retry: it runs out of gas ON CHAIN, which
    // arrives as `reverted-on-chain`, which aborts the whole run -- so a few
    // thousand gas of drift costs the fee, the nonce, and every remaining
    // check-in chunk, every Mark and (until 4.L9) the reconcile for that night.
    //
    // Twelve and a half percent is geth's own bump unit for a replacement
    // transaction, which is the closest thing to a convention here. The cap is
    // applied to the PADDED figure so MAX_TX_GAS still means what it says.
    const padded = (gas * 1125n) / 1000n;
    if (padded > MAX_TX_GAS) {
      return { ok: false, reason: "gas-estimate-too-large", gas: padded };
    }
    gas = padded;

    let hash;
    try {
      hash = await wallet.writeContract({
        address: contract,
        abi: MRO_ABI,
        functionName,
        args,
        account,
        chain,
        gas,
        nonce,
      });
    } catch (err) {
      // The nonce was NOT consumed by a send that never happened, so it is not
      // advanced here. Advancing it would leave a permanent gap and every later
      // transaction in this run would sit unmined.
      return { ok: false, reason: "send-failed", detail: shortMessage(err) };
    }
    nonce += 1;

    // THE ONE CALL IN THIS FUNCTION THAT USED TO BE UNWRAPPED, and the gap it
    // left was not small. A transport error, a WaitForTransactionReceiptTimeout,
    // or the systemd unit's TimeoutStartSec firing all leave the transaction IN
    // THE MEMPOOL and abandon the run -- the write lands, the mirror never
    // learns, and every later night rebuilds the same doomed chunk.
    //
    // "Unknown" is a THIRD outcome, not a failure. A failed send can be retried;
    // this cannot, because the transaction may yet mine and a retry would send
    // it twice. So it is named distinctly, the hash is handed back so a human
    // can look it up, and recovery is left to the next run reading the chain's
    // own state (see healDayNotAdvanced in batch.mjs).
    let receipt;
    try {
      receipt = await pub.waitForTransactionReceipt({ hash });
    } catch (err) {
      log(`clock: ${label} was BROADCAST but its receipt never arrived, tx ${hash} -- fate unknown`);
      return { ok: false, reason: "receipt-unknown", hash, detail: shortMessage(err) };
    }
    if (receipt.status !== "success") {
      // viem RESOLVES here rather than throwing. Without this check the caller
      // would mark the row written on a transaction that reverted.
      log(`clock: ${label} REVERTED on chain, tx ${hash}`);
      return { ok: false, reason: "reverted-on-chain", hash, receipt };
    }

    log(`clock: ${label} ok, tx ${hash}, gas ${receipt.gasUsed}`);
    return { ok: true, hash, receipt, gasUsed: receipt.gasUsed };
  }

  return {
    address: account.address,
    chain,
    contract,
    startRun,
    gasOk,
    send,
    /// Exposed for the run summary and for tests; never used to make decisions.
    get nonce() {
      return nonce;
    },
    formatGas: (wei) => `${formatGwei(wei)} gwei`,
  };
}

/**
 * The contract's custom error name out of a viem error, or null.
 *
 * viem nests the decoded error; `walk` finds it wherever it sits, which is more
 * robust than reaching into a fixed property path that changes between minor
 * versions. Measured shape on viem 2.56.0: the cause carries `data.errorName`
 * for a decoded custom error.
 */
export function decodeContractError(err) {
  let node = err;
  const seen = new Set();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if (typeof node.data?.errorName === "string") {
      // THE ARGUMENTS COME THROUGH TOO, and they are what makes the re-chunk
      // rule precise instead of a bisect. Verified against the deployed
      // contract on 2026-08-31 with a deliberately mixed chunk: one live token
      // and one that does not exist returned
      //   { errorName: "NoSuchToken", args: ["4242"] }
      // naming the exact offending id.
      return { name: node.data.errorName, args: (node.data.args ?? []).map(String) };
    }
    if (typeof node.errorName === "string") {
      return { name: node.errorName, args: (node.args ?? []).map(String) };
    }
    node = node.cause;
  }
  // The decoded name also appears in the human-readable metaMessages, as
  // "Error: FutureDay(uint32 day)". That is the form actually observed against
  // the deployed contract, so it is a real fallback rather than a defensive
  // one.
  const meta = Array.isArray(err?.metaMessages) ? err.metaMessages.join(" ") : "";
  const match = /Error:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(meta);
  return match ? { name: match[1], args: [] } : null;
}

/// Just the name, for logging and for callers that do not need the arguments.
export function errorNameOf(err) {
  return decodeContractError(err)?.name ?? null;
}

// 16.10. `detail` is not logged anywhere today -- run.mjs prints `reason` and
// `errorName` only -- so this was never the leak the finding said it was. It is
// routed through safeErrorText anyway, because the thing that made the leak
// possible is a url reaching a string that something later prints, and the next
// caller to log a `detail` should not have to know that.
function shortMessage(err) {
  return safeErrorText(err);
}
