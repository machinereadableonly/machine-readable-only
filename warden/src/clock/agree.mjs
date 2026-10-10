// A reader that believes a chain fact only when two independent RPCs agree on
// it. The Clock signs with whatever its RPC tells it, so any read that closes a
// row without a receipt, proves a binding or proves a payment goes through here.
// Disagreement throws, which every caller already treats as "could not ask".

const plain = (value) =>
  JSON.stringify(value, (key, v) => (typeof v === "bigint" ? v.toString() : v));

/// What a receipt says that matters: whether it succeeded, and its logs.
const receiptFacts = (r) => r && {
  status: r.status,
  logs: (r.logs ?? []).map((l) => ({
    address: String(l.address).toLowerCase(),
    logIndex: Number(l.logIndex),
    topics: l.topics,
    data: l.data,
  })),
};

/// viewOf carries the reading node's own `today`, which two nodes a block apart
/// may answer differently without either lying.
const readFacts = (params, value) => {
  if (params.functionName !== "viewOf" || value === null || typeof value !== "object") return value;
  const { today, ...rest } = value;
  return rest;
};

export function agreeingClient(primary, secondary) {
  if (!secondary) return primary;
  const both = async (ask, facts) => {
    const [a, b] = await Promise.all([ask(primary), ask(secondary)]);
    if (plain(facts(a)) !== plain(facts(b))) throw new Error("the two RPCs disagree");
    return a;
  };
  return {
    readContract: (params) => both((c) => c.readContract(params), (v) => readFacts(params, v)),
    getTransactionReceipt: (params) => both((c) => c.getTransactionReceipt(params), receiptFacts),
  };
}
