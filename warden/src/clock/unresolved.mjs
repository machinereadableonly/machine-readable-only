/**
 * Resolving a settlement whose outcome was never learned.
 *
 * THE PROBLEM THIS ANSWERS. `@x402/mcp` reports a settlement that threw exactly
 * as it reports one the facilitator declined, and fires no hook for either. A
 * throw is also what a timeout or a dropped response looks like -- and by that
 * point the EIP-3009 transfer may already be mined. Reading both as failure
 * and deleting the reservation debits an agent up to $1,250.00 for nothing,
 * its authorisation spent, with one log line as the only trace.
 *
 * The gateway HOLDS such a row in 'payment-unresolved' instead, carrying
 * everything the chain has to be shown. This is the other half.
 *
 * WHY `authorizationState` IS NOT THE ORACLE. It was, and it was forgeable. An
 * EIP-3009 token sets that flag on ANY use of the nonce and on
 * `cancelAuthorization` as well, so a payer could cancel its own authorisation
 * -- or spend it on a dust transfer to itself -- between verification and
 * settlement, and read back as having paid. A free mint, or a free Mark worth
 * $1,250. The question the chain is asked now is the one with a single
 * answer: was there an `AuthorizationUsed(payer, nonce)`, and did the SAME
 * TRANSACTION carry a `Transfer` of the demanded amount to the treasury?
 * A cancellation, a different recipient or a different amount are all unpaid.
 *
 * WHY HERE AND NOT AT THE MOMENT OF FAILURE. A public RPC is not
 * read-after-write consistent -- a read issued straight after a transfer can
 * land on a node that has not imported it yet and answer "nothing here" about
 * money that has just moved. The Clock asks the next morning, and refuses to
 * release anything until chain time is past the authorisation's own deadline.
 *
 * NOTHING HERE GUESSES. A read that fails, or a row with nothing to ask the
 * chain with, is left exactly as it is and reported, which fails the run.
 */
import { safeErrorText } from "./redact.mjs";

/// The two EIP-3009 events, hand-written rather than imported: this is not our
/// contract, and the full USDC ABI would be several hundred entries to carry
/// two. Signatures are the ERC-3009 specification's own.
export const AUTHORIZATION_USED = {
  type: "event",
  name: "AuthorizationUsed",
  inputs: [
    { name: "authorizer", type: "address", indexed: true },
    { name: "nonce", type: "bytes32", indexed: true },
  ],
};

export const AUTHORIZATION_CANCELED = {
  type: "event",
  name: "AuthorizationCanceled",
  inputs: [
    { name: "authorizer", type: "address", indexed: true },
    { name: "nonce", type: "bytes32", indexed: true },
  ],
};

/// ERC-20's own, because the money is what is actually being checked.
export const TRANSFER = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

/// Base produces a block every two seconds, which is what turns the
/// authorisation's seconds-wide validity into a bounded span of blocks.
export const BLOCK_SECONDS = 2;

/// THE PUBLIC RPC'S eth_getLogs CAP, AND IT MOVES WITHOUT NOTICE. Measured at
/// 10,000 once and refused above 1,000 a month later, which killed three
/// nightly reconciles while every test passed. Pinned low on purpose.
export const MAX_LOG_SPAN = 1_000;

/// Slack either side of the estimated window, for a reservation made a moment
/// before the block it recorded and for a transfer mined a moment after the
/// deadline was checked.
export const SEARCH_MARGIN_BLOCKS = 60;

/// How long past the authorisation's own deadline the chain must be before
/// absence of a transfer is read as "no money moved". Under it, absence means
/// "not yet": the transfer can still land, and releasing the row is the loss.
export const RELEASE_MARGIN_SECONDS = 300;

