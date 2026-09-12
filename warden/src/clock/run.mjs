// One Clock run. Everything the piece owes the chain for a closed day.
//
// ORDER MATTERS AND IS NOT ARBITRARY: mints, then SEEDS, then check-ins, then
// Marks. A check-in for a token that has not been minted reverts NoSuchToken,
// and a Mark on it reverts the same way, so both creation routes go first and a
// token created this morning can be credited in the same run. Seeds sit beside
// mints rather than after the check-ins because they are the other way a token
// comes into existence, not a thing done to one that already exists.
//
// FOUR WRITE PASSES, not the three this header claimed until 2026-09-07: the
// seed pass (`3b`) was added with lineage and nothing here said so.
//
// A RUN MUST BE SAFE TO EXECUTE TWICE. Nothing here decides what to do from a
// clock or a counter; every write is chosen by reading rows the previous run
// left `queued`, and marked `written` only against a receipt. Re-running after
// a crash re-reads the world rather than replaying a plan.
import { chunk, writeCheckInChunk, packIds, packableId } from "./batch.mjs";
import { readEvents, applyEvents, DEPLOY_BLOCK, MAX_LOG_SPAN } from "./reconcile.mjs";
import { MRO_ABI } from "./abi.mjs";
import { keyIdToBytes32 } from "../mcp/keyId.mjs";

/// How many check-ins go in one batchCheckIn. MEASURED 2026-09-11 against a
/// real node's receipts (warden/tools/chunk-rehearsal.sh, Osaka rules with
/// EIP-7825 enforced): 8,763 gas per entry plus 30,896 fixed.
///
/// The rule: the largest multiple of 100 whose estimate, padded as write.mjs
/// pads it, leaves at least 500,000 under MAX_TX_GAS. 1,400 pads to 13,836,282.
/// The spec's 1,500 came from arithmetic at ~7k a check-in and passes by only
/// 177,808 -- so one dearer opcode and every full night would be refused and
/// halved into two transactions.
///
/// contracts/test/CheckIn.t.sol measures this same chunk, and
/// clock-run.test.mjs fails if its constant and this one disagree. Re-run the
/// rehearsal whenever batchCheckIn, _credit or the Token struct changes.
export const CHECKIN_CHUNK = 1_400;

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

/**
 * Is the child already on chain the same child as this queued seed?
 *
 * true  - same owner AND same parent: a previous run landed it.
 * false - a different token holds that id.
 * null  - the chain could not be read, which is NEITHER and must never be
 *         treated as either.
 *
 * The parent is the discriminator rather than the agent key, because `seed`
 * copies the parent's key into the child -- so every child of every parent
 * under one key shares a key id, and only the parent tells two of them apart.
 */
