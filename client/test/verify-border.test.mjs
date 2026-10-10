// verify-border against a scripted chain. The history is built with the real
// ABI -- inputs with encodeFunctionData, logs with encodeEventTopics and
// encodeAbiParameters -- so a verifier reading the wrong interface fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, stringToHex, concat, getAbiItem } from "viem";
import { verifyBorder, BORDER_ABI } from "../src/verifyBorder.mjs";
import { chainKeys, keyIndexFor, answerBit, silentBit } from "../src/split.mjs";
import { MRO_ABI } from "../../warden/src/clock/abi.mjs";

const CONTRACT = "0x" + "c0".repeat(20);
const SEED = "0x" + "77".repeat(32);
const KEYS = chainKeys(SEED);
const ANCHOR_DAY = 1000;
const MINT_DAY = 1001;
const TOKEN = 1;
const QUESTION = { question: "Fog or thunder?", answers: ["fog", "thunder"] };
// What a Builder Code suffix looks like on the wire: trailing bytes after the call.
const SUFFIX = "0x" + "ab".repeat(16) + "0b" + "8021".repeat(8);

const keyOf = (day) => KEYS[keyIndexFor(day, ANCHOR_DAY)];

function logOf(eventName, args, blockNumber, transactionHash) {
  const item = getAbiItem({ abi: MRO_ABI, name: eventName });
  const indexed = item.inputs.filter((i) => i.indexed);
  const plain = item.inputs.filter((i) => !i.indexed);
  return {
    address: CONTRACT,
    blockNumber: BigInt(blockNumber),
    transactionHash,
    topics: encodeEventTopics({ abi: MRO_ABI, eventName, args: Object.fromEntries(indexed.map((i) => [i.name, args[i.name]])) }),
    data: encodeAbiParameters(plain, plain.map((i) => args[i.name])),
  };
}

