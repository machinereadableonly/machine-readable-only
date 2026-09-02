// One Clock run. Everything the piece owes the chain for a closed day.
//
// ORDER MATTERS AND IS NOT ARBITRARY: mints, then check-ins, then Marks. A
// check-in for a token that has not been minted reverts NoSuchToken, and a Mark
// on it reverts the same way. Writing them in this order means a token minted
// this morning can be credited in the same run.
//
// A RUN MUST BE SAFE TO EXECUTE TWICE. Nothing here decides what to do from a
// clock or a counter; every write is chosen by reading rows the previous run
// left `queued`, and marked `written` only against a receipt. Re-running after
// a crash re-reads the world rather than replaying a plan.
import { chunk, writeCheckInChunk, packIds } from "./batch.mjs";
import { readEvents, applyEvents, DEPLOY_BLOCK, MAX_LOG_SPAN } from "./reconcile.mjs";

/// The spec's chunk size. UNVERIFIED against a real full chunk: it comes from
/// arithmetic (about 7k gas per check-in against a 15M ceiling), and only one
/// token existed when this was written, so a 1,500-entry estimate could not be
/// taken. Task 8 measures the real per-entry cost. Until then the writer's own
/// `gas-estimate-too-large` refusal is the backstop, not this number.
export const CHECKIN_CHUNK = 1_500;

/// How many runs a row may survive before a human is told. A row that fails
/// three nights running is not going to fix itself.
export const STALE_AFTER_RUNS = 3;

/**
 * Run the Clock once.
 *
 * `today` is the current UTC day index; only days STRICTLY BEFORE it are
 * written, because a check-in at 00:03 belongs to a day that has not closed.
 */
