// The two questions that must be answered BEFORE this service listens.
//
// Both are configuration checks that no amount of testnet running can surface,
// because the thing they guard against only exists at a mainnet cutover. They
// live here rather than in main.mjs because main.mjs cannot be imported -- it
// reads a private key and opens a chain as a side effect of module load -- so
// anything written there is untestable by construction.
//
// Nothing here holds a signer. Both are eth_call / eth_chainId reads.
import { getDefaultAsset } from "@x402/evm";
import { decodeFunctionResult } from "viem";
import { MRO_ABI } from "../clock/abi.mjs";
import { safeErrorText } from "../clock/redact.mjs";
import { DAY_MS, utcDay, dayMismatch } from "../day.mjs";

const TIMEOUT_MS = 5000;
/// balanceOf(address) -> uint256
const BALANCE_OF = "0x70a08231";

/// One JSON-RPC call. Returns the result, or null on ANY failure -- a null is
/// always "could not ask", never an answer.
async function rpc(rpcUrl, method, params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  if (body.error || typeof body.result !== "string") return null;
  return body.result;
}

/**
 * The chain id the RPC endpoint actually serves, or null if it could not be
 * asked.
 */
export async function readChainId({ rpcUrl, fetchImpl = fetch }) {
  const hex = await rpc(rpcUrl, "eth_chainId", [], fetchImpl);
  if (hex === null) return null;
  const id = Number.parseInt(hex, 16);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Refuse to start unless MRO_CHAIN_ID is the chain BASE_RPC_URL serves.
 *
 * WHY THIS EXISTS. `MRO_CHAIN_ID` was the only input to two decisions that
 * cannot be undone: whether a placeholder treasury is allowed to run (it is on
 * Base Sepolia and nowhere else), and what network agents are quoted prices on
 * (`eip155:${chainId}`, the CAIP-2 the payment is bound to). Nothing checked it
 * against reality. A deploy that points `BASE_RPC_URL` and
 * `MRO_CONTRACT_ADDRESS` at mainnet and leaves `MRO_CHAIN_ID=84532` behind --
 * the single most likely copy-paste error in promoting this service -- starts
 * cleanly, logs "payment ready", quotes testnet USDC to a burn address, and
 * writes real mainnet tokens. The mismatch is published to agents at
 * mro://contract too, so it is broadcast rather than merely internal.
 *
 * TWO FAILURES, TREATED DIFFERENTLY, and the difference is the whole design.
 *
 * A MISMATCH is a fact. It cannot become true by asking again, so it throws on
 * the first answer and no retry is attempted.
 *
 * AN UNREADABLE RPC is a transient, and it still refuses -- after `attempts`
 * tries. That is a deliberate trade: it means an RPC outage at exactly the
 * wrong moment keeps this service down rather than up. Running on an unverified
 * chain id is the failure that takes money to the wrong network permanently;
 * being down is the failure that ends when the RPC answers. The gates already
 * refuse every write while the RPC is unreadable (`writesOpen` -> "unreadable"),
 * so a Warden that cannot reach the chain can sell nothing anyway.
 */
export async function verifyChainId({
  rpcUrl,
  chainId,
  attempts = 3,
  delayMs = 1000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.error,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const actual = await readChainId({ rpcUrl, fetchImpl });
    if (actual !== null) {
      if (actual !== chainId) {
        throw new Error(
          `MRO_CHAIN_ID is ${chainId} but BASE_RPC_URL serves chain ${actual}: ` +
            "these must be the same chain -- the id decides the payment network agents are quoted " +
            "and whether a placeholder treasury is allowed to run"
        );
      }
      return actual;
    }
    log(`warden: could not read the chain id from BASE_RPC_URL (attempt ${attempt} of ${attempts})`);
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(
    `BASE_RPC_URL did not answer eth_chainId in ${attempts} attempts: refusing to start rather than ` +
      `trust an unverified MRO_CHAIN_ID of ${chainId}`
  );
}

/**
 * The treasury's USDC balance, as a decimal string, or null if it could not be
 * read.
 *
 * NOT A GATE -- it never throws and never stops the boot. It exists so the
 * first settlement is visibly attributable: `TREASURY_ADDRESS` is validated for
 * shape and checksum and nothing else, so a mistyped-but-valid address takes
 * every dollar the piece ever earns to somewhere nobody controls, and the
 * service would report each of those settlements as a success. A balance
 * printed at every boot is the cheapest thing that makes that visible.
 *
 * The asset comes from @x402/evm's own table, keyed by the same CAIP-2 network
 * string the payment is bound to, so this reads the token x402 will actually
 * settle in rather than an address copied into this file.
 */
export async function treasuryBalance({ network, treasury, rpcUrl, fetchImpl = fetch }) {
  let asset;
  try {
    asset = getDefaultAsset(network, "USDC");
  } catch {
    return null;
  }
  if (!asset?.asset) return null;
  const data = BALANCE_OF + treasury.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const hex = await rpc(rpcUrl, "eth_call", [{ to: asset.asset, data }, "latest"], fetchImpl);
  if (hex === null) return null;
  let raw;
  try {
    raw = BigInt(hex);
  } catch {
    return null;
  }
  const unit = 10n ** BigInt(asset.decimals);
  const whole = raw / unit;
  const frac = (raw % unit).toString().padStart(asset.decimals, "0").slice(0, 2);
  return { amount: `${whole}.${frac}`, symbol: asset.symbol, asset: asset.asset };
}

// ---------------------------------------------------------------------------
// The third boot-time check: can this build decode what the chain returns?
// ---------------------------------------------------------------------------

/// viewOf(uint256) -> TokenView. The same selector chain/read.mjs calls.
const VIEW_OF = "0x0fa4edbd";

/**
 * Refuse to start unless one real `viewOf` return decodes under the ABI this
 * build carries.
 *
 * WHY THIS EXISTS. `chain/read.mjs` decodes `viewOf` by NAME through the
 * generated ABI, and its decode `catch` returns null -- the same null a dead
 * RPC produces. So an ABI that disagrees with the deployed contract is
 * INDISTINGUISHABLE FROM AN OUTAGE at every call site: `boundKeyOf`,
 * `lifecycleOf`, `freeIdFrom` and therefore `mint`, `status` and `/t/<id>` all
 * answer `chain-unavailable`, forever, with nothing in any log saying why. That
 * is worse than the index-decoder defect it replaced, which broke only
 * `upgrade` and `seed`.
 *
 * Skew is a property of the pair (this build, that address), so it is knowable
 * at boot and cannot heal. Asking once at startup turns a permanent silent
 * refusal into a loud one, before the socket is bound.
 *
 * NO TOKEN NEEDS TO EXIST. `viewOf` does not revert on an unminted id -- it
 * reads storage that is zero and returns a fully-formed TokenView
 * (MachineReadableOnly.sol:198) -- so the probe exercises the ENCODING on a
 * freshly deployed contract with nothing minted, which is exactly the state a
 * redeploy boots into. An address with no code at all answers "0x", and viem
 * throws AbiDecodingZeroDataError on that, which is the answer we want anyway:
 * a contract address pointing at nothing is not a chain this service may serve.
 *
 * TWO FAILURES, TREATED DIFFERENTLY, the same way verifyChainId treats its two.
 * A decode failure is a FACT about two files and cannot become true by asking
 * again, so it throws on the first answer. An unreadable RPC is a transient and
 * is retried, then refused -- by the time this runs verifyChainId has already
 * had an answer out of the same endpoint, so silence here is new.
 *
 * NOTHING LOGGED HERE CARRIES THE RPC URL. Measured on the installed viem
 * 2.56.0 against all three decode failures this can produce
 * (AbiDecodingZeroDataError, PositionOutOfBoundsError, IntegerOutOfRangeError):
 * none carries a url and `metaMessages` is undefined on all three, because the
 * call is made by hand with fetch and viem never sees the endpoint. The text is
 * put through `safeErrorText` regardless -- the guarantee should hold for the
 * error viem adds next, not only for the three that exist today. See
 * clock/redact.mjs.
 */
export async function verifyDecoder({
  rpcUrl,
  contract,
  tokenId = 1,
  abi = MRO_ABI,
  attempts = 3,
  delayMs = 1000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.error,
}) {
  const data = VIEW_OF + BigInt(tokenId).toString(16).padStart(64, "0");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await rpc(rpcUrl, "eth_call", [{ to: contract, data }, "latest"], fetchImpl);
    if (result !== null) {
      let view;
      try {
        view = decodeFunctionResult({ abi, functionName: "viewOf", data: result });
      } catch (err) {
        throw new Error(
          `the ABI in warden/src/clock/abi.mjs cannot decode viewOf(${tokenId}) from the contract at ` +
            `${contract}: ${safeErrorText(err)} -- this build and that deployment are different ` +
            "contracts. Run `cd contracts && forge build` then `cd warden && node tools/gen-abi.mjs`, " +
            "or point MRO_CONTRACT_ADDRESS at the deployment this build was compiled from"
        );
      }
      // A SECOND, CHEAPER CHECK, because a decode that succeeds is not proof
      // the shapes agree: a different struct can in principle decode under this
      // ABI and hand back plausible nonsense, which is the failure mode the
      // index decoder had. `viewOf` echoes the id it was asked for
      // (MachineReadableOnly.sol:200), so one equality catches a return whose
      // fields have slid without costing another round trip.
      if (Number(view.tokenId) !== tokenId) {
        throw new Error(
          `viewOf(${tokenId}) at ${contract} decoded, but reported tokenId ${view.tokenId}: the ABI ` +
            "in warden/src/clock/abi.mjs does not describe that deployment"
        );
      }
      return view;
    }
    log(`warden: could not read viewOf from the contract (attempt ${attempt} of ${attempts})`);
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(
    `the contract at ${contract} did not answer viewOf(${tokenId}) in ${attempts} attempts: refusing ` +
      "to start rather than serve with an unverified decoder, because a decode failure and an RPC " +
      "outage are the same null at every call site"
  );
}

/// `today()`'s selector (`cast sig "today()"`), for the same raw eth_call the
/// decoder check uses.
const TODAY = "0xb74e452b";

/**
 * Refuse to start unless the contract's day and this box's day agree.
 *
 * WHY IT EXISTS. day.mjs holds the length of a day, and the TEST-ONLY
 * fast-days copy sets it to five minutes. Every window, deadline and credit
 * the Warden hands out is derived from it, so a Warden running a different
 * day length from its contract would queue check-ins for days the chain calls
 * FutureDay or DayNotAdvanced -- quietly, one refusal at a time. One read at
 * boot turns that into a Warden that does not start.
 *
 * One day either side is allowed, because the read can straddle a boundary.
 * An unreadable chain refuses too: verifyDecoder has just proven the RPC
 * answers, so a null here is worth stopping for, not guessing past.
 */
export async function verifyDay({ rpcUrl, contract, fetchImpl = fetch, boxDay = utcDay() }) {
  const result = await rpc(rpcUrl, "eth_call", [{ to: contract, data: TODAY }, "latest"], fetchImpl);
  if (result === null) {
    throw new Error(`the contract at ${contract} did not answer today(): refusing to start without a day it can trust`);
  }
  const chainDay = Number(decodeFunctionResult({ abi: MRO_ABI, functionName: "today", data: result }));
  const gap = dayMismatch(chainDay, boxDay);
  if (gap) {
    throw new Error(
      `the contract at ${contract} says day ${chainDay} and this box says day ${boxDay} (${gap} apart): ` +
        `MRO_DAY_SECONDS (${DAY_MS / 1000}) is not this contract's day length`
    );
  }
  return { chainDay, boxDay };
}