/// A token minted on MINT_DAY, then credited once a day. `answers[0]` stands
/// for the mint (always a coin flip); each later entry is that credit's answer
/// index, or null for silence. One Clock run per day: a reveal, then its writes.
function history({ answers, flipBit = null, hideBatch = null, unrevealedLast = false, voucherDays = 0, head = null, logLimit = 1000, logFailure = null }) {
  const logs = [];
  const txs = new Map();
  const bits = [];
  let prevReveal = 0n;
  let revealed = 0;
  const credits = answers.length;
  const lastDay = MINT_DAY + credits - 1;

  for (let k = 0; k < credits; k++) {
    const day = MINT_DAY + k;
    const block = 100 * (k + 1);
    // The run on day + 1 reveals every key through `day`, unless held back.
    const through = unrevealedLast && day === lastDay ? keyIndexFor(day - 1, ANCHOR_DAY) : keyIndexFor(day, ANCHOR_DAY);
    const keys = KEYS.slice(revealed + 1, through + 1);
    const questions = k === 0 ? [] : [{ day, ...QUESTION }];
    const revealHash = `0x${"1".repeat(62)}${k.toString(16).padStart(2, "0")}`;
    const revealArgs = [keys, stringToHex(JSON.stringify(questions))];
    txs.set(revealHash, { hash: revealHash, to: CONTRACT, input: concat([encodeFunctionData({ abi: MRO_ABI, functionName: "revealSplitKeys", args: revealArgs }), SUFFIX]) });
    logs.push(logOf("SplitKeysRevealed", { firstIndex: revealed + 1, keys, prevRevealBlock: prevReveal, questions: revealArgs[1] }, block, revealHash));
    revealed = through;
    prevReveal = BigInt(block);

    const writeHash = `0x${"2".repeat(62)}${k.toString(16).padStart(2, "0")}`;
    if (k === 0) {
      const bit = silentBit(keyOf(day), TOKEN);
      bits.push(bit);
      txs.set(writeHash, { hash: writeHash, to: CONTRACT, input: concat([encodeFunctionData({ abi: MRO_ABI, functionName: "mint", args: [BigInt(TOKEN), "0x" + "11".repeat(20), "0x" + "aa".repeat(32), "0x00", day, bit === 1] }), SUFFIX]) });
      logs.push(logOf("Minted", { id: BigInt(TOKEN), keyId: "0x" + "aa".repeat(32) }, block + 1, writeHash));
    } else {
      const answer = answers[k];
      const bit = answerBit({ keyHex: keyOf(day), n: 2, answer, tokenId: TOKEN });
      bits.push(bit);
      const args = ["0x" + TOKEN.toString(16).padStart(8, "0"), [day], bit ? "0x80" : "0x00", answer === null ? "0xff" : "0x" + answer.toString(16).padStart(2, "0")];
      txs.set(writeHash, { hash: writeHash, to: CONTRACT, input: concat([encodeFunctionData({ abi: MRO_ABI, functionName: "batchCheckIn", args }), SUFFIX]) });
      if (hideBatch !== k) {
        logs.push(logOf("BatchCheckedIn", { fromDay: day, toDay: day, count: 1n }, block + 1, writeHash));
        logs.push(logOf("MetadataUpdate", { _tokenId: BigInt(TOKEN) }, block + 1, writeHash));
      }
    }
  }

  // Voucher credits, after the Warden is gone: no reveal, an empty square, a
  // MetadataUpdate far past the last reveal's run window.
  for (let v = 0; v < voucherDays; v++) {
    const day = MINT_DAY + credits + v;
    const block = 100 * credits + 20_000 + 10 * v;
    const hash = `0x${"3".repeat(62)}${v.toString(16).padStart(2, "0")}`;
    bits.push(0);
    txs.set(hash, { hash, to: CONTRACT, input: encodeFunctionData({ abi: MRO_ABI, functionName: "checkInWithVoucher", args: [BigInt(TOKEN), day, "0x"] }) });
    logs.push(logOf("MetadataUpdate", { _tokenId: BigInt(TOKEN) }, block, hash));
  }
  const level = credits + voucherDays;
  const headBlock = BigInt(head ?? 100 * credits + 30_000);

  if (flipBit !== null) bits[flipBit] ^= 1;
  const words = [0n, 0n];
  bits.forEach((b, i) => { if (b) words[i >> 8] |= 1n << BigInt(i & 255); });

  let wideQueries = 0;
  const client = {
    async readContract({ address, functionName, args }) {
      assert.equal(address, CONTRACT);
      // Every read must be one the inline ABI can make.
      assert.ok(BORDER_ABI.some((e) => e.name === functionName), `${functionName} is not in the inline ABI`);
      if (functionName === "viewOf") return { tokenId: args[0], level, mintDay: MINT_DAY, lastDay: lastDay + voucherDays };
      if (functionName === "answersOf") return words;
      if (functionName === "splitAnchorDay") return ANCHOR_DAY;
      if (functionName === "lastRevealBlock") return prevReveal;
      throw new Error(`unexpected read ${functionName}`);
    },
    async getBlockNumber() { return headBlock; },
    async getLogs({ address, fromBlock, toBlock }) {
      assert.equal(address, CONTRACT);
      // A public RPC refuses a range past its head.
      if (toBlock > headBlock) throw new Error("block range extends beyond current head block");
      assert.ok(toBlock - fromBlock < 1000n, "a public RPC serves at most 1,000 blocks per query");
      // Single-block reads walk the reveals; a failure aimed at the paged scan skips them.
      if (logFailure && toBlock > fromBlock) {
        wideQueries += 1;
        throw logFailure;
      }
      // viem's shape for a node that refuses the width of a log query.
      if (toBlock - fromBlock >= BigInt(logLimit)) {
        throw Object.assign(new Error("RPC Request failed."), { details: `eth_getLogs is limited to a ${logLimit} range` });
      }
      return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    async getTransaction({ hash }) {
      const tx = txs.get(hash);
      if (!tx) throw new Error(`no transaction ${hash}`);
      return tx;
    },
  };
  return { client, contract: CONTRACT, wideQueries: () => wideQueries };
}

test("the inline ABI matches the contract's", () => {
  for (const item of BORDER_ABI) {
    const real = MRO_ABI.find((e) => e.type === item.type && e.name === item.name);
    assert.ok(real, `${item.name} is not in the contract ABI`);
    assert.deepEqual(item, real, `${item.name} differs from the contract ABI`);
  }
});

test("every square of an honest history verifies", async () => {
  const h = history({ answers: [1, null, 0, 1] });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.squares.map((s) => s.status), ["ok", "ok", "ok", "ok"]);
  assert.deepEqual(r.squares.map((s) => s.day), [1001, 1002, 1003, 1004]);
});