export async function runClock({
  q,
  writer,
  publicClient,
  contract,
  chainId,
  today,
  lastReconciledBlock = null,
  chunkSize = CHECKIN_CHUNK,
  log = console.log,
  alert = console.error,
}) {
  const summary = {
    gasStopped: false,
    minted: [],
    credited: [],
    dropped: [],
    marks: [],
    stuck: [],
    aborted: null,
    reconciled: null,
    /// The block the last successful write landed in, or null. Anything that
    /// reads state back to verify a write must wait for a node that has this
    /// block: the public RPC is load balanced and a read issued straight after
    /// a receipt can land on one that has not imported it yet.
    lastBlock: null,
  };

  // 1. THE GAS GUARD, BEFORE ANYTHING IS SENT. Stopping the whole run rather
  //    than skipping individual writes is deliberate: a run that wrote the
  //    mints and abandoned the check-ins leaves the mirror half-applied, and
  //    waiting costs nothing at all. A pending row keeps its own day number, so
  //    levels and streaks come out identical whenever the write lands.
  const gas = await writer.gasOk();
  if (!gas.ok) {
    summary.gasStopped = true;
    alert(`clock: gas is ${writer.formatGas(gas.gasPrice)}, above the cap of ${writer.formatGas(gas.capWei)} -- nothing written`);
    return summary;
  }
  log(`clock: gas ${writer.formatGas(gas.gasPrice)}, under the cap`);

  await writer.startRun();

  // 2. A MINT WHOSE ARTWORK NEVER SOLVED CAN NEVER BE WRITTEN. The contract
  //    takes `code` once and keeps it forever, so minting a placeholder makes a
  //    permanently broken artwork out of a merely delayed one. The agent has
  //    PAID, so this is never silent.
  for (const stuck of q.stuckMints()) {
    summary.stuck.push(stuck.tokenId);
    alert(`clock: token ${stuck.tokenId} is paid for but its artwork failed to solve after ${stuck.solveTries} tries -- it cannot be minted and needs a human`);
  }

  // 3. MINTS.
  for (const mint of q.pendingMints()) {
    const result = await writer.send(
      "mint",
      [BigInt(mint.tokenId), mint.toAddress, mint.agentKeyId, `0x${mint.qr}`],
      { label: `mint ${mint.tokenId}` }
    );
    if (result.ok) {
      q.markMintWritten(mint.tokenId);
      summary.minted.push(mint.tokenId);
      summary.lastBlock = result.receipt?.blockNumber ?? summary.lastBlock;
      continue;
    }
    // TokenExists means somebody already minted this id -- the row is settled
    // whatever this run thinks, and retrying it every night forever would be
    // noise. Everything else stays queued for the next run.
    if (result.errorName === "TokenExists") {
      q.markMintWritten(mint.tokenId);
      alert(`clock: token ${mint.tokenId} already existed on chain; the mirror was behind and is now caught up`);
      continue;
    }
    alert(`clock: mint ${mint.tokenId} failed (${result.reason}${result.errorName ? ` ${result.errorName}` : ""})`);
    if (isRunLevel(result)) {
      summary.aborted = result.errorName ?? result.reason;
      return summary;
    }
  }

  // 4. CHECK-INS, in chunks, each shrinking around whatever the chain refuses.
  const pending = q.pendingCredits(today - 1);
  for (const entries of chunk(pending, chunkSize)) {
    const result = await writeCheckInChunk(writer, entries, { log });
    for (const entry of result.written) {
      q.markCreditWritten(entry.tokenId, entry.day);
      summary.credited.push(entry);
    }
    if (result.blockNumber) summary.lastBlock = result.blockNumber;
    for (const drop of result.dropped) {
      summary.dropped.push(drop);
      alert(`clock: token ${drop.entry.tokenId} day ${drop.entry.day} was refused (${drop.reason}) and stays queued`);
    }
    if (result.aborted) {
      summary.aborted = result.aborted;
      alert(`clock: check-ins aborted (${result.aborted})`);
      return summary;
    }
  }

  // 5. MARKS.
  for (const order of q.pendingMarkOrders()) {
    // THREE arguments. The variant is the shape or ink the agent chose and paid
    // for, and it exists nowhere else -- the contract writes it into the token's
    // own word, permanently. Dropping it would silently hand out the default.
    const result = await writer.send("applyMark",
      [BigInt(order.tokenId), order.upgradeId, order.variant], {
        label: `applyMark ${order.upgradeId} on ${order.tokenId}`,
      });
    if (result.ok) {
      q.markOrderWritten(order.tokenId, order.upgradeId);
      summary.marks.push(order);
      summary.lastBlock = result.receipt?.blockNumber ?? summary.lastBlock;
      continue;
    }
    alert(`clock: applyMark ${order.upgradeId} on ${order.tokenId} failed (${result.errorName ?? result.reason})`);
    if (isRunLevel(result)) {
      summary.aborted = result.errorName ?? result.reason;
      return summary;
    }
  }

  // 6. RECONCILE. Last, so it sees this run's own writes as well as whatever
  //    the token owners did during the day.
  summary.reconciled = await reconcile({ q, publicClient, contract, chainId, lastReconciledBlock, log });

  return summary;
}

/// Errors that mean the next write will fail for the same reason. Continuing
/// through a queue of mints when the piece is paused just makes one refusal
/// into a hundred.
function isRunLevel(result) {
  return ["NotWarden", "Sunset", "EnforcedPause"].includes(result.errorName);
}

/**
 * Read the day's events and apply them.
 *
 * Floors at the deploy block on a first run. `lastReconciledBlock` is what the
 * caller persisted last time; passing it makes the window the gap since then
 * rather than the whole history, which matters after an outage.
 */
export async function reconcile({ q, publicClient, contract, chainId, lastReconciledBlock, log = () => {} }) {
  const head = await publicClient.getBlockNumber();
  const floor = DEPLOY_BLOCK[chainId];
  if (floor === undefined) {
    throw new Error(`no deploy block recorded for chain ${chainId}: reconcile would guess at its own history`);
  }
  const from = lastReconciledBlock === null ? floor : BigInt(lastReconciledBlock) + 1n;
  if (from > head) return { from, to: head, pages: 0, applied: null };

  const { events, pages } = await readEvents(publicClient, {
    contract,
    fromBlock: from,
    toBlock: head,
    span: MAX_LOG_SPAN,
    onPage: ({ from: a, to: b, found }) => {
      if (found > 0) log(`clock: reconcile ${a}..${b}: ${found} logs`);
    },
  });
  const applied = applyEvents(q, events, { log });
  log(`clock: reconciled ${from}..${head} in ${pages} page${pages === 1 ? "" : "s"}: ${JSON.stringify(applied)}`);
  return { from, to: head, pages, applied };
}

export { packIds };
