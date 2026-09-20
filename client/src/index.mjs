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
// THE SENTENCE TABLE IS PART OF THE LIBRARY. A consumer using rpc/callTool
// directly gets door refusals as thrown reason strings; without doorMessage and
// DOOR_REASONS it has no way to turn one into something an operator can read,
// and would write its own table that drifts from ours.
export {
  DEFAULT_SITE, VERSION, cronLine, unpayableMessage,
  doorMessage, DOOR_REASONS, paymentFailedMessage, lostResponseMessage,
} from "./messages.mjs";
export { readDemand, assertExpected, signAuthorization, paymentMeta, payFor, PAYMENT_META_KEY, PAYMENT_RESPONSE_META_KEY } from "./pay.mjs";
