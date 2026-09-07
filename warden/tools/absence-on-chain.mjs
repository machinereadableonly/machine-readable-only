// Does the DEPLOYED Renderer implement C4.10?
//
//   node tools/absence-on-chain.mjs <renderer address> [rpc]
//
// No token can answer this yet: the rule needs a gap of 30 or 365 days and the
// contract's own today() is the only clock, so a real token cannot be aged. But
// Renderer.svg takes a TokenView as an ARGUMENT, so the deployed library can be
// asked directly what it draws for a token that has been away -- which is the
// difference between "the constants are in the source" and "the constants are
// on the chain".
//
// Reading the bytecode for the colour strings does NOT work and was tried
// first: short Solidity constants are not stored as plain ASCII runs, and the
// controls (#ffffff, #f4eef0, both certainly present) came back missing too.
// A method whose controls fail is measuring nothing.
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const address = process.argv[2];
const rpc = process.argv[3] ?? "https://sepolia.base.org";
if (!address) throw new Error("usage: absence-on-chain.mjs <renderer> [rpc]");

// THIS LIST MUST TRACK contracts/src/render/TokenView.sol FIELD FOR FIELD, and
// nothing here can tell you when it has drifted. `svg` takes the struct as an
// ARGUMENT, so its selector is derived from this component list: the Echo field
// moved it from 0xe6c54f9a to 0x91321088, and a stale copy does not decode
// wrongly, it calls a function the deployed library does not have. (`viewOf` is
// the opposite case and is why the two got confused: it takes a `uint256` and
// returns the struct, so its selector 0x0fa4edbd did NOT move -- only the
// caller's return DECODER did.)
const VIEW = {
  type: "tuple",
  components: [
    { name: "tokenId", type: "uint256" }, { name: "level", type: "uint32" },
    { name: "streak", type: "uint32" }, { name: "lastDay", type: "uint32" },
    { name: "mintDay", type: "uint32" }, { name: "generation", type: "uint32" },
    { name: "seedsGiven", type: "uint32" }, { name: "parent", type: "uint256" },
    { name: "echo", type: "uint32" },
    { name: "resting", type: "bool" }, { name: "sunset", type: "bool" },
    { name: "sunsetDay", type: "uint32" }, { name: "fellRun", type: "uint16" },
    { name: "fellDay", type: "uint24" }, { name: "marks", type: "uint256" },
    { name: "agentKeyId", type: "bytes32" }, { name: "code", type: "bytes" },
    { name: "today", type: "uint32" },
  ],
};
const abi = [{ type: "function", name: "svg", stateMutability: "view", inputs: [VIEW], outputs: [{ type: "string" }] }];

const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

// A token that minted on day 1000 and never came back, seen at four ages.
const view = (gap, extra = {}) => ({
  tokenId: 1n, level: 1, streak: 1, lastDay: 1000, mintDay: 1000, generation: 0,
  seedsGiven: 0, parent: 0n, echo: 0, resting: false, sunset: false, sunsetDay: 0,
  fellRun: 0, fellDay: 0, marks: 0n,
  agentKeyId: "0x" + "00".repeat(32), code: "0x" + "00".repeat(172),
  today: 1000 + gap, ...extra,
});

const page = (svg) => (svg.match(/<rect width="\d+" height="\d+" fill="(#[0-9a-f]{6})"/) ?? [])[1];

const cases = [
  ["live, gap 0", view(0), "#ffffff"],
  ["gap 29, still fresh", view(29), "#ffffff"],
  ["gap 30, half way", view(30), "#f3f3f3"],
  ["gap 364, still half", view(364), "#f3f3f3"],
  ["gap 365, cold", view(365), "#e6e6e6"],
  ["gap 3 years, cold", view(365 * 3), "#e6e6e6"],
  ["rested after 3 years", view(365 * 3, { resting: true }), "#ffffff"],
  ["aura, gap 365", view(365, { marks: 1n << 10n }), "#e2d6d9"],
];

let bad = 0;
for (const [label, v, want] of cases) {
  const svg = await client.readContract({ address, abi, functionName: "svg", args: [v] });
  const got = page(svg);
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(22)} page ${got}  ${ok ? "" : `expected ${want}`}`);
}

console.log("");
console.log(bad === 0
  ? "C4.10 is ON THE CHAIN: the deployed Renderer cools the page with absence."
  : `${bad} case(s) disagree -- the deployed Renderer is not this build.`);
process.exit(bad === 0 ? 0 : 1);
