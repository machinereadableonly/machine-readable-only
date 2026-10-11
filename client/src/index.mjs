// The whole client, as a library.
//
// Everything the CLI does is available here, in the same pieces, so a caller
// that wants only the signing or only the payment check can take that and
// leave the rest.
export { generateIdentity, ensureIdentity, loadIdentity, saveIdentity, keyIdOf, defaultKeyPath, publicFromPrivate } from "./keys.mjs";
export { signRequest, REQUIRED_COMPONENTS, WINDOW_MS } from "./signing.mjs";
export { answerChallenge, msRemaining } from "./challenge.mjs";
export { registerKey, knock, admittedFetch } from "./door.mjs";
export { rpc, listTools, callTool, structured } from "./mcp.mjs";
// The sentence table is part of the library: a consumer using rpc/callTool
// directly gets door refusals as bare reason strings, and without doorMessage
// and DOOR_REASONS would write its own table that drifts from ours.
export {
  DEFAULT_SITE, VERSION, cronLine, unpayableMessage,
  doorMessage, DOOR_REASONS, paymentFailedMessage, unresolvedPaymentMessage,
  lostResponseMessage,
} from "./messages.mjs";
export { readDemand, assertExpected, signAuthorization, paymentMeta, payFor, PAYMENT_META_KEY, PAYMENT_RESPONSE_META_KEY } from "./pay.mjs";
