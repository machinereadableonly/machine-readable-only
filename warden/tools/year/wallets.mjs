// The run's twelve wallets and thirteen identities, made once and never again.
//
//   node tools/year/wallets.mjs
//
// A wallet is an EVM key that pays and owns; an identity is the Ed25519 key the
// door knows an agent by. They are different keys on different curves, and this
// file is the only place that creates either.
//
// NOTHING HERE IS EVER OVERWRITTEN. A key replaced is a token stranded: its
// tokens are bound to the identity that minted them, and its USDC sits at the
// address the old key held. So an existing file is kept and said out loud, and
// the run carries on with what is already there.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { generatePrivateKey } from "viem/accounts";

import { ensureIdentity } from "../../../client/src/index.mjs";
import { addressOf } from "./chain.mjs";
import { yearPaths } from "./runner.mjs";
import { AGENTS } from "./scenario.mjs";

/// One wallet per agent in the table, in the table's order.
export const WALLET_NAMES = AGENTS.map((a) => a.name);

/// A11's rebind needs a SECOND identity: the point of that path is a token
/// moving to a new key, so the new key must exist before the day it is used.
export const REBIND_IDENTITY = "A11b";

export const IDENTITY_NAMES = [...WALLET_NAMES, REBIND_IDENTITY];

/// Owner-only, on the directories as well as the files: a wallet key readable by
/// anyone else on this box is the whole run's money.
function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  // `mode` on mkdirSync applies only when it CREATES, and a directory made by an
  // earlier run under a loose umask keeps whatever mode it had.
  try {
    chmodSync(path, 0o700);
  } catch {
    // A directory somebody else owns cannot be chmodded; each file's own 0600 is
    // the protection that matters, and it is set either way.
  }
}

/**
 * Make what is missing, keep what is there.
 *
 * Returns one row per wallet: `{ name, address, created }`. An address is public
 * and is printed; a key never leaves this process.
 */
export async function createWallets({ paths = yearPaths(), log = console.log } = {}) {
  privateDir(paths.dir);
  privateDir(dirname(paths.wallet("any")));
  privateDir(dirname(paths.identity("any")));

  const made = [];
  for (const name of WALLET_NAMES) {
    const path = paths.wallet(name);
    const created = !existsSync(path);
    if (created) {
      writeFileSync(path, `${generatePrivateKey()}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    const address = addressOf(readFileSync(path, "utf8").trim());
    made.push({ name, address, created });
    log(`${name.padEnd(5)} ${address}  ${created ? "wallet made" : "kept: a key is already there"}`);
  }

  for (const name of IDENTITY_NAMES) {
    const { identity, created } = await ensureIdentity(paths.identity(name));
    log(`${name.padEnd(5)} ${identity.keyId}  ${created ? "identity made" : "kept: an identity is already there"}`);
  }

  const fresh = made.filter((m) => m.created).length;
  log(`${fresh} wallets made, ${made.length - fresh} kept, in ${paths.dir}`);
  return made;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createWallets().catch((err) => {
    console.error("wallets:", err.message);
    process.exitCode = 1;
  });
}
