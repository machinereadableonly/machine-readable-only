// Read-only chain access. There is no signer here and no private key in this
// process: every write belongs to the Clock (Plan 3).
//
// JSON-RPC eth_call, hand-composed, because pulling a whole client library in
// for four view functions would be the larger dependency.
//
// WHY THE WARDEN READS THE CHAIN AT ALL, rather than trusting its own mirror.
// Three of the contract's gates are invisible to this service:
//
//   Resting   - set by the TOKEN OWNER calling rest(id) directly on chain. The
//               Warden is never told. The mirror's `status` column holds only
//               'queued' | 'written' (the write-pipeline state), so it can not
//               represent this at all.
//   Sunset    - set by the contract OWNER. Same: never routed through here.
//   Paused    - OpenZeppelin Pausable, also the owner's. Found by reading the
//               modifiers rather than the design doc: every write carries
//               `whenNotPaused` AND `notSunset`, and only the second was ever
//               written down as a gate.
//   WalletCap - mintedTo[] counts what the CHAIN has minted to an address,
//               which is not what this mirror queued: tokens transfer, and
//               `seed` mints to the same addresses from a different path.
//
// Every one of them reverts a transaction the Warden would otherwise queue,
// and two of them (mint, upgrade) revert AFTER the agent has paid. So they are
// read from the chain, at the point of decision.
//
// The selectors below were confirmed against the DEPLOYED contract on Base
// Sepolia (0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D) on 2026-08-31 with
// `cast call`, not computed and hoped for.
//
// THE viewOf RETURN IS DECODED BY NAME, THROUGH THE GENERATED ABI. It used to
// be decoded by hard-coded tuple index, from a comment that described a
// FOURTEEN-field TokenView. Plan 6 had already made it seventeen (sunsetDay,
// fellRun, fellDay) and nothing updated the constants, so `agentKeyId` was
// read from index 11 -- which is `fellRun`, and is zero. `boundKeyOf` returned
// the zero key, `bindingBlock` compared it against the caller's real key, and
// every `upgrade` and every `seed` on the live site was refused with
// `not-bound-to-caller` from the 2026-09-06 redeploy until this fix.
//
// A CORRECTED SET OF NUMBERS WOULD BE THE SAME DEFECT WITH A LATER EXPIRY
// DATE. `resting: 8` and `sunset: 9` were still correct on the day this was
// found, which is why the fault stayed invisible in everything but the key.
// So there are no field constants here at all: the ABI is generated from the
// compiled artifact (test/abi.test.mjs pins it against contracts/out), and a
// struct change now moves the decoder with it. This is what the Clock has
// always done -- clock/run.mjs reads `view.agentKeyId` by name through viem.
import { decodeFunctionResult } from "viem";
import { MRO_ABI } from "../clock/abi.mjs";
import { safeErrorText } from "../clock/redact.mjs";

const VIEW_OF = "0x0fa4edbd"; // viewOf(uint256) -> TokenView
const MINTED_TO = "0x118033bc"; // mintedTo(address) -> uint32
const WALLET_CAP = "0x58950c22"; // walletCap() -> uint32
const TOTAL_MINTED = "0xa2309ff8"; // totalMinted() -> uint32
const SUPPLY_CAP = "0x8f770ad0"; // supplyCap() -> uint32
const SEEDS_AVAILABLE = "0xb3451815"; // seedsAvailable(uint256) -> uint32
const IS_SUNSET = "0x90b8b0c8"; // isSunset() -> bool
const IS_PAUSED = "0x5c975abb"; // paused() -> bool
const WORD_HEX_CHARS = 64; // 32 bytes, as hex
const CALL_TIMEOUT_MS = 3000;

/// How long a `true` sunset is trusted without re-asking. Only sunset is
/// cached, and only its `true` -- see writesOpen() for why pause is not.
export const SUNSET_CACHE_MS = 60_000;

/// A single non-tuple return word (uint32, bool), or null.
function singleWord(hex) {
  const data = hex.slice(2);
  return data.length >= WORD_HEX_CHARS ? data.slice(0, WORD_HEX_CHARS) : null;
}

