// Read the ten Mark records off a deployed contract and check them against the
// numbers the spec fixes, decoded properly rather than parsed out of cast's
// text. Run from warden/ so viem resolves:
//   node ../contracts/script/read-ladder.mjs <address> [rpc]
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const address = process.argv[2];
const rpc = process.argv[3] ?? "https://sepolia.base.org";
if (!address) throw new Error("usage: read-ladder.mjs <address> [rpc]");

const abi = [{
  type: "function", name: "upgradeOf", stateMutability: "view",
  inputs: [{ name: "upgradeId", type: "uint8" }],
  outputs: [{
    type: "tuple", components: [
      { name: "priceUsdc6", type: "uint64" },
      { name: "maxSupply", type: "uint32" },
      { name: "sold", type: "uint32" },
      { name: "minLevel", type: "uint32" },
      { name: "minStreak", type: "uint32" },
      { name: "requiresWhole", type: "bool" },
      { name: "active", type: "bool" },
      { name: "excludes", type: "uint16" },
      { name: "requiresAny", type: "uint16" },
    ],
  }],
}];

// The ladder as the design document fixes it: five pairs, one bought and one
// earned in four of them, pair five bought on both sides and gated on an Iris.
// Price in USDC 6dp; the earned sides are free and gated on a RUN.
const EXPECT = [
  null,
  { name: "hush",        price: 1_000_000n,     minLevel: 0,   minStreak: 0,   excludes: 2 },
  { name: "ache",        price: 0n,             minLevel: 0,   minStreak: 7,   excludes: 1 },
  { name: "static",      price: 5_000_000n,     minLevel: 30,  minStreak: 0,   excludes: 4 },
  { name: "beat",        price: 0n,             minLevel: 0,   minStreak: 30,  excludes: 3 },
  { name: "iris-bought", price: 25_000_000n,    minLevel: 100, minStreak: 0,   excludes: 6 },
  { name: "iris-earned", price: 0n,             minLevel: 0,   minStreak: 100, excludes: 5 },
  { name: "vessel",      price: 1_250_000_000n, minLevel: 0,   minStreak: 0,   excludes: 8 },
  { name: "break",       price: 0n,             minLevel: 0,   minStreak: 365, excludes: 7 },
  { name: "tint",        price: 250_000_000n,   minLevel: 0,   minStreak: 0,   excludes: 10 },
  { name: "aura",        price: 25_000_000n,    minLevel: 0,   minStreak: 0,   excludes: 9 },
];

const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
let bad = 0;

console.log("id  name          price USDC     minLevel  minStreak  excludes  requiresAny  active");
for (let id = 1; id <= 10; id += 1) {
  const u = await client.readContract({ address, abi, functionName: "upgradeOf", args: [id] });
  const want = EXPECT[id];
  const usd = (Number(u.priceUsdc6) / 1e6).toFixed(2);
  const excludesId = Math.log2(Number(u.excludes));
  const problems = [];
  if (u.priceUsdc6 !== want.price) problems.push(`price ${u.priceUsdc6} != ${want.price}`);
  if (u.minLevel !== want.minLevel) problems.push(`minLevel ${u.minLevel} != ${want.minLevel}`);
  if (u.minStreak !== want.minStreak) problems.push(`minStreak ${u.minStreak} != ${want.minStreak}`);
  if (excludesId !== want.excludes) problems.push(`excludes bit ${excludesId} != ${want.excludes}`);
  if (!u.active) problems.push("NOT ACTIVE");
  if (problems.length) bad += 1;

  console.log(
    `${String(id).padEnd(3)} ${want.name.padEnd(13)} ${usd.padStart(12)}  ${String(u.minLevel).padStart(8)}  ` +
    `${String(u.minStreak).padStart(9)}  ${String(excludesId).padStart(8)}  ${String(u.requiresAny).padStart(11)}  ${u.active}` +
    (problems.length ? `   <-- ${problems.join("; ")}` : "")
  );
}

console.log("");
console.log(bad === 0
  ? "All ten Marks match the design document."
  : `${bad} Mark(s) DO NOT match -- do not use this deployment.`);
process.exit(bad === 0 ? 0 : 1);
