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
import { chunk, writeCheckInChunk, packIds, packableId } from "./batch.mjs";
import { readEvents, applyEvents, DEPLOY_BLOCK, MAX_LOG_SPAN } from "./reconcile.mjs";
import { MRO_ABI } from "./abi.mjs";
import { keyIdToBytes32 } from "../mcp/keyId.mjs";

/// The spec's chunk size. UNVERIFIED against a real full chunk: it comes from
/// arithmetic (about 7k gas per check-in against a 15M ceiling), and only one
/// token existed when this was written, so a 1,500-entry estimate could not be
/// taken. Task 8 measures the real per-entry cost. Until then the writer's own
/// `gas-estimate-too-large` refusal is the backstop, not this number.
export const CHECKIN_CHUNK = 1_500;

/// How far behind the chain head reconcile reads. Base's blocks are two
/// seconds, so this is under a minute of lag against a nightly job -- and the
/// reads it guards (resting, transfers, rebinds) are one-way in the mirror.
export const CONFIRMATIONS = 12;

/// How many runs a row may survive before a human is told. A row that fails
/// three nights running is not going to fix itself.
export const STALE_AFTER_RUNS = 3;

/**
 * Run the Clock once.
 *
 * `today` is the current UTC day index; only days STRICTLY BEFORE it are
 * written, because a check-in at 00:03 belongs to a day that has not closed.
 */
/**
 * Is the token already on chain the same mint as this queued row?
 *
 * true  - same owner AND same agent key: a previous run landed it.
 * false - a different token holds that id.
 * null  - the chain could not be read, which is NEITHER of the above and must
 *         never be treated as either.
 */
/**
 * One token's `lastDay` as the CHAIN holds it, or null when it cannot be read.
 *
 * This is the only way a landed-but-unmarked check-in can ever be discovered.
 * `BatchCheckedIn(fromDay, toDay, count)` names no tokens, so events cannot
 * answer it; `viewOf` can.
 *
 * Null on ANY failure, and the caller must treat null as "could not ask" rather
 * than "not on chain" -- healing a row that did not land would lose that day
 * forever, because batchCheckIn refuses `day <= lastDay` and a missed day can
 * never be backfilled.
 */
export async function chainLastDay({ publicClient, contract, tokenId }) {
  try {
    const view = await publicClient.readContract({
      address: contract,
      abi: MRO_ABI,
      functionName: "viewOf",
      args: [BigInt(tokenId)],
    });
    return Number(view.lastDay);
  } catch {
    return null;
  }
}