export async function seedIsOnChain({ publicClient, contract, seed }) {
  try {
    const [owner, view] = await Promise.all([
      publicClient.readContract({ address: contract, abi: MRO_ABI, functionName: "ownerOf", args: [BigInt(seed.tokenId)] }),
      publicClient.readContract({ address: contract, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(seed.tokenId)] }),
    ]);
    const sameOwner = String(owner).toLowerCase() === String(seed.toAddress).toLowerCase();
    const sameParent = BigInt(view.parent) === BigInt(seed.parentId);
    return sameOwner && sameParent;
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
  // Injected so the staleness window can be tested without waiting three days.
  now = () => Date.now(),
}) {
  const summary = {
    gasStopped: false,
    minted: [],
    credited: [],
    dropped: [],
    marks: [],
    stuck: [],
    /// Children this run created on chain, by child id.
    seeded: [],
    /// Children the chain refused for good, and whose rows this run DELETED.
    /// A drop is not a loss: it is what hands the key its agent-year back, so
    /// these are reported as a completed outcome rather than as a failure.
    droppedSeeds: [],
    /// Children whose artwork never solved. Nobody paid, so the money is not
    /// the problem -- but the reservation holds a seed the key earns once a
    /// year, and only a human decides whether to give that year back. Kept
    /// apart from `stuck` because saying "paid for" about a seed would send
    /// somebody looking for a refund that does not exist.
    stuckSeeds: [],
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
      // The FIFTH argument is the day the agent paid, as the mirror recorded it
      // -- not the day this run happens to execute. `mint` used to take
      // today() at the write, and since the Clock writes at 00:05 the next day
      // every token began a day later on chain than here, and lost its first
      // check-in (found by the fast-days copy, 2026-09-11).
      [BigInt(mint.tokenId), mint.toAddress, keyIdToBytes32(mint.agentKeyId), `0x${mint.qr}`, mint.day],
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
    // STALEDAY NEVER CLEARS FOR THIS ROW. The day the agent paid is more than
    // MAX_CREATION_LAG behind the chain, and it only falls further behind, so
    // the contract refuses the same argument every night. The agent has PAID:
    // same treatment as a mint blocked by somebody else's token -- left queued
    // for a human, never closed, and counted so the run fails.
    if (result.errorName === "StaleDay") {
      alert(`clock: mint ${mint.tokenId} was paid on day ${mint.day}, which the chain now refuses as StaleDay -- this PAID mint can never land and needs a human`);
      summary.stuckMints = summary.stuckMints ?? [];
      summary.stuckMints.push(mint.tokenId);
      continue;
    }
    alert(`clock: mint ${mint.tokenId} failed (${result.reason}${result.errorName ? ` ${result.errorName}` : ""})`);
    if (isRunLevel(result)) {
      // ABORT THE WRITES, NOT THE RUN. 4.L9: this used to `return summary`,
      // which skipped reconcile -- so a paused or sunset contract stopped the
      // mirror LEARNING as well as writing, for as long as the pause lasted.
      // Reconcile makes no writes to the chain and cannot fail for the reason
      // that stopped these, and `Rested` is exactly what a token owner does
      // while the piece is shut. The run still exits non-zero: `summary.aborted`
      // is what main.mjs reads.
      summary.aborted = result.errorName ?? result.reason;
      break;
    }
  }

  // 3b. SEEDS, THE FREE CREATION ROUTE.
  //
  //     A child is made by `seed`, not by `mint`: a different function with
  //     different arguments, and nobody paid for it. That makes the failure
  //     rule the OPPOSITE of a mint's, deliberately. A mint that cannot land is
  //     left alone for a human BECAUSE the agent's money is in it. A seed that
  //     can never land must be DROPPED, because the mirror row IS the
  //     reservation -- `unwrittenSeeds` counts `parentId IS NOT NULL AND
  //     status != 'written'` and `seed` subtracts that from the chain's own
  //     `seedsAvailable` -- so leaving it holds a once-a-year budget that the
  //     chain never agreed was spent, and the agent cannot earn that year
  //     again.
  //
  //     A child whose bitmap never solved is the one case only a human can
  //     judge. Same shape as the stuck mints above, and deliberately a
  //     different sentence: the word "paid" about a seed sends somebody looking
  //     for a refund that does not exist. It is reported, never dropped --
  //     handing a year back is a decision, not a nightly sweep.
  for (const stuck of q.stuckSeeds()) {
    summary.stuckSeeds.push(stuck.tokenId);
    alert(
      `clock: the seed of child ${stuck.tokenId} from parent ${stuck.parentId} cannot be written -- ` +
        `its artwork failed to solve after ${stuck.solveTries} tries. Nothing was charged, but the row still ` +
        "holds the key's seed for this agent-year, and giving that year back needs a human"
    );
  }

  // Nothing is sent once a write phase has aborted: NotWarden, Sunset and
  // EnforcedPause refuse `seed` for exactly the reasons they refuse `mint`.
  for (const s of summary.aborted ? [] : q.pendingSeeds()) {
    // FOUR arguments, and NO key id among them. The child inherits the parent's
    // agent key on chain (`_agentKeyOf[childId] = key`), so unlike `mint` there
    // is no bytes32 here for keyIdToBytes32 to get wrong -- but the address and
    // the `bytes` still have to encode, which is what the suite's writer double
    // checks against the real ABI.
    const result = await writer.send(
      "seed",
      // The fifth argument is the day the seed was asked for -- the same
      // first-day rule as the mint above, and for the same reason.
      [BigInt(s.tokenId), BigInt(s.parentId), s.toAddress, `0x${s.qr}`, s.day],
      { label: `seed ${s.tokenId} from ${s.parentId}` }
    );
    if (result.ok) {
      q.markSeedWritten(s.tokenId);
      summary.seeded.push(s.tokenId);
      summary.lastBlock = result.receipt?.blockNumber ?? summary.lastBlock;
      continue;
    }

    // TokenExists is read exactly as the mint pass reads it, and one branch
    // reaches the opposite conclusion.
    //
    // If the token at that id IS this child, a previous run landed it: the
    // CHAIN has already spent the key's seed, so the row moves to written.
    // Dropping here would be the worst outcome this feature has -- reconcile
    // only LOGS `Seeded`, so the mirror could never learn the child back and
    // `/t/<childId>` would 404 for the life of the piece.
    //
    // If a stranger's token holds that id, this child can never exist under it.
    // The row is dropped, which hands the agent-year back so the agent can seed
    // again under a fresh id.
    //
    // If the chain cannot be read, that is NEITHER answer, and the row waits.
    if (result.errorName === "TokenExists") {
      const mine = await seedIsOnChain({ publicClient, contract, seed: s });
      if (mine === true) {
        q.markSeedWritten(s.tokenId);
        alert(`clock: child ${s.tokenId} was already on chain as this seed; the mirror was behind and is now caught up`);
        continue;
      }
      if (mine === false) {
        q.dropSeed(s.tokenId);
        summary.droppedSeeds.push(s.tokenId);
        alert(
          `clock: child ${s.tokenId} cannot be seeded from ${s.parentId} because TokenExists and a DIFFERENT token ` +
            "holds that id; the row is dropped and the agent's seed is available again"
        );
        continue;
      }
      alert(`clock: child ${s.tokenId} exists on chain but could not be identified, so the row is left queued rather than dropped on a guess`);
      continue;
    }

    if (isRunLevel(result)) {
      // ABORT THE WRITES, NOT THE RUN -- the same rule as the mints loop, and
      // the same reason: reconcile makes no writes and cannot fail for what
      // stopped these. Dropping a whole queue of reservations because the
      // operator paused the piece would destroy real budgets for a state that
      // says nothing about any individual row.
      alert(`clock: seed ${s.tokenId} from ${s.parentId} failed (${result.errorName})`);
      summary.aborted = result.errorName ?? result.reason;
      break;
    }

    if (isFinalSeed(result)) {
      q.dropSeed(s.tokenId);
      summary.droppedSeeds.push(s.tokenId);
      alert(
        `clock: seed ${s.tokenId} from ${s.parentId} was refused as ${result.errorName}, which no later run can clear; ` +
          "the row is dropped and the agent's seed is available again"
      );
      continue;
    }

    // EVERYTHING ELSE STAYS QUEUED. See isFinalSeed for why that is the safe
    // direction and not merely the lazy one.
    alert(
      `clock: seed ${s.tokenId} from ${s.parentId} did not land ` +
        `(${result.errorName ?? result.reason}); it stays queued for the next run`
    );
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

  // Nothing is sent once a write phase has aborted -- see the mints loop for
  // why the run continues to reconcile anyway.
  const pending = summary.aborted ? [] : q.pendingCredits(today - 1);

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
      break;
    }
  }

  // 5. MARKS. Skipped entirely once a write phase has aborted: the reason that
  //    stopped the mints or the check-ins (NotWarden, Sunset, EnforcedPause)
  //    refuses these too, and one refusal should not become a hundred.
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

  for (const order of summary.aborted ? [] : q.pendingMarkOrders()) {
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
      break;
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

  // 6. WHAT HAS NOT MOVED IN THREE RUNS. 4.L3: STALE_AFTER_RUNS was exported
  //    and read by nothing, and the spec's three-run alert did not exist -- so
  //    a row that quietly failed every night produced one ordinary log line a
  //    night and no signal at all. Counted from what the mirror already stores
  //    (a credit's day, a reservation's timestamp), so there is no run counter
  //    to keep in step and no migration.
  const stale = q.staleRows(today, now(), STALE_AFTER_RUNS);
  summary.stale = stale;
  const staleTotal = stale.credits.length + stale.mints.length + stale.markOrders.length;
  if (staleTotal > 0) {
    alert(
      `clock: ${staleTotal} row(s) have been queued for ${STALE_AFTER_RUNS} runs or more and are not fixing themselves -- ` +
        `${stale.mints.length} mint(s), ${stale.credits.length} credit(s), ${stale.markOrders.length} mark order(s)`
    );
  }

  // 7. RECONCILE. Last, so it sees this run's own writes as well as whatever
  //    the token owners did during the day.
  summary.reconciled = await reconcile({ q, publicClient, contract, chainId, lastReconciledBlock, log });

  // 4.L10. `skipped` IS A DIVERGENCE SIGNAL, not a statistic. Every skip is an
  // event the CHAIN emitted about a token this mirror has never heard of -- a
  // token minted by another warden, a mirror restored from an old backup, or a
  // reconcile that has quietly lost rows. It was only ever logged inside a JSON
  // blob, which nothing reads at three in the morning. It is alerted now, and
  // it is the one reconcile number that means something is wrong rather than
  // something happened.
  if (summary.reconciled?.applied?.skipped > 0) {
    alert(
      `clock: reconcile saw ${summary.reconciled.applied.skipped} event(s) for tokens this mirror does not hold ` +
        `(blocks ${summary.reconciled.from}..${summary.reconciled.to}) -- the mirror and the chain disagree about what exists`
    );
  }

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

/**
 * Is this refusal one that DELETES the reservation and hands the year back?
 *
 * THE TWO WAYS TO BE WRONG ARE NOT SYMMETRICAL, so read the cheap one first.
 *
 * Keeping a doomed row costs the agent a seed it earns once a year, and does so
 * quietly: a seed row carries no `reservedAt`, deliberately, so neither the
 * expiry sweep nor staleRows can ever mention it. Only this pass's own alert
 * will.
 *
 * Dropping a row that DID land is worse, and it is reachable in exactly one
 * way. `receipt-unknown` means the transaction was BROADCAST and its receipt
 * never came back; it may be on chain right now. Deleting the mirror's only
 * record of that child would leave the chain holding a token this service can
 * never learn about again -- reconcile only LOGS `Seeded` -- so /t/<id> would go
 * on 404ing for a token that exists. It no longer over-issues the year as well:
 * since 2026-09-07 `seed` reads its budget from the chain's `seedsAvailable`,
 * which counts the `_seedsSpent` that landed, so the chain refuses a second
 * seed whatever this database has forgotten. The lost token is harm enough.
 *
 * THAT IS WHY ONLY A NAMED REVERT CAN BE PERMANENT. `reverted-on-simulate` is
 * the only shape write.mjs decodes a name from, and it is raised BEFORE
 * anything is sent, so it proves no transaction exists. Every other failure --
 * send-failed, gas-estimate-failed, gas-estimate-too-large, receipt-unknown,
 * reverted-on-chain, and a simulate revert whose error had no name -- leaves the
 * row exactly where it was.
 *
 * These are every named error `seed(uint256,uint256,address,bytes,uint32)` can
 * raise, read off MachineReadableOnly.sol's `seed` plus its three modifiers and
 * `_checkCreationDay`, and each is here or below the line for a stated reason.
 * `StaleDay` joined 2026-09-11 with the first-day fix: a seed's day is frozen in
 * its row and the chain's today() only moves forward, so a day more than
 * MAX_CREATION_LAG behind can never become writable. `FutureDay` cannot fire
 * here -- the day is recorded when the seed is asked for, so it is never ahead.
 *
 * PERMANENT, because no later run can clear it:
 *   Resting               `rest` sets `s.resting = true` at :780 and NOTHING in
 *                         the contract ever clears it. The parent can never
 *                         seed again, so the year belongs somewhere else.
 *   NoSeedAvailable       the CHAIN says this key has no unspent seed, and the
 *                         mirror row is precisely what claims otherwise.
 *                         Keeping it preserves a disagreement in which the
 *                         mirror holds a budget that was never granted; the drop
 *                         is what makes the two agree. It could technically
 *                         clear at the next anniversary, a year away -- but a
 *                         year of nightly retries is not a retry, and after the
 *                         drop the agent simply asks again when the year turns.
 *   IdTooLarge            the child id is a stored value and 2**32 is a
 *                         constant; there is no later state in which they pass.
 *   BadCodeLength         the stored bitmap's length against CODE_BYTES, and
 *                         nothing can change either. This row's `qr` is frozen:
 *                         pendingSeeds returns only `solveState = 'done'`, and
 *                         no done row is ever re-solved -- nextPendingMint
 *                         selects `'pending'` and requeueSolving only requeues
 *                         `'solving'`.
 *   ERC721InvalidReceiver `to` is stored, and the child can be delivered
 *                         nowhere else. Dropping returns the year so the agent
 *                         can seed to an address that accepts ERC-721; keeping
 *                         delivers it nowhere, forever.
 *
 * NOT permanent, and each for a reason:
 *   ParentNotWhole   THE BRIEF CALLED THIS PERMANENT AND THE CONTRACT SAYS
 *                    OTHERWISE. `seed` refuses `p.level < 365`, and `level` is
 *                    only ever `+= 1` (:417) with no path anywhere that lowers
 *                    it. A parent one day short tonight is whole tomorrow.
 *                    The one parent whose level IS frozen forever is a sealed
 *                    one -- and `:816` checks `p.resting` BEFORE `:817` checks
 *                    the level, so that parent answers Resting and is dropped
 *                    above. There is no state in which waiting is futile.
 *   SupplyCap        `totalMinted >= supplyCap`, and supplyCap is an owner dial
 *   WalletCap        `mintedTo[to] >= walletCap`, likewise. The test is not
 *                    whether the AGENT can act on it, it is whether any later
 *                    run could succeed -- and raising a cap makes one succeed.
 *                    There is always somebody who can: renounceOwnership()
 *                    reverts at :266, so this contract can never be ownerless.
 *   TokenExists      has three answers and only the chain knows which; handled
 *                    above, where one of them is a drop and one is a write.
 *   NotWarden        run-level, and cleared by setWarden
 *   EnforcedPause    run-level, and cleared by unpause
 *   Sunset           run-level. Irreversible, but it stops the whole piece:
 *                    emptying every agent's reservation on the night the
 *                    operator closes the door would be a mass deletion driven
 *                    by one call, and the budgets are worth nothing then anyway.
 */
function isFinalSeed(result) {
  if (result.reason !== "reverted-on-simulate") return false;
  return [
    "Resting",
    "NoSeedAvailable",
    "IdTooLarge",
    "BadCodeLength",
    "ERC721InvalidReceiver",
    // The seed's recorded day is more than MAX_CREATION_LAG behind today() --
    // the row is frozen and the chain's clock only moves forward, so no later
    // run can write it. Dropping hands the agent-year back to ask again.
    "StaleDay",
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
