// The run's one funding pass: a mint's dollar to every agent, and gas to the
// three wallets that send a transaction of their own.
//
//   node tools/year/fund.mjs
//
// Test USDC and test ETH on Base Sepolia, and nothing else. Later purchases are
// not funded here: the runner tops an agent up at the moment a Mark falls due,
// because how much money the run has is a question only answerable then.
//
// IDEMPOTENT, and by shortfall rather than by flat amount. The bank holds 33
// test USDC for the whole year, so a re-run after a half-finished one must not
// send a second dollar to a wallet that already has one.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { addressOf, makeChain } from "./chain.mjs";
import { MINT_USDC, yearPaths } from "./runner.mjs";
import { AGENTS } from "./scenario.mjs";

/// One mint, in USDC's six decimals: what every agent must hold to get through
/// the door once. The runner's own constant, so the bank and the door cannot
/// disagree about the price.
export { MINT_USDC };

/// Gas for a wallet that sends its own transaction. A `rest`, a transfer and a
/// rebind are one write each on Base Sepolia, where a write costs a few hundred
/// gwei; 0.0005 ETH is three orders of magnitude more than that and still a
/// sixtieth of what the deployer holds.
export const GAS_WEI = 500_000_000_000_000n;

/// What the fast Clock keeps for itself. It is the pair's Warden: every mint,
/// credit and Mark of the whole year is written by this one wallet, so funding
/// the agents must never be what empties it.
export const CLOCK_RESERVE_WEI = 5_000_000_000_000_000n;

/**
 * Who needs gas, from the table rather than from a list kept beside it.
 *
 * A wallet needs gas when it SENDS something: the agent that owns an owner
 * action, and the agent an owner action hands the token to -- A11's transfer
 * makes A12 the owner, so it is A12's wallet that sends the rebind.
 */
export function gasRecipients() {
  const names = new Set();
  for (const agent of AGENTS) {
    for (const action of agent.owner ?? []) {
      names.add(agent.name);
      if (action.to) names.add(action.to);
    }
  }
  return AGENTS.map((a) => a.name).filter((name) => names.has(name));
}

const usdc = (amount) => `${Number(amount) / 1e6} USDC`;
const eth = (wei) => `${Number(wei) / 1e18} ETH`;

/**
 * Bring every named wallet up to one mint's worth of USDC.
 *
 * The bank's balance is read once and decremented as it is spent, so a bank that
 * runs out stops sending instead of watching twelve transactions revert. A
 * wallet left short is reported, not fatal: the runner tries the same top-up
 * again when the mint falls due, so USDC arriving later is used.
 */
export async function fundUsdc({ chain, bank, names, addressFor, log = console.log }) {
  let purse = await chain.usdcBalance(bank.address);
  log(`bank    ${bank.address}  holds ${usdc(purse)}`);
  const out = { funded: 0, kept: 0, short: 0 };

  for (const name of names) {
    const to = addressFor(name);
    const have = await chain.usdcBalance(to);
    if (have >= MINT_USDC) {
      out.kept += 1;
      log(`${name.padEnd(5)} ${to}  holds ${usdc(have)}, nothing to send`);
      continue;
    }
    const need = MINT_USDC - have;
    if (purse < need) {
      out.short += 1;
      log(`${name.padEnd(5)} ${to}  SHORT: needs ${usdc(need)}, the bank holds ${usdc(purse)}`);
      continue;
    }
    const receipt = await chain.sendUsdc(bank.key, to, need);
    purse -= need;
    out.funded += 1;
    log(`${name.padEnd(5)} ${to}  sent ${usdc(need)}  ${receipt?.transactionHash ?? ""}`);
  }
  return out;
}

/// Gas to every wallet that sends a transaction, keeping the Clock's reserve.
export async function fundEth({ chain, bank, names, addressFor, log = console.log }) {
  let purse = await chain.ethBalance(bank.address);
  log(`clock   ${bank.address}  holds ${eth(purse)}`);
  const out = { funded: 0, kept: 0, short: 0 };

  for (const name of names) {
    const to = addressFor(name);
    const have = await chain.ethBalance(to);
    if (have >= GAS_WEI) {
      out.kept += 1;
      log(`${name.padEnd(5)} ${to}  holds ${eth(have)}, nothing to send`);
      continue;
    }
    if (purse < GAS_WEI + CLOCK_RESERVE_WEI) {
      out.short += 1;
      log(`${name.padEnd(5)} ${to}  SHORT: the Clock holds ${eth(purse)} and keeps ${eth(CLOCK_RESERVE_WEI)} to write the year`);
      continue;
    }
    const receipt = await chain.sendEth(bank.key, to, GAS_WEI);
    purse -= GAS_WEI;
    out.funded += 1;
    log(`${name.padEnd(5)} ${to}  sent ${eth(GAS_WEI)}  ${receipt?.transactionHash ?? ""}`);
  }
  return out;
}

/// A key file holds one 0x-prefixed private key and nothing else. The error says
/// which file, never what was in it.
function readKey(path, what) {
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`the ${what} key file ${path} does not hold a usable private key`);
  return key;
}

export async function main() {
  const paths = yearPaths();
  // The pair is read rather than assumed: the balances below are testnet USDC,
  // but a wrong contract would fund wallets for a run that does not exist.
  let contract = "";
  try {
    contract = readFileSync(paths.contract, "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!contract) throw new Error(`no contract address at ${paths.contract}: run setup.sh first`);

  const chain = makeChain({ rpcUrl: process.env.BASE_RPC_URL ?? "https://sepolia.base.org", contract });
  const testKey = readKey(process.env.MRO_TEST_WALLET_KEY_FILE ?? join(homedir(), ".mro-test-wallet", "wallet.key"), "test wallet");
  const clockKey = readKey(process.env.MRO_FAST_CLOCK_KEY_FILE ?? join(homedir(), ".mro-fast", "clock.key"), "fast Clock");

  const addresses = new Map();
  const addressFor = (name) => {
    if (!addresses.has(name)) addresses.set(name, addressOf(readKey(paths.wallet(name), name)));
    return addresses.get(name);
  };

  const dollars = await fundUsdc({
    chain, bank: { key: testKey, address: addressOf(testKey) },
    names: AGENTS.map((a) => a.name), addressFor,
  });
  const gas = await fundEth({
    chain, bank: { key: clockKey, address: addressOf(clockKey) },
    names: gasRecipients(), addressFor,
  });

  console.log(`USDC: ${dollars.funded} funded, ${dollars.kept} already held, ${dollars.short} short`);
  console.log(`ETH:  ${gas.funded} funded, ${gas.kept} already held, ${gas.short} short`);
  // A short wallet is recoverable -- the runner retries the top-up -- but it must
  // not read as a clean run.
  if (dollars.short + gas.short > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("fund:", err.message);
    process.exitCode = 1;
  });
}
