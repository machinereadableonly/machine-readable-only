// Seed a SCRATCH mirror for the mainnet-fork rehearsal's Clock steps. TEST-ONLY.
//
//   node tools/mainnet-fork-clock.mjs seed-mint   --db <path> --token <id> --to <addr> --day <n> --domain <d>
//   node tools/mainnet-fork-clock.mjs seed-credit --db <path> --token <id> --day <n>
//   node tools/mainnet-fork-clock.mjs seed-mark   --db <path> --token <id> --mark <1-10>
//
// Called by tools/mainnet-fork-rehearsal.sh, which then runs the REAL Clock
// entrypoint (src/clock/main.mjs) against a local fork of Base mainnet.
//
// A PAID MINT IS SEEDED THROUGH THE REAL PATH, not with hand-written SQL: the
// same three calls tools/mint.mjs makes inside one transaction (insertMint,
// insertToken, setTokenAwaitingPayment), then settleByNonce -- what the payment
// hook does when money moves -- then completeSolve, what the solver does. So a
// schema or reservation change breaks this the way it would break production.
// Its Sepolia predecessor, clock-rehearsal.mjs (and its wrapper rehearse.sh),
// predated the reservation model and called insertMint without a nonce; it
// was retired on 2026-09-15 at the operator's decision.
//
// SCRATCH ONLY. It seeds rows no agent paid for, so it refuses any database
// that is not inside a rehearsal work directory -- never the Warden's mirror,
// never the fast copy's.
import { basename, dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { robustSolveFor } from "../../tools/robust-solve.mjs";
import { packModules } from "../../tools/qart.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i]?.startsWith("--")) throw new Error(`expected a --flag, got ${rest[i]}`);
  args[rest[i].slice(2)] = rest[i + 1];
}

const dbPath = resolve(args.db ?? "");
if (!basename(dirname(dbPath)).startsWith("mro-mainnet-rehearsal.")) {
  throw new Error(`refusing ${dbPath}: seeded rows belong only in a mro-mainnet-rehearsal.* work directory`);
}
const need = (name) => {
  if (args[name] === undefined) throw new Error(`--${name} is required for ${command}`);
  return args[name];
};
const q = queries(openDb(dbPath));
const tokenId = Number(need("token"));

if (command === "seed-mint") {
  const to = need("to");
  const day = Number(need("day"));
  const domain = need("domain");
  // One agent key per token: the contract allows ONE MINT PER KEY.
  const keyId = `mainnet-rehearsal-key-${tokenId}`;
  const payNonce = `0x${randomBytes(32).toString("hex")}`;

  q.transact(() => {
    q.insertMint({ tokenId, toAddress: to, keyId, payNonce });
    q.insertToken({ tokenId, keyId, owner: to, lastDay: day, mintDay: day });
    q.setTokenAwaitingPayment(tokenId);
  });
  const moved = q.settleByNonce(payNonce, `0x${"00".repeat(32)}`);
  if (moved?.kind !== "mint" || moved.tokenId !== tokenId) {
    throw new Error(`settlement did not promote mint ${tokenId}: ${JSON.stringify(moved)}`);
  }

  // The artwork, solved for the REAL domain: a mainnet token's QR encodes
  // https://<domain>/t/<id> permanently.
  const solved = robustSolveFor(domain, tokenId);
  const packed = packModules(solved.modules, solved.size);
  q.completeSolve(tokenId, Buffer.from(packed).toString("hex"));

  const pending = q.pendingMints().map((m) => m.tokenId);
  if (!pending.includes(tokenId)) throw new Error(`mint ${tokenId} is not pending after seeding: ${JSON.stringify(pending)}`);
  console.log(`seeded paid mint ${tokenId} for ${to} on day ${day}; artwork solved for ${domain} (mask ${solved.mask}); pending: ${pending.join(",")}`);
} else if (command === "seed-credit") {
  const day = Number(need("day"));
  q.insertCredit(tokenId, day, "mainnet-rehearsal");
  console.log(`seeded a check-in for token ${tokenId} on day ${day}`);
} else if (command === "seed-mark") {
  const mark = Number(need("mark"));
  if (!q.reserveMark(tokenId, mark, 0)) throw new Error(`mark ${mark} was not reserved for token ${tokenId}`);
  console.log(`seeded Mark ${mark} for token ${tokenId}`);
} else {
  throw new Error(`unknown command ${command}: seed-mint | seed-credit | seed-mark`);
}