/// A window wider than this is one nothing here will search. It is roughly
/// seven hours of Base, against an authorisation whose default life is five
/// minutes, so reaching it means the stored facts are wrong rather than the
/// window being genuinely large.
export const MAX_SEARCH_PAGES = 12;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * The blocks in which this authorisation's transfer could possibly sit.
 *
 * Bounded by the authorisation itself rather than by "since the reservation":
 * an EIP-3009 transfer is only valid before `validBefore`, so the search is a
 * few minutes of chain wherever that few minutes fell. Searching from the
 * reservation to the head instead would be a day of blocks and forty-three
 * refused requests.
 *
 * Returns null when the row does not carry enough to draw one.
 */
export function searchWindow(row, headBlock) {
  const at = Number(row.reservedBlock);
  if (!Number.isSafeInteger(at) || at <= 0) return null;
  const validBefore = Number(row.validBefore);
  const reservedAtSeconds = Math.floor(Number(row.reservedAt) / 1000);
  if (!Number.isSafeInteger(validBefore) || !Number.isSafeInteger(reservedAtSeconds)) return null;
  const lifeSeconds = validBefore - reservedAtSeconds;
  if (lifeSeconds < 0) return null;
  const from = Math.max(0, at - SEARCH_MARGIN_BLOCKS);
  const to = Math.min(headBlock, at + Math.ceil(lifeSeconds / BLOCK_SECONDS) + SEARCH_MARGIN_BLOCKS);
  if (to < from) return null;
  if (to - from > MAX_LOG_SPAN * MAX_SEARCH_PAGES) return null;
  return { from, to };
}

/// Every matching log in a window, asked for in spans the public node accepts.
async function logsIn(publicClient, params, { from, to }) {
  const found = [];
  for (let start = from; start <= to; start += MAX_LOG_SPAN) {
    const end = Math.min(to, start + MAX_LOG_SPAN - 1);
    found.push(
      ...(await publicClient.getLogs({ ...params, fromBlock: BigInt(start), toBlock: BigInt(end) }))
    );
  }
  return found;
}

/**
 * What the chain says about one held payment.
 *
 * `paid` and `unpaid` are both decisions. `defer` means the authorisation can
 * still be spent, so the question has no answer yet and the row waits for
 * tomorrow. `unknown` means it could not be asked at all, which is the only
 * outcome that needs a person.
 */
export async function paymentVerdict({ publicClient, row, head }) {
  if (!ADDRESS.test(row.payer ?? "") || !ADDRESS.test(row.asset ?? "") || !BYTES32.test(row.payNonce ?? "")) {
    return { kind: "unknown", why: `nothing to ask the chain with (payer ${row.payer ?? "none"}, asset ${row.asset ?? "none"})` };
  }
  if (!ADDRESS.test(row.payTo ?? "") || row.payAmount == null) {
    // Without the recipient and the amount the only available question is the
    // forgeable one. Refusing to ask it is the whole point of this rewrite.
    return { kind: "unknown", why: "the row predates the recipient and amount being stored, so only a forgeable question is available" };
  }
  const window = searchWindow(row, head.number);
  if (!window) return { kind: "unknown", why: "no bounded block window could be drawn from the stored reservation" };

  const filter = { address: row.asset, args: { authorizer: row.payer, nonce: row.payNonce } };
  const used = await logsIn(publicClient, { ...filter, event: AUTHORIZATION_USED }, window);
  if (used.length) {
    const amount = BigInt(row.payAmount);
    for (const u of used) {
      // THE SAME TRANSACTION, not merely the same block. Anyone can put a
      // transfer of the right amount in the block an unrelated authorisation
      // was spent in; only the settlement itself can put both in one
      // transaction.
      const transfers = await publicClient.getLogs({
        address: row.asset,
        event: TRANSFER,
        args: { from: row.payer, to: row.payTo },
        fromBlock: u.blockNumber,
        toBlock: u.blockNumber,
      });
      const paid = transfers.find(
        (t) => t.transactionHash === u.transactionHash && t.args?.value === amount
      );
      if (paid) return { kind: "paid", transaction: u.transactionHash };
    }
    return { kind: "unpaid", why: `the authorisation was spent, but on no transfer of ${row.payAmount} to ${row.payTo}` };
  }

  const canceled = await logsIn(publicClient, { ...filter, event: AUTHORIZATION_CANCELED }, window);
  if (canceled.length) return { kind: "unpaid", why: "the authorisation was cancelled" };

  // NOT SPENT IS NOT THE SAME AS NEVER SPENDABLE. Inside its validity window
  // the transfer can still be submitted, and a row released here is one an
  // agent then pays for and never receives.
  if (head.timestamp > Number(row.validBefore) + RELEASE_MARGIN_SECONDS) {
    return { kind: "unpaid", why: "the authorisation expired without ever being spent" };
  }
  return { kind: "defer", why: `the authorisation is valid until ${row.validBefore} and can still be spent` };
}

