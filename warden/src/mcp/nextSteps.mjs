// What to do about it.
//
// C3.7. Every refusal this service sends is a correct diagnosis and none of
// them is a prescription: `resting`, `wallet-cap-reached`, `chain-unavailable`.
// The MCP specification's own definition of a tool error is feedback a model
// can act on, and the caller here is a program that will do the next sensible
// thing if it is told what that is -- and will otherwise report to its
// operator that the piece is broken.
//
// One table, applied in ONE place (the tool wrapper in server.mjs), rather
// than a `next` spread into each refusal builder by hand. The tools return
// refusals from about thirty sites; a convention that has to be remembered at
// each of them is a convention that will be missed at one, and the one missed
// is the one an agent hits.
//
// A test asserts every reason the service can emit is either in this table or
// on the deliberate list below, so adding a refusal without a next step fails
// the suite rather than shipping a dead end.

/// The 00:05 UTC promise, in one place. `mint` computes it, `checkin` reports
/// it, and `tokenView` says whether it has passed; three copies of a formula
/// is how they come to disagree.
export const onChainBy = (day) => new Date((day + 1) * 86_400_000 + 300_000).toISOString();

export const NEXT = {
  // -- the tools ------------------------------------------------------------
  "unknown-token":
    "No token with this id is known here. If you minted it today it exists here from the moment `mint` answered; if the chain holds it and this service does not, read viewOf(id) on the contract and try again after 00:05 UTC.",
  "not-yet-mirrored":
    "The chain holds this token and this service has not caught up with it yet. Nothing is wrong and nothing is lost; the nightly reconcile at 00:05 UTC will pick it up. Read viewOf(id) on the contract meanwhile.",
  "not-bound-to-caller":
    "This token is bound to another key. If you are its new agent, the token OWNER's wallet must call rebind(tokenId, yourKeyId); call `rebind` to get that call. Nothing here can do it for you.",
  "already-credited-today":
    "You already came back today, and `nextWindowOpensAt` says when the next window opens. This is not a penalty: nothing was lost and your run is intact.",
  "already-minted":
    "This key has minted its one token. `status` with no argument shows it.",
  "supply-cap-reached": "The collection is full.",
  "wallet-cap-reached":
    "That address already holds the maximum number of tokens (walletCap() on the contract). Mint to a different address.",
  "chain-unavailable":
    "The chain could not be read, so this was refused rather than guessed. Nothing was charged. Try again in a minute.",
  paused:
    "Writes are paused by the operator. Nothing was charged. Level and streak are not affected by a pause; try again later.",
  sunset:
    "The piece is closed. Every token rests where it stands; transfers and rebind still work. Nothing more can be minted, credited or marked.",
  resting:
    "This token was sealed by its owner. It cannot be credited or marked again.",
  "parent-not-whole":
    "A token may only seed a child once its own heart is whole, at 365 days.",
  "no-seed-available":
    "This key has already used its seed for the agent-year.",
  "seed-not-available":
    "This key has already used its seed for the agent-year.",
  "payment-unavailable":
    "Payment cannot be taken right now: the facilitator could not be reached. Nothing was charged. Try again later.",
  "payment-not-configured":
    "This service is not currently able to take payment. Nothing was charged, and this is ours to fix, not yours.",
  "payment-already-used":
    "That payment authorisation has already bought something. One authorisation buys one thing; sign a fresh one.",
  "paid-but-unavailable":
    "A gate closed while your payment was being verified; `detail` names it. The authorisation was NOT submitted and your balance did not move. You may call again.",
  internal:
    "Something failed on this service's side. Nothing was charged. It is worth reporting.",

  // -- the Marks ------------------------------------------------------------
  "mark-level-too-low":
    "This Mark opens at a level this token has not reached. Keep coming back; `ladder` shows the distance.",
  "mark-needs-streak":
    "This Mark is earned by a run of returning days. The gate reads the LONGEST run you have ever completed, so a later lapse never takes an earned Mark away. `ladder` shows what it is waiting on.",
  "mark-needs-whole":
    "This Mark needs a whole heart: 365 credited days.",
  "mark-needs-iris":
    "Pair five waits on an Iris, bought (id 5) or earned (id 6), already written on chain.",
  "mark-excluded":
    "Closed permanently by the Mark named in `detail`, which is the other side of this pair. Nothing can reopen it. Ask `ladder` before choosing a side.",
  "mark-bad-variant":
    "This Mark does not accept that variant. Only ids 5 (Iris shape, 0-2) and 9 (Tint ink, 0-1) take one; every other Mark takes 0.",
  "mark-already-applied":
    "This token already wears it.",
  "mark-inactive":
    "That Mark is not one this service offers. `ladder` lists the ten that exist.",
  "mark-sold-out":
    "That Mark is no longer available.",
};

/**
 * Reasons that deliberately carry no next step.
 *
 * Every one of these is either the caller's own protocol error, where the
 * message IS the instruction, or an internal Clock condition an agent never
 * sees. Listed rather than omitted so the completeness test can tell "decided"
 * from "forgotten" -- an empty list would make that test pass by saying
 * nothing.
 */
export const NO_NEXT = new Set([
  // Door and registration: the client's own error, answered at the door with
  // its own vocabulary, and mapped to sentences client-side (C3.9).
  "signature", "components", "expired", "unknown-key", "directory", "challenge",
  "digest", "replay", "proof", "nonce", "invalid-jwk", "rate-limited",
  // Routing and malformed input: not tool refusals.
  "target", "unknown-route", "malformed", "not-found", "not-built-yet",
  // Clock-internal. These are written to the mirror and read by the operator;
  // no agent is ever handed one.
  "gas-estimate-failed", "gas-estimate-too-large", "reverted-on-chain",
  "reverted-on-simulate", "send-failed", "receipt-unknown", "attempts-exhausted",
]);

/**
 * Add the next step to a refusal, if there is one for its reason.
 *
 * Returns the value unchanged when it is not a refusal, when it already
 * carries a `next` (a tool that wants to say something more specific wins),
 * or when the reason is one that deliberately has none.
 */
export function withNext(value) {
  if (typeof value !== "object" || value === null) return value;
  if (value.ok !== false || typeof value.reason !== "string") return value;
  if (typeof value.next === "string") return value;
  const next = NEXT[value.reason];
  return next ? { ...value, next } : value;
}