test("one wrong bit fails, naming its square", async () => {
  const h = history({ answers: [1, null, 0, 1], flipBit: 2 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.squares[2].status, "wrong");
  assert.match(r.problems.join("\n"), /square 3/);
});

test("a credit it cannot find fails as missing, never as ok", async () => {
  const h = history({ answers: [1, null, 0, 1], hideBatch: 1 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.squares.some((s) => s.status === "missing"));
});

test("a day whose key is not revealed yet is pending, not wrong", async () => {
  const h = history({ answers: [1, null, 0, 1], unrevealedLast: true });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.squares.at(-1).status, "pending");
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("an answered square is judged by the split, not the coin flip", async () => {
  const answers = [1, 0, 1, 0, 1, 1, 0, 0, 1, null, 1, 0];
  // The control: at least one answered day where the two rules disagree, or
  // this test could not tell them apart.
  const differs = answers.some((a, k) => k > 0 && a !== null &&
    answerBit({ keyHex: keyOf(MINT_DAY + k), n: 2, answer: a, tokenId: TOKEN }) !== silentBit(keyOf(MINT_DAY + k), TOKEN));
  assert.ok(differs, "pick answers where the split and the coin flip differ");
  const h = history({ answers });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.squares.length, answers.length);
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

test("the command needs a contract, and never creates an identity", async () => {
  const key = join(mkdtempSync(join(tmpdir(), "mro-vb-")), "identity.json");
  await assert.rejects(
    promisify(execFile)("node", [CLI, "verify-border", "1", "--key", key]),
    (err) => /--contract/.test(err.stderr)
  );
  assert.equal(existsSync(key), false, "no key was made for a read-only command");
});

test("one unfound credit never accuses another square of being wrong", async () => {
  const h = history({ answers: [1, 1, 0, 0, 1, 0], hideBatch: 2 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, false);
  assert.ok(!r.squares.some((s) => s.status === "wrong"), JSON.stringify(r.squares.map((s) => s.status)));
  assert.match(r.problems.join("\n"), /found 5 credits for a token at level 6/);
});

test("a run that wrote moments ago is scanned only up to the chain's head", async () => {
  const h = history({ answers: [1, null, 0], head: 100 * 3 + 50 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("voucher credits after the Warden is gone are found and reported as voucher days", async () => {
  const h = history({ answers: [1, null, 0], voucherDays: 2 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.squares.map((s) => s.status), ["ok", "ok", "ok", "voucher", "voucher"]);
});

test("a node that serves fewer blocks per query is paged narrower, not failed", async () => {
  const h = history({ answers: [1, null, 0], voucherDays: 2, logLimit: 500 });
  const r = await verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.squares.map((s) => s.status), ["ok", "ok", "ok", "voucher", "voucher"]);
});

test("a log query failing for another reason is not mistaken for a narrow node", async () => {
  const h = history({ answers: [1, null, 0], logFailure: new Error("socket hang up") });
  await assert.rejects(verifyBorder({ publicClient: h.client, contract: h.contract, tokenId: 1 }), /socket hang up/);
  assert.equal(h.wideQueries(), 1, "the page was retried narrower instead of failing");
});

test("the command refuses an RPC that serves a different chain from the one asked for", async () => {
  const { createServer } = await import("node:http");
  // A JSON-RPC node that is Base Sepolia.
  const node = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const { id } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x14a34" }));
    });
  });
  await new Promise((resolve) => node.listen(0, "127.0.0.1", resolve));
  const rpc = `http://127.0.0.1:${node.address().port}/v2/secret-api-key`;
  const key = join(mkdtempSync(join(tmpdir(), "mro-vb-")), "identity.json");
  try {
    await assert.rejects(
      promisify(execFile)("node", [CLI, "verify-border", "1", "--contract", "0x" + "c0".repeat(20), "--rpc", rpc, "--key", key]),
      (err) => /serves chain 84532, not 8453; pass --chain 84532/.test(err.stderr) && !err.stderr.includes("secret-api-key"),
    );
  } finally {
    node.close();
  }
});
