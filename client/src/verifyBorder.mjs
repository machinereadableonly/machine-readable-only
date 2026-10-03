// VERIFY-BORDER: check every square of a token's answer band from chain data
// alone. Each night the Clock reveals the keys of the days that are over, with
// the questions those days asked, and points at the reveal before; walking
// that pointer back finds every key and, in the blocks right after each
// reveal, every write that credited the token.
import { decodeEventLog, decodeFunctionData, hexToString } from "viem";
import { BORDER_ABI } from "./borderAbi.mjs";
import { keyIndexFor, answerBit, silentBit } from "./split.mjs";

export { BORDER_ABI };

// A public RPC serves at most this many blocks per log query.
const LOG_SPAN = 1000n;

const bitOf = (words, i) => Number((BigInt(words[i >> 8]) >> BigInt(i & 255)) & 1n);

function decodeLogs(logs) {
  const out = [];
  for (const log of logs) {
    try {
      out.push({ ...log, ...decodeEventLog({ abi: BORDER_ABI, data: log.data, topics: log.topics }) });
    } catch {
      // An event outside the slice this verifier reads.
    }
  }
  return out;
}

async function logsBetween(publicClient, contract, fromBlock, toBlock) {
  const out = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < toBlock ? from + LOG_SPAN - 1n : toBlock;
    out.push(...decodeLogs(await publicClient.getLogs({ address: contract, fromBlock: from, toBlock: to })));
  }
  return out;
}

/// This token's credits in one transaction: { day, kind, answerByte }.
function creditsIn(input, id) {
  let call;
  try {
    call = decodeFunctionData({ abi: BORDER_ABI, data: input });
  } catch {
    return [];
  }
  const { functionName: fn, args } = call;
  if (fn === "mint" && args[0] === id) return [{ day: Number(args[4]), kind: "first" }];
  if (fn === "seed" && args[0] === id) return [{ day: Number(args[4]), kind: "first" }];
  if (fn === "checkInWithVoucher" && args[0] === id) return [{ day: Number(args[1]), kind: "voucher" }];
  if (fn !== "batchCheckIn") return [];
  const packed = args[0].slice(2);
  const record = args[3].slice(2);
  const out = [];
  for (let i = 0; i < args[1].length; i++) {
    if (BigInt("0x" + packed.slice(8 * i, 8 * i + 8)) !== id) continue;
    out.push({ day: Number(args[1][i]), kind: "credit", answerByte: parseInt(record.slice(2 * i, 2 * i + 2), 16) });
  }
  return out;
}

