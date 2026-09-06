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