export async function mintIsOnChain({ publicClient, contract, mint }) {
  try {
    const [owner, view] = await Promise.all([
      publicClient.readContract({ address: contract, abi: MRO_ABI, functionName: "ownerOf", args: [BigInt(mint.tokenId)] }),
      publicClient.readContract({ address: contract, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(mint.tokenId)] }),
    ]);
    const sameOwner = String(owner).toLowerCase() === String(mint.toAddress).toLowerCase();
    const sameKey = String(view.agentKeyId).toLowerCase() === keyIdToBytes32(mint.agentKeyId).toLowerCase();
    return sameOwner && sameKey;
  } catch {
    return null;
  }
}

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
    /// Mark orders in their terminal state: paid for, refused by the chain, and
    /// waiting for a human. Separate from `stuck`, which is mints whose artwork
    /// never solved -- the two need different answers from whoever reads them.
    stuckMarks: [],
    /// Check-ins the chain ALREADY HELD. Not written by this run and not
    /// refused: the mirror was behind, and these rows are now caught up. They
    /// are counted separately because "we credited a day" and "we discovered a
    /// day was credited months ago" are different facts about the night.
    healed: [],
    /// Credits the chain condemned outright -- a token that does not exist, or
    /// one its owner has sealed. Terminal, like a refused mark order, so they
    /// stop being re-offered every night; and they fail the run, because a
    /// silent nightly drop is how this class of defect stayed invisible.
    stuckCredits: [],
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
      // The mirror stores the RFC 7638 thumbprint as base64url; the contract
      // takes bytes32. Every other caller converts (checkin compares against
      // keyIdToBytes32, rebind sends it), and this one did not -- so viem
      // refused to encode the argument and NO mint could ever be written.
      // The revert surfaced only as "reverted-on-simulate" with no error name,
      // because it never reached the chain to produce one.
      [BigInt(mint.tokenId), mint.toAddress, keyIdToBytes32(mint.agentKeyId), `0x${mint.qr}`],
      { label: `mint ${mint.tokenId}` }
    );
    if (result.ok) {
      q.markMintWritten(mint.tokenId);
      summary.minted.push(mint.tokenId);
      summary.lastBlock = result.receipt?.blockNumber ?? summary.lastBlock;
      continue;
    }
    // TokenExists has TWO causes and they need opposite handling.
    //
    // If the token on chain IS this mint -- same owner, same agent key -- then
    // a previous run landed it and this mirror is simply behind. Marking it
    // written is right, and retrying every night forever would be noise.
    //
    // If it is a DIFFERENT token, this mint has not happened and cannot happen
    // under this id. The agent has PAID. Closing the row here would report
    // success for a token that does not exist and leave the mirror claiming an
    // id somebody else owns, so the row is left alone for a human. Assuming
    // the benign cause is how a paid mint disappears silently.
    if (result.errorName === "TokenExists") {
      const mine = await mintIsOnChain({ publicClient, contract, mint });
      if (mine === true) {
        q.markMintWritten(mint.tokenId);
        alert(`clock: token ${mint.tokenId} was already on chain as this mint; the mirror was behind and is now caught up`);
        continue;
      }
      alert(
        mine === false
          ? `clock: token ${mint.tokenId} is held on chain by a DIFFERENT token, so this PAID mint cannot land under that id and needs a human`
          : `clock: token ${mint.tokenId} exists on chain but could not be identified, so this PAID mint is left queued rather than closed on a guess`
      );
      summary.stuckMints = summary.stuckMints ?? [];
      summary.stuckMints.push(mint.tokenId);
      continue;
    }
    alert(`clock: mint ${mint.tokenId} failed (${result.reason}${result.errorName ? ` ${result.errorName}` : ""})`);
    if (isRunLevel(result)) {
      summary.aborted = result.errorName ?? result.reason;
      return summary;
    }
  }

  // 4. CHECK-INS, in chunks, each shrinking around whatever the chain refuses.
  //
  // `lastDayOf` is what makes a landed-but-unmarked check-in recoverable. The
  // contract's only check-in event carries no token ids, so no reconcile can
  // ever heal one -- the chain's STATE is the only source, and this is the read
  // that asks it. A failed read returns null, which the heal path treats as
  // "could not ask" rather than "not on chain".
  const lastDayOf = async (tokenId) => {
    const life = await chainLastDay({ publicClient, contract, tokenId });
    return life;
  };

  const pending = q.pendingCredits(today - 1);

  // 15.8. ONE BAD ROW IS ONE ROW'S PROBLEM. packIds throws on an id that will
  // not fit in four bytes, it is called with no `try`, and the throw
  // propagates out of the whole run -- so a single malformed credit stopped
  // that night's check-ins, its Marks and its reconcile, for every token.
  // Filtered here, by name, with an alert: the row is reported and the night
  // continues. It stays queued rather than being marked written, because
  // nothing about it reached the chain.
  const sendable = [];
  for (const entry of pending) {
    if (packableId(entry.tokenId)) { sendable.push(entry); continue; }
    summary.dropped.push({ entry, reason: "unpackable-id" });
    alert(`clock: credit for token ${entry.tokenId} has an id the contract cannot decode; skipped, and it stays queued`);
  }

  for (const entries of chunk(sendable, chunkSize)) {
    const result = await writeCheckInChunk(writer, entries, { log, lastDayOf });
    for (const entry of result.written) {
      q.markCreditWritten(entry.tokenId, entry.day);
      summary.credited.push(entry);
    }
    // A HEALED ROW IS MARKED WRITTEN, which is the whole point: a row that is
    // merely forgotten stays queued and comes back tomorrow, and that loop is
    // what froze a token's record permanently.
    for (const entry of result.healed ?? []) {
      q.markCreditWritten(entry.tokenId, entry.day);
      summary.healed.push(entry);
      alert(
        `clock: token ${entry.tokenId} day ${entry.day} was already on chain; ` +
          "the mirror was behind and is now caught up"
      );
    }
    if (result.blockNumber) summary.lastBlock = result.blockNumber;
    for (const drop of result.dropped) {
      summary.dropped.push(drop);
      // TERMINAL, not "stays queued". A credit the chain condemned will be
      // condemned again every night for the same reason, and re-offering it
      // forever is how a real problem becomes a line somebody learns to scroll
      // past. `attempts-exhausted` is the exception: that entry was never
      // judged, only rationed, so it stays queued for tomorrow.
      if (drop.reason === "attempts-exhausted") {
        alert(`clock: token ${drop.entry.tokenId} day ${drop.entry.day} was not attempted (${drop.reason}) and stays queued`);
        continue;
      }
      q.failCredit(drop.entry.tokenId, drop.entry.day);
      summary.stuckCredits.push(drop);
      alert(`clock: token ${drop.entry.tokenId} day ${drop.entry.day} was refused (${drop.reason}) and needs a human`);
    }
    if (result.aborted) {
      summary.aborted = result.aborted;
      alert(
        result.aborted === "receipt-unknown"
          ? `clock: check-ins aborted -- tx ${result.hash} was broadcast and its receipt never arrived. ` +
            "It may yet land; tomorrow's run resolves it against the chain rather than resending."
          : `clock: check-ins aborted (${result.aborted})`
      );
      return summary;
    }
  }

  // 5. MARKS.
  //
  // Orders already known to be refused are reported once per run at log level
  // and NOT re-sent. They are not alerted again: the alert fired at the moment
  // the chain refused the order, which is the only moment it told a human
  // anything new. This is where marks differ from stuckMints above -- a solve
  // fails inside another loop entirely, so the Clock's own run is the first
  // place it can be raised at all, while a mark order fails here.
  for (const stuck of q.stuckMarkOrders()) {
    summary.stuckMarks.push(stuck);
  }
  if (summary.stuckMarks.length > 0) {
    log(`clock: ${summary.stuckMarks.length} mark order(s) the chain refused are waiting for a human: ` +
      summary.stuckMarks.map((o) => `${o.upgradeId} on ${o.tokenId}`).join(", "));
  }

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
    // The chain already has this Mark and the mirror was behind. Same shape as
    // TokenExists above: the row is settled whatever this run thinks, and the
    // agent has what it paid for, so it moves to written -- which also sets the
    // mirror's mask -- rather than to failed.
    if (result.errorName === "MarkAlreadyApplied") {
      q.markOrderWritten(order.tokenId, order.upgradeId);
      alert(`clock: mark ${order.upgradeId} was already on token ${order.tokenId}; the mirror was behind and is now caught up`);
      continue;
    }
    alert(`clock: applyMark ${order.upgradeId} on ${order.tokenId} failed (${result.errorName ?? result.reason})`);
    if (isRunLevel(result)) {
      summary.aborted = result.errorName ?? result.reason;
      return summary;
    }
    // ONLY A NAMED, PERMANENT REFUSAL IS FINAL FOR THIS ROW -- see isFinalMark.
    //
    // EVERY OTHER FAILURE STAYS QUEUED, deliberately. send-failed,
    // gas-estimate-failed and reverted-on-chain can all be a public RPC having
    // a bad minute, and a token that paid $1,250.00 for a Vessel must not lose
    // it to one. The row is retried on the next run exactly as it always was.
    if (isFinalMark(result)) {
      q.failMarkOrder(order.tokenId, order.upgradeId);
      summary.stuckMarks.push(order);
      alert(`clock: mark ${order.upgradeId} on token ${order.tokenId} is paid for and the chain refuses it (${result.errorName ?? "no named error"}) -- it will not be retried and needs a human`);
    }
  }

  // 6. RECONCILE. Last, so it sees this run's own writes as well as whatever
  //    the token owners did during the day.
  summary.reconciled = await reconcile({ q, publicClient, contract, chainId, lastReconciledBlock, log });

  return summary;
}