export async function verifyBorder({ publicClient, contract, tokenId, maxRunBlocks = 5000 }) {
  const id = BigInt(tokenId);
  const read = (functionName, args) => publicClient.readContract({ address: contract, abi: BORDER_ABI, functionName, args });
  const [view, words, anchorDayRaw, lastReveal, head] = await Promise.all([
    read("viewOf", [id]), read("answersOf", [id]), read("splitAnchorDay"), read("lastRevealBlock"),
    publicClient.getBlockNumber(),
  ]);
  const level = Number(view.level);
  const mintDay = Number(view.mintDay);
  const anchorDay = Number(anchorDayRaw);
  const problems = [];
  if (level === 0) return { ok: false, squares: [], problems: [`token ${tokenId} does not exist`] };

  // 1. Walk the reveals back, newest first, until one ran before the token existed.
  const keyByIndex = new Map();
  const questionByDay = new Map();
  const nights = [];
  for (let block = BigInt(lastReveal); block !== 0n; ) {
    const reveal = decodeLogs(await publicClient.getLogs({ address: contract, fromBlock: block, toBlock: block }))
      .find((l) => l.eventName === "SplitKeysRevealed");
    if (!reveal) {
      problems.push(`no reveal found at block ${block}, where the chain says the last one was`);
      break;
    }
    const { firstIndex, keys, prevRevealBlock, questions } = reveal.args;
    keys.forEach((k, i) => keyByIndex.set(Number(firstIndex) + i, k));
    try {
      for (const q of JSON.parse(hexToString(questions))) questionByDay.set(q.day, q);
    } catch {
      problems.push(`the reveal at block ${block} published questions that are not JSON`);
    }
    // A run reveals keys through the day before it ran, so one whose last key
    // is before the day ahead of the mint ran before the token existed.
    const lastKeyDay = anchorDay + Number(firstIndex) + keys.length - 2;
    if (keys.length > 0 && lastKeyDay < mintDay - 1) break;
    nights.push(block);
    block = BigInt(prevRevealBlock);
  }

  // 2. Each run's writes follow its reveal: scan to the next reveal, or a run's
  //    length. The newest night is scanned to the chain's head, which is also
  //    where voucher credits land once the Warden has stopped revealing.
  nights.sort((a, b) => (a < b ? -1 : 1));
  const byDay = new Map();
  for (let n = 0; n < nights.length; n++) {
    const from = nights[n];
    const cap = n + 1 < nights.length ? from + BigInt(maxRunBlocks) : BigInt(head);
    let to = n + 1 < nights.length && nights[n + 1] - 1n < cap ? nights[n + 1] - 1n : cap;
    if (to > BigInt(head)) to = BigInt(head);
    const hashes = new Set();
    for (const log of await logsBetween(publicClient, contract, from, to)) {
      const mine =
        (log.eventName === "Minted" && log.args.id === id) ||
        (log.eventName === "Seeded" && log.args.childId === id) ||
        (log.eventName === "MetadataUpdate" && log.args._tokenId === id);
      if (mine) hashes.add(log.transactionHash);
    }
    for (const hash of hashes) {
      const tx = await publicClient.getTransaction({ hash });
      for (const c of creditsIn(tx.input, id)) if (!byDay.has(c.day)) byDay.set(c.day, c);
    }
  }

  // 3. Credit k, in day order, is square k -- but only when every credit was
  //    found. The chain holds no day per credit, so with one missing there is
  //    no telling which square it was, and grading the rest would accuse an
  //    honest chain.
  const credits = [...byDay.values()].sort((a, b) => a.day - b.day);
  if (credits.length !== level) {
    const days = credits.map((c) => c.day).join(", ") || "none";
    return {
      ok: false,
      squares: Array.from({ length: level }, (_, i) => ({
        level: i + 1, day: null, expected: null, actual: bitOf(words, i), status: "missing",
      })),
      problems: [
        ...problems,
        `found ${credits.length} credits for a token at level ${level} (days ${days}); ` +
          "the border cannot be checked square by square until the rest are found",
      ],
    };
  }
  const squares = [];
  for (let k = 1; k <= level; k++) {
    const actual = bitOf(words, k - 1);
    const c = credits[k - 1];
    const square = { level: k, day: c.day, expected: null, actual, status: "ok" };
    squares.push(square);
    if (c.kind === "voucher") {
      square.expected = 0;
      square.status = actual === 0 ? "voucher" : "wrong";
    } else {
      const key = keyByIndex.get(keyIndexFor(c.day, anchorDay));
      if (c.day < anchorDay) square.expected = 0;
      else if (!key) { square.status = "pending"; continue; }
      else if (c.kind === "first" || c.answerByte === 0xff) square.expected = silentBit(key, id);
      else {
        const q = questionByDay.get(c.day);
        if (!q) {
          square.status = "missing";
          problems.push(`square ${k} (day ${c.day}): no question was published for that day`);
          continue;
        }
        const n = q.answers ? q.answers.length : q.range.max - q.range.min + 1;
        square.expected = answerBit({ keyHex: key, n, answer: c.answerByte, tokenId: id });
      }
      if (square.expected !== actual) square.status = "wrong";
    }
    if (square.status === "wrong") {
      problems.push(`square ${k} (day ${c.day}): expected ${square.expected}, the chain holds ${actual}`);
    }
  }

  const ok = problems.length === 0 && squares.every((s) => ["ok", "pending", "voucher"].includes(s.status));
  return { ok, squares, problems };
}
