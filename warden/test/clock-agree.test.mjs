// A chain fact the Clock acts on without a receipt must come from two RPCs
// that agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agreeingClient } from "../src/clock/agree.mjs";
import { markIsOnChain } from "../src/clock/run.mjs";

const node = ({ view = {}, receipt = null } = {}) => ({
  async readContract() { return view; },
  async getTransactionReceipt() { return receipt; },
});
const VIEW = { level: 3, marks: 2n, agentKeyId: "0xab", today: 100 };

test("with no second RPC the reader is the first one, unchanged", () => {
  const one = node();
  assert.equal(agreeingClient(one, null), one);
});

test("two RPCs that agree are believed", async () => {
  const c = agreeingClient(node({ view: VIEW }), node({ view: { ...VIEW } }));
  assert.deepEqual(await c.readContract({ functionName: "viewOf" }), VIEW);
});

test("two RPCs that disagree are not believed", async () => {
  const c = agreeingClient(node({ view: VIEW }), node({ view: { ...VIEW, agentKeyId: "0xcd" } }));
  await assert.rejects(() => c.readContract({ functionName: "viewOf" }), /disagree/);
});

test("viewOf's own today may differ between nodes a block apart", async () => {
  const c = agreeingClient(node({ view: VIEW }), node({ view: { ...VIEW, today: 101 } }));
  assert.deepEqual(await c.readContract({ functionName: "viewOf" }), VIEW);
});

test("a receipt one RPC invented is not believed", async () => {
  const real = { status: "success", logs: [{ address: "0xA", logIndex: 3, topics: ["0x1"], data: "0x" }] };
  const forged = { status: "success", logs: [...real.logs, { address: "0xA", logIndex: 4, topics: ["0x2"], data: "0x05" }] };
  await assert.rejects(() => agreeingClient(node({ receipt: forged }), node({ receipt: real })).getTransactionReceipt({ hash: "0x" }), /disagree/);
  const same = await agreeingClient(node({ receipt: real }), node({ receipt: { ...real, blockHash: "0xother" } })).getTransactionReceipt({ hash: "0x" });
  assert.equal(same.status, "success");
});

test("a Mark the chain does not show is not on chain", async () => {
  assert.equal(await markIsOnChain({ publicClient: node({ view: { marks: 1n << 7n } }), contract: "0x", tokenId: 1, upgradeId: 7 }), true);
  assert.equal(await markIsOnChain({ publicClient: node({ view: { marks: 0n } }), contract: "0x", tokenId: 1, upgradeId: 7 }), false);
  assert.equal(await markIsOnChain({ publicClient: { readContract: async () => { throw new Error("down"); } }, contract: "0x", tokenId: 1, upgradeId: 7 }), false);
});