/**
 * Ask the chain about every held payment, and act on each answer.
 *
 * Returns `{ resolvedPaid, resolvedUnpaid, deferredPayments, unresolvedPayments }`,
 * all arrays of token ids. The last one is what a human still has to look at,
 * and it fails the run for as long as it is not empty. A deferred row does not:
 * it is simply younger than its own deadline, and tomorrow's run decides it.
 */
export async function resolveUnresolvedPayments({ q, publicClient, alert = console.error, log = console.log }) {
  const summary = { resolvedPaid: [], resolvedUnpaid: [], deferredPayments: [], unresolvedPayments: [] };
  const held = q.unresolvedPayments();
  if (!held.length) return summary;

  log(`clock: ${held.length} payment(s) held with an unknown outcome -- asking the chain`);

  let head;
  try {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    head = { number: Number(block.number), timestamp: Number(block.timestamp) };
  } catch (err) {
    // One failure, not one per row: without a head there is no window to
    // search and no chain time to compare a deadline against.
    for (const row of held) summary.unresolvedPayments.push(row.tokenId);
    alert(`clock: ${held.length} held payment(s) could not be resolved -- the chain has no head: ${safeErrorText(err)}`);
    return summary;
  }

  for (const row of held) {
    const what = `${row.kind} ${row.tokenId}`;

    let verdict;
    try {
      verdict = await paymentVerdict({ publicClient, row, head });
    } catch (err) {
      // The row stays exactly as it is. Tomorrow's run asks again, and until
      // one of them gets an answer this fails the run every night.
      summary.unresolvedPayments.push(row.tokenId);
      alert(`clock: ${what} could not be resolved -- the chain did not answer: ${safeErrorText(err)}`);
      continue;
    }

    if (verdict.kind === "unknown") {
      summary.unresolvedPayments.push(row.tokenId);
      alert(`clock: ${what} has an unknown payment outcome and ${verdict.why}. A human must check it.`);
      continue;
    }

    if (verdict.kind === "defer") {
      summary.deferredPayments.push(row.tokenId);
      log(`clock: ${what} is not decided yet -- ${verdict.why}; left held for the next run`);
      continue;
    }

    const paid = verdict.kind === "paid";
    const moved = q.resolveUnresolvedPayment(row.payNonce, { paid, paymentTx: verdict.transaction ?? null });
    if (!moved) {
      // Something changed the row between the read above and this write. That
      // is not an error -- a late settlement arriving is the good case -- but
      // it is worth saying so out loud, because the alternative reading is a
      // bug in this loop.
      log(`clock: ${what} was already resolved by something else; left alone`);
      continue;
    }

    if (paid) {
      summary.resolvedPaid.push(row.tokenId);
      // NOT A SILENT REPAIR. The agent was told its payment failed, and now it
      // is getting what it paid for, a day late.
      alert(
        `clock: ${what} WAS PAID FOR after all -- transfer ${verdict.transaction} spent authorisation ` +
          `${row.payNonce} from ${row.payer}. Queued for writing.`
      );
    } else {
      summary.resolvedUnpaid.push(row.tokenId);
      // AN ALERT, NOT A LOG LINE. Releasing a reservation is the action that
      // used to lose an agent's money, so every one of them is visible.
      alert(`clock: ${what} was not paid for -- ${verdict.why}; the reservation is released`);
    }
  }

  return summary;
}
