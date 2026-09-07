// Does the ABI this repository carries actually describe the contract that is
// on chain? Run it AFTER a deploy, before anything is pointed at the address.
//
//   cd warden && node tools/check-deployed-abi.mjs <token-address> [rpc]
//
// Exits 0 only when every check passes, and non-zero otherwise, so it can gate
// a deploy rather than be eyeballed -- the same rule tools/read-ladder.mjs
// follows.
//
// WHY THIS EXISTS, twice over.
//
// (1) BASESCAN VERIFICATION PROVES THE SOURCE, NOT THE INTERFACE. On 2026-09-02
// every Mark was unwritable on a verified contract, because the deployed
// `applyMark` took three arguments and the ABI in this repository said two. The
// only thing that found it was reading the runtime bytecode. A verified badge
// on the explorer would not have.
//
// (2) A DECODER THAT DISAGREES WITH THE CHAIN NOW FAILS SILENTLY. chain/read.mjs
// decodes `viewOf` by name through the generated ABI and returns null when the
// decode throws -- the same null a dead RPC produces -- so skew reaches an agent
// as `chain-unavailable` on `mint`, `status`, `/t/<id>` and `freeIdFrom`, with
// nothing in any log. chain/preflight.mjs refuses to boot on it now; this is the
// check that runs before the boot is even attempted.
//
// The selectors are COMPUTED FROM THE ABI and looked for in the runtime
// bytecode, rather than typed in here. A hand-written list would pin what
// somebody believed on the day they wrote it, which is the same failure with a
// later date.
import { decodeFunctionResult, toFunctionSelector, getAddress } from "viem";
import { MRO_ABI } from "../src/clock/abi.mjs";

const address = process.argv[2];
const rpc = process.argv[3] ?? "https://sepolia.base.org";
if (!address) {
  console.error("usage: check-deployed-abi.mjs <token-address> [rpc]");
  process.exit(2);
}

/// One JSON-RPC call. Throws on any failure: this is an operator tool run by
/// hand, so an unreachable endpoint must stop it rather than read as a pass.
async function call(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const problems = [];
const note = (line) => { problems.push(line); console.log(`  MISMATCH: ${line}`); };

const token = getAddress(address);
console.log(`contract  ${token}`);
console.log(`rpc       ${new URL(rpc).host}`);
console.log("");

// --- 1. every function this repository believes in is in the bytecode -------
//
// A public function's selector appears in the dispatcher as a PUSH4 immediate,
// so its 4 bytes are present in the runtime code. Absence is conclusive;
// presence is all but (a coincidental 4-byte run is possible in principle and
// has never once been the explanation).
const code = await call("eth_getCode", [token, "latest"]);
if (!code || code === "0x") {
  console.error(`FAIL: there is no contract code at ${token}`);
  process.exit(1);
}
console.log(`runtime bytecode: ${(code.length - 2) / 2} bytes`);

const fns = MRO_ABI.filter((e) => e.type === "function");
const hex = code.slice(2).toLowerCase();
let found = 0;
for (const fn of fns) {
  const selector = toFunctionSelector(fn).slice(2).toLowerCase();
  if (hex.includes(selector)) {
    found += 1;
    continue;
  }
  const sig = `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`;
  note(`0x${selector} ${sig} is in the ABI and NOT in the deployed bytecode`);
}
console.log(`selectors: ${found} of ${fns.length} ABI functions present in the runtime code`);

// The two the lineage work added, named explicitly so a regression reads as a
// sentence rather than as a count that went down by one.
for (const name of ["seed", "echoOf"]) {
  const fn = fns.find((f) => f.name === name);
  if (!fn) { note(`${name} is not in warden/src/clock/abi.mjs at all -- run tools/gen-abi.mjs`); continue; }
  const sig = `${name}(${fn.inputs.map((i) => i.type).join(",")})`;
  const selector = toFunctionSelector(fn);
  console.log(`  ${selector} ${sig} ${hex.includes(selector.slice(2).toLowerCase()) ? "present" : "ABSENT"}`);
}

// --- 2. viewOf decodes, under this ABI, off this chain ----------------------
//
// The shape check, not a selector check. This is the exact call chain/read.mjs
// makes on every gate decision, so a pass here is a pass there.
const VIEW_OF = toFunctionSelector(fns.find((f) => f.name === "viewOf"));
const probeId = 1n;
const raw = await call("eth_call", [
  { to: token, data: VIEW_OF + probeId.toString(16).padStart(64, "0") },
  "latest",
]);
let view = null;
try {
  view = decodeFunctionResult({ abi: MRO_ABI, functionName: "viewOf", data: raw });
  console.log(`viewOf(${probeId}) decoded: ${Object.keys(view).length} fields, level ${view.level}, echo ${view.echo}`);
} catch (err) {
  note(`viewOf(${probeId}) does NOT decode under this ABI: ${err.shortMessage ?? err.message}`);
}
// viewOf echoes the id it was asked for, so this catches a return that decoded
// but whose fields have slid -- a decode that succeeds is not proof on its own.
if (view && BigInt(view.tokenId) !== probeId) {
  note(`viewOf(${probeId}) decoded but reported tokenId ${view.tokenId}`);
}

// --- 3. echoOf and viewOf.echo are the same number --------------------------
//
// Two independent paths to one value: the standalone reader and the field
// inside the struct. If the struct has slid by a field, these disagree, and
// that disagreement is visible without needing a token that carries an Echo.
const echoFn = fns.find((f) => f.name === "echoOf");
const ECHO_OF = echoFn ? toFunctionSelector(echoFn) : null;
if (ECHO_OF && hex.includes(ECHO_OF.slice(2).toLowerCase())) {
  // The call is wrapped because a contract without the function reverts rather
  // than answering, and a revert here is a FINDING, not a reason to abandon the
  // run with a stack trace -- the whole point is a summary an operator can act
  // on. Measured against the 2026-09-06 deployment, which has no echoOf:
  // eth_call answered "execution reverted".
  try {
    const echoRaw = await call("eth_call", [
      { to: token, data: ECHO_OF + probeId.toString(16).padStart(64, "0") },
      "latest",
    ]);
    const standalone = BigInt(echoRaw);
    console.log(`echoOf(${probeId}) = ${standalone}`);
    if (view && standalone !== BigInt(view.echo)) {
      note(`echoOf says ${standalone} but viewOf.echo says ${view.echo} -- the struct has slid`);
    }
  } catch (err) {
    note(`echoOf(${probeId}) could not be read: ${err.message}`);
  }
} else if (ECHO_OF) {
  console.log(`echoOf: not in the bytecode, so there is nothing to cross-check against viewOf.echo`);
}

console.log("");
if (problems.length === 0) {
  console.log("The deployed contract matches the ABI in this repository.");
  process.exit(0);
}
console.log(`${problems.length} mismatch(es) -- do NOT point the Warden or the Clock at this deployment.`);
process.exit(1);