const asNumber = (word) => (word === null ? null : Number(BigInt("0x" + word)));
const asBool = (word) => (word === null ? null : BigInt("0x" + word) !== 0n);
const addressArg = (address) => address.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/// A transport failure recurs for as long as the provider is down, so its line
/// is rate limited; a decode failure cannot heal within a process, so its line
/// is written once.
const TRANSPORT_LOG_EVERY_MS = 60_000;

export function makeChainReader({
  rpcUrl,
  contract,
  fetchImpl = fetch,
  now = () => Date.now(),
  // Injectable only so a test can decode a return captured from an OLDER
  // deployment against that deployment's shape. Production never passes it.
  abi = MRO_ABI,
  log = console.error,
}) {
  // WHY THESE TWO FAILURES ARE NAMED SEPARATELY. Both used to return the same
  // null and neither wrote a line, so an ABI that disagrees with the deployed
  // contract looked exactly like a provider outage from outside: every tool
  // answering `chain-unavailable`, indefinitely, with nothing to read. The
  // difference matters because the two have opposite responses -- an outage is
  // waited out, skew is a deploy that has to be corrected -- and only the log
  // can tell an operator which one is happening. preflight.mjs now refuses to
  // start on skew, so this is the second line of defence: it covers a contract
  // that changed under a running process, and the paths a test drives directly.
  let decodeSkewLogged = false;
  let transportLoggedAt = 0;

  function noteTransportFailure() {
    const at = now();
    if (at - transportLoggedAt < TRANSPORT_LOG_EVERY_MS) return;
    transportLoggedAt = at;
    // No url, ever. BASE_RPC_URL carries the provider API key as a path
    // segment for every managed provider -- see clock/redact.mjs -- and this
    // line names no error text at all, only the fact.
    log("warden: the chain could not be reached (transport); reads are refusing until it answers");
  }

  function noteDecodeFailure(err) {
    if (decodeSkewLogged) return;
    decodeSkewLogged = true;
    log(
      `warden: viewOf did not decode under warden/src/clock/abi.mjs at contract ${contract} -- ` +
        `THIS IS NOT AN RPC OUTAGE, this build and that deployment disagree: ${safeErrorText(err)}`
    );
  }

  /**
   * One eth_call. Returns the result hex, or null on ANY failure.
   *
   * A JSON-RPC error arrives as an object on a 200 response, not as a thrown
   * exception, so it is checked explicitly: that check is the difference
   * between "the answer is no" and "we could not ask", and every caller here
   * treats the second as a refusal rather than an admission.
   */
  async function ethCall(data) {
    let res;
    try {
      res = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: contract, data }, "latest"],
        }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch {
      noteTransportFailure();
      return null;
    }
    if (!res.ok) {
      noteTransportFailure();
      return null;
    }
    // 4.L6. THE PARSE IS INSIDE THE GUARD TOO. This function's contract is
    // "null on ANY failure", and every caller here treats a throw as fatal
    // rather than as a refusal -- but `res.json()` rejects on a body that is
    // not JSON, which is exactly what a provider's HTML error page or a
    // truncated response is. That throw propagated out of the gates and out of
    // the tool, so an agent got `internal` instead of `chain-unavailable`.
    let body;
    try {
      body = await res.json();
    } catch {
      noteTransportFailure();
      return null;
    }
    if (body.error || typeof body.result !== "string") {
      noteTransportFailure();
      return null;
    }
    return body.result;
  }

  /**
   * One `viewOf` call, decoded to a named TokenView, or null.
   *
   * Null is "could not ask", exactly as it is for the transport above, and the
   * decode is inside the guard for the same reason the JSON parse is: viem
   * THROWS on a return whose shape disagrees with the ABI rather than
   * returning a wrong answer, and a throw here would reach an agent as
   * `internal` instead of a refusal. Measured on viem 2.56.0 against the real
   * seventeen-field return from the deployed contract: "Position 20735 is out
   * of bounds". Loud and null beats confident and wrong -- confident and wrong
   * is what the index decoder did.
   */
  async function viewOf(tokenId) {
    const result = await ethCall(VIEW_OF + BigInt(tokenId).toString(16).padStart(64, "0"));
    if (result === null) return null;
    try {
      return decodeFunctionResult({ abi, functionName: "viewOf", data: result });
    } catch (err) {
      noteDecodeFailure(err);
      return null;
    }
  }

  // Only a TRUE sunset is ever cached. Caching a false would keep the door open
  // for up to a minute after the operator closed the piece, and every write
  // admitted in that window is one the chain will refuse. Caching the true is
  // safe in a way the false is not, because sunset is one-way: setSunset
  // reverts with AlreadySunset, so a piece that is closed can never reopen.
  let sunsetUntil = 0;

  /**
   * The lifecycle facts the Warden cannot know on its own, in ONE call.
   *
   * Returns `{ exists, resting, sunset, level, lastDay }`, or null when the
   * chain could not be read. `exists` is level > 0, which is exactly how the
   * contract itself decides NoSuchToken.
   */
  async function lifecycleOf(tokenId) {
    const v = await viewOf(tokenId);
    if (v === null) return null;
    // Present-and-right-typed, not merely truthy: an ABI that no longer
    // carries one of these names would otherwise hand back `undefined` as a
    // fact. Same rule as everywhere else here -- a missing answer is null.
    if (typeof v.resting !== "boolean" || typeof v.sunset !== "boolean") return null;
    const level = Number(v.level);
    const lastDay = Number(v.lastDay);
    if (!Number.isFinite(level) || !Number.isFinite(lastDay)) return null;
    return { exists: level > 0, resting: v.resting, sunset: v.sunset, level, lastDay };
  }

  return {
    /**
     * The key id currently bound to a token, straight from the chain.
     *
     * Returns the 32-byte value as a lowercase hex string, or null if the call
     * fails or cannot be decoded. A failure is NOT "not bound": the caller
     * refuses on null rather than admitting on it.
     */
    async boundKeyOf(tokenId) {
      const v = await viewOf(tokenId);
      if (v === null || typeof v.agentKeyId !== "string") return null;
      return v.agentKeyId.toLowerCase();
    },

    /**
     * The lifecycle facts the Warden cannot know on its own, in ONE call.
     *
     * Returns `{ exists, resting, sunset, level, lastDay }`, or null when the
     * chain could not be read. `exists` is level > 0, which is exactly how the
     * contract itself decides NoSuchToken.
     *
     * One call rather than three: `resting` and `sunset` and the level a Mark
     * gate compares against all come out of the same `viewOf`, so a tool that
     * needs any of them pays for one round trip, not several.
     */
    lifecycleOf,

    /**
     * The first id at or after `from` that THE CHAIN does not already hold.
     *
     * Returns null when the chain could not be read, or when `maxProbes` ids
     * in a row were all taken. Null is never "use `from` anyway": a caller
     * that cannot establish a free id must refuse, because the contract
     * reverts TokenExists and the agent has already paid by this point.
     *
     * WHY THIS EXISTS. The mirror's own max id is not a fact about the chain.
     * An empty mirror beside a non-empty contract -- exactly what a fresh
     * deployment has after any token is minted by another route -- proposes
     * id 1 for a mint the contract will refuse. Measured on 2026-09-03 by the
     * first paid mint this service ever took.
     */
    async freeIdFrom(from, maxProbes = 32) {
      for (let id = from, probes = 0; probes < maxProbes; id += 1, probes += 1) {
        const life = await lifecycleOf(id);
        if (life === null) return null;
        if (!life.exists) return id;
      }
      return null;
    },

    /**
     * Will the contract accept a write at all?
     *
     * Returns "sunset", "paused", null (open), or the string "unreadable" when
     * the chain could not be asked. Those last two are NOT the same and a
     * caller must refuse on "unreadable" rather than treat it as open.
     *
     * SUNSET IS CACHED AND PAUSE IS NOT, which is a difference in the contract,
     * not an optimisation. `setSunset` reverts with AlreadySunset, so sunset is
     * one-way and a cached `true` can never become wrong. Pause is `_pause` /
     * `_unpause`, so a cached `true` would go on refusing writes after the
     * owner reopened the piece. Neither `false` is ever cached: caching that
     * would hold the door open for a minute after it was shut.
     */
    async writesOpen() {
      if (sunsetUntil > now()) return "sunset";
      const [sunsetHex, pausedHex] = await Promise.all([ethCall(IS_SUNSET), ethCall(IS_PAUSED)]);
      if (sunsetHex === null || pausedHex === null) return "unreadable";
      const sunset = asBool(singleWord(sunsetHex));
      const paused = asBool(singleWord(pausedHex));
      if (sunset === null || paused === null) return "unreadable";
      if (sunset) {
        sunsetUntil = now() + SUNSET_CACHE_MS;
        return "sunset";
      }
      return paused ? "paused" : null;
    },

    /**
     * How many more tokens the chain will mint to an address.
     *
     * Returns the remaining allowance (0 when full), or null when either read
     * failed. Both halves are read rather than assuming the default of 20:
     * walletCap is an owner dial (setWalletCap), so a hardcoded 20 here would
     * silently disagree with the chain the moment it is turned.
     */
    async walletRoomFor(address) {
      const [mintedHex, capHex] = await Promise.all([
        ethCall(MINTED_TO + addressArg(address)),
        ethCall(WALLET_CAP),
      ]);
      if (mintedHex === null || capHex === null) return null;
      const minted = asNumber(singleWord(mintedHex));
      const cap = asNumber(singleWord(capHex));
      if (minted === null || cap === null) return null;
      return Math.max(0, cap - minted);
    },

    /**
     * How many more tokens the COLLECTION will accept.
     *
     * Returns the remaining slots (0 when full), or null when either read
     * failed. Mirrors `revert SupplyCap()`, which guards `mint`
     * (MachineReadableOnly.sol:354) and `seed` (:782).
     *
     * WHY IT IS READ RATHER THAN COUNTED. The Warden used to answer this from
     * the constant 10_000 compared against its own row count, and both halves
     * can be wrong. `supplyCap` is an owner dial (`setSupplyCap`, :231), so a
     * cap lowered to close the collection early left the constant stale and the
     * Warden went on selling mints the chain would refuse -- with no refusal,
     * so the settlement was never cancelled and the money genuinely moved. And
     * the row count is a fact about this database, not about the chain;
     * `freeIdFrom` exists precisely because those two differ. Same reasoning as
     * `walletRoomFor` above, which reads its cap for the same reason.
     */
    async supplyRoom() {
      const [mintedHex, capHex] = await Promise.all([
        ethCall(TOTAL_MINTED),
        ethCall(SUPPLY_CAP),
      ]);
      if (mintedHex === null || capHex === null) return null;
      const minted = asNumber(singleWord(mintedHex));
      const cap = asNumber(singleWord(capHex));
      if (minted === null || cap === null) return null;
      return Math.max(0, cap - minted);
    },

    /**
     * How many seeds the parent's KEY still has, straight from the contract.
     *
     * Returns the count (0 when none), or null when the chain could not be
     * read. Null is "could not ask" and the caller refuses on it, like every
     * other read here.
     *
     * WHY THIS IS NOT COUNTABLE FROM THE MIRROR, which is what it used to be.
     * The budget was computed as `floor((today - firstMintDay(keyId)) / 365)`
     * minus `seedsSpent(keyId)`, and both of those derive from `tokens.keyId`
     * -- a column `reconcile` REWRITES on every `Rebound` event. The contract
     * keeps tenure in per-key mappings (`_firstMintDay`, `_seedsSpent`) that
     * `rebind` deliberately never touches, so the two disagree in three
     * measured ways:
     *
     *   1. A child rebound AWAY stopped being counted, so the mirror handed out
     *      a second seed for the year. The chain reverts NoSeedAvailable, the
     *      row is dropped a day later, and the agent has spent an id, a bitmap
     *      solve and a success message that said the seed was used.
     *   2. A child rebound IN charged a key that had never seeded, refusing it
     *      a seed the chain WOULD grant -- with no recovery path at all.
     *   3. `firstMintDay` answers 0 for a key with no rows, which is about 56
     *      years of budget where the contract gives none.
     *
     * The one thing the chain cannot know is a seed this Warden has RESERVED
     * and not yet written; that subtraction is the mirror's job, and it is done
     * in gates.mjs seedBudgetBlock() rather than here, because this file only
     * ever reports what the chain says.
     */
    async seedsAvailable(parentId) {
      const hex = await ethCall(SEEDS_AVAILABLE + BigInt(parentId).toString(16).padStart(64, "0"));
      if (hex === null) return null;
      return asNumber(singleWord(hex));
    },
  };
}