/**
 * Is this refusal permanent for this row, rather than the chain being behind?
 *
 * THE DISTINCTION IS EXPENSIVE TO GET WRONG IN EITHER DIRECTION. Too narrow and
 * a doomed row is re-sent nightly, burying the alert that matters. Too broad and
 * a paid Mark is destroyed by a transient fault -- and worse than destroyed,
 * because a failed row also closes the OTHER side of its pair in reservedMask,
 * so a token loses a Mark it paid for AND the one it could still have earned.
 *
 * So this is an ALLOWLIST of applyMark's own named errors that no later run can
 * clear, not a test on `reason`. Keying it on `reverted-on-simulate` was too
 * broad and is what this replaces: three of the errors below the line mean the
 * chain is BEHIND, and a mint whose send failed is explicitly not run-level, so
 * the Clock reaches applyMark for a token the chain has not seen yet.
 *
 * NOT here, and each for a reason:
 *   NoSuchToken  the mint has not landed yet; it lands on a later run
 *   MarkGate     a level or streak the chain has not credited yet
 *   MarkRequires an Iris still queued, possibly in this very run
 *   MarkInactive setUpgrade has not written this Mark on chain yet
 *   (no name)    including, TODAY, a three-argument applyMark that does not
 *                exist on the deployed address -- the queue must survive the
 *                redeploy, not be emptied by it
 * MarkAlreadyApplied is handled above, and settles the row as written.
 * MarkIdOutOfRange is absent because applyMark cannot revert it: that check is
 * in setUpgrade, and the tool's schema bounds the id to 1-10 before this.
 */
function isFinalMark(result) {
  if (result.reason !== "reverted-on-simulate") return false;
  return [
    "MarkExcluded", // the pair's other side is on chain; permanent by design
    "Resting", // the owner sealed the token; irreversible
    "BadVariant", // the shape paid for is not one this Mark offers
    "MarkSoldOut", // cannot fire while nothing is limited, and never un-sells
  ].includes(result.errorName);
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
  // 15.6. CONFIRMATION DEPTH. This used to read to the bare head and apply
  // one-way state from it -- `setResting` has no clearing statement and
  // `markMintWritten` removes the row from pendingMints permanently, so a log
  // read from a block that is later reorged out cannot be undone. The trigger
  // is not an exotic sequencer reorg either: batch.mjs's own comment records
  // that this RPC is load-balanced and NOT read-after-write consistent, so the
  // head can move backwards between two calls in the ordinary case.
  //
  // Trailing the head costs one night of latency on a state change and buys
  // back the only irreversible reads in the Clock.
  const head = await publicClient.getBlockNumber() - BigInt(CONFIRMATIONS);
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
