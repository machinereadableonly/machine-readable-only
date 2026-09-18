/**
 * Resolving a settlement whose outcome was never learned.
 *
 * THE PROBLEM THIS ANSWERS. `@x402/mcp` reports a settlement that threw exactly
 * as it reports one the facilitator declined, and fires no hook for either. A
 * throw is also what a timeout or a dropped response looks like -- and by that
 * point the EIP-3009 transfer may already be mined. Until 2026-09-18 the Warden
 * read both as failure and deleted the reservation, so an agent could be
 * debited up to $1,250.00 and hold nothing, its authorisation spent, with one
 * log line as the only trace.
 *
 * The gateway now HOLDS such a row in 'payment-unresolved' instead, along with
 * the payer and the token contract. This is the other half: an EIP-3009 token
 * records every authorisation it has ever spent, permanently, so the chain can
 * be asked a question with exactly one right answer.
 *
 * WHY HERE AND NOT AT THE MOMENT OF FAILURE. A public RPC is not
 * read-after-write consistent -- a read issued straight after a transfer can
 * land on a node that has not imported it yet and answer "never spent" about
 * money that has just moved. Acting on that answer is the loss all over again.
 * The Clock asks the next morning, when the question has settled.
 *
 * NOTHING HERE GUESSES. A read that fails, or a row with nothing to ask the
 * chain with, is left exactly as it is and reported, which fails the run.
 */

/// The one function worth calling, from EIP-3009 itself. Hand-written rather
/// than imported: this is not our contract, and the full USDC ABI would be
/// several hundred entries to carry one view.
export const EIP3009_ABI = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Ask the chain about every held payment, and act on each answer.
 *
 * Returns `{ resolvedPaid, resolvedUnpaid, unresolvedPayments }`, all arrays of
 * token ids. The last one is what a human still has to look at, and it fails
 * the run for as long as it is not empty.
 */
export async function resolveUnresolvedPayments({ q, publicClient, alert = console.error, log = console.log }) {
  const summary = { resolvedPaid: [], resolvedUnpaid: [], unresolvedPayments: [] };
  const held = q.unresolvedPayments();
  if (!held.length) return summary;

  log(`clock: ${held.length} payment(s) held with an unknown outcome -- asking the chain`);

  for (const row of held) {
    const what = `${row.kind} ${row.tokenId}`;

    // ASK ABOUT THE PAYER, NEVER THE RECIPIENT. They are allowed to differ, and
    // an authorisation the recipient never signed reads as unspent -- which
    // would release a row that was paid for. No payer, no question.
    if (!ADDRESS.test(row.payer ?? "") || !ADDRESS.test(row.asset ?? "") || !BYTES32.test(row.payNonce ?? "")) {
      summary.unresolvedPayments.push(row.tokenId);
      alert(
        `clock: ${what} has an unknown payment outcome and nothing to ask the chain with ` +
          `(payer ${row.payer ?? "none"}, asset ${row.asset ?? "none"}). A human must check it.`
      );
      continue;
    }

    let spent;
    try {
      spent = await publicClient.readContract({
        address: row.asset,
        abi: EIP3009_ABI,
        functionName: "authorizationState",
        args: [row.payer, row.payNonce],
      });
    } catch (err) {
      // The row stays exactly as it is. Tomorrow's run asks again, and until
      // one of them gets an answer this fails the run every night.
      summary.unresolvedPayments.push(row.tokenId);
      alert(`clock: ${what} could not be resolved -- the chain did not answer: ${err.shortMessage ?? err.message}`);
      continue;
    }

    const moved = q.resolveUnresolvedPayment(row.payNonce, { paid: Boolean(spent) });
    if (!moved) {
      // Something changed the row between the read above and this write. That
      // is not an error -- a late settlement arriving is the good case -- but
      // it is worth saying so out loud, because the alternative reading is a
      // bug in this loop.
      log(`clock: ${what} was already resolved by something else; left alone`);
      continue;
    }

    if (spent) {
      summary.resolvedPaid.push(row.tokenId);
      // NOT A SILENT REPAIR. The agent was told its payment failed, and now it
      // is getting what it paid for, a day late. The receipt is the
      // facilitator's transfer, which this service never saw -- the nonce is
      // how it is found on an explorer.
      alert(
        `clock: ${what} WAS PAID FOR after all -- the chain has authorisation ${row.payNonce} spent by ` +
          `${row.payer}. Queued for writing; no receipt is stored, find the transfer by that nonce.`
      );
    } else {
      summary.resolvedUnpaid.push(row.tokenId);
      log(`clock: ${what} was never paid for -- authorisation ${row.payNonce} is unspent, reservation released`);
    }
  }

  return summary;
}
