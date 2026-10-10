// D2: real mainnet is --prepare on the VPS, then --ledger on the PC. No hot
// mainnet key is ever read; each refusal below fires before any network call.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../contracts/script/deploy-mainnet.sh", import.meta.url));
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

function run(args) {
  const env = { PATH: `${homedir()}/.foundry/bin:${process.env.PATH}`, HOME: homedir() };
  const r = spawnSync("bash", [SCRIPT, "--warden", A, "--owner", B, "--signers", `${A},${B}`, ...args], { env, encoding: "utf8", timeout: 30_000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("a real run with neither half named is refused: no hot key path exists", () => {
  const r = run([]);
  assert.equal(r.code, 1);
  assert.match(r.out, /--prepare on the VPS, then --ledger on the PC/);
});

test("--prepare never broadcasts", () => {
  assert.match(run(["--prepare", "--deployer", A, "--broadcast"]).out, /--prepare sends nothing/);
});

test("the two halves are never run together, and a fork takes neither", () => {
  assert.match(run(["--prepare", "--ledger", "--deployer", A]).out, /run one at a time/);
  assert.match(run(["--fork", "http://127.0.0.1:8545", "--ledger"]).out, /takes neither --prepare nor --ledger/);
});

test("--ledger needs the Ledger address, the anchor and the prepared commit", () => {
  assert.match(run(["--ledger"]).out, /--deployer must be the Ledger's address/);
  assert.match(run(["--ledger", "--deployer", A]).out, /--anchor must be/);
  assert.match(run(["--ledger", "--deployer", A, "--anchor", "0x" + "ab".repeat(32)]).out, /--commit must be/);
  assert.match(run(["--ledger", "--deployer", A, "--anchor", "0x" + "ab".repeat(32), "--commit", "0".repeat(40)]).out, /--hd-path must be/);
  const wrong = run(["--ledger", "--deployer", A, "--anchor", "0x" + "ab".repeat(32), "--commit", "0".repeat(40), "--hd-path", "m/44'/60'/1'/0/0"]);
  assert.match(wrong.out, /this checkout is not at 0{40}/);
});

test("the Ledger signs the broadcast, and no environment file is read for a key", () => {
  const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
  assert.ok(src.includes('${LEDGER:+--ledger --mnemonic-derivation-paths "$HD_PATH" --sender "$DEPLOYER"}'));
  assert.doesNotMatch(src, /\. \.\/\.env/);
});
