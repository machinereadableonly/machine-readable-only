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
export { readDemand, assertExpected, signAuthorization, paymentMeta, payFor, PAYMENT_META_KEY, PAYMENT_RESPONSE_META_KEY } from "./pay.mjs";
