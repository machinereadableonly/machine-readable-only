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

/// viewOf(uint256). The struct ends in a dynamic `bytes code` field, so the
/// return is ABI-encoded as a dynamic tuple: a leading 32-byte offset word,
/// then the tuple's static fields in order, then the dynamic bytes. Field
/// order, from src/render/TokenView.sol:
///   0 tokenId, 1 level, 2 streak, 3 lastDay, 4 mintDay, 5 generation,
///   6 seedsGiven, 7 parent, 8 resting, 9 sunset, 10 marks, 11 agentKeyId,
///   12 code, 13 today
const VIEW_OF = "0x0fa4edbd";
const FIELD = { level: 1, lastDay: 3, resting: 8, sunset: 9, agentKeyId: 11 };
const MINTED_TO = "0x118033bc"; // mintedTo(address) -> uint32
const WALLET_CAP = "0x58950c22"; // walletCap() -> uint32
const TOTAL_MINTED = "0xa2309ff8"; // totalMinted() -> uint32
const SUPPLY_CAP = "0x8f770ad0"; // supplyCap() -> uint32
const IS_SUNSET = "0x90b8b0c8"; // isSunset() -> bool
const IS_PAUSED = "0x5c975abb"; // paused() -> bool
const WORD_HEX_CHARS = 64; // 32 bytes, as hex
const CALL_TIMEOUT_MS = 3000;

/// How long a `true` sunset is trusted without re-asking. Only sunset is
/// cached, and only its `true` -- see writesOpen() for why pause is not.
export const SUNSET_CACHE_MS = 60_000;

/// One static field of a dynamic-tuple return, as a hex word, or null when the
/// data is too short to contain it. Null always means "could not read", never
/// a value.
function tupleField(hex, index) {
  const data = hex.slice(2);
  const offsetWord = data.slice(0, WORD_HEX_CHARS);
  if (offsetWord.length !== WORD_HEX_CHARS) return null;
  const offsetBytes = parseInt(offsetWord, 16);
  if (!Number.isFinite(offsetBytes)) return null;
  const start = offsetBytes * 2 + index * WORD_HEX_CHARS;
  const field = data.slice(start, start + WORD_HEX_CHARS);
  return field.length === WORD_HEX_CHARS ? field : null;
}

/// A single non-tuple return word (uint32, bool), or null.
function singleWord(hex) {
  const data = hex.slice(2);
  return data.length >= WORD_HEX_CHARS ? data.slice(0, WORD_HEX_CHARS) : null;
}

const asNumber = (word) => (word === null ? null : Number(BigInt("0x" + word)));
const asBool = (word) => (word === null ? null : BigInt("0x" + word) !== 0n);
const addressArg = (address) => address.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export function makeChainReader({ rpcUrl, contract, fetchImpl = fetch, now = () => Date.now() }) {
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
      return null;
    }
    if (!res.ok) return null;
    const body = await res.json();
    if (body.error || typeof body.result !== "string") return null;
    return body.result;
  }

  const viewOf = (tokenId) => ethCall(VIEW_OF + BigInt(tokenId).toString(16).padStart(64, "0"));

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
    const result = await viewOf(tokenId);
    if (result === null) return null;
    const level = asNumber(tupleField(result, FIELD.level));
    const resting = asBool(tupleField(result, FIELD.resting));
    const sunset = asBool(tupleField(result, FIELD.sunset));
    const lastDay = asNumber(tupleField(result, FIELD.lastDay));
    if (level === null || resting === null || sunset === null || lastDay === null) return null;
    return { exists: level > 0, resting, sunset, level, lastDay };
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
      const result = await viewOf(tokenId);
      if (result === null) return null;
      const field = tupleField(result, FIELD.agentKeyId);
      return field ? ("0x" + field).toLowerCase() : null;
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
  };
}
