// Sign a request with any component list, for the tests and tools that must
// build requests the reference client never would (missing components, a
// wrong tag, a long window). Built on http-message-sig 0.3.0's createSignature.
//
//   const headers = await signatureHeaders({ method, url, headers }, signer, { created, expires, components })
//
// `signature-agent` given as a bare name covers the member keyed by the label
// when the header is a dictionary (RFC 9421 2.1.2), which is the form the door
// requires; pass { name: "signature-agent", parameters: {} } to cover the whole
// header instead.
import { createSignature } from "http-message-sig";
import { parseDictionary } from "structured-headers";

function isDictionary(value) {
  try {
    return typeof value === "string" && parseDictionary(value).size > 0 && !/^\s*"/.test(value);
  } catch {
    return false;
  }
}

export function descriptorOf({ method, url, headers = {} }) {
  const fields = [];
  for (const [name, value] of Object.entries(headers)) {
    for (const v of Array.isArray(value) ? value : [value]) fields.push({ name: name.toLowerCase(), value: String(v) });
  }
  return { kind: "request", method, targetUri: url, fields };
}

export async function signatureHeaders(message, signer, { created = new Date(), expires, components, label = "sig1", tag = "web-bot-auth", nonce } = {}) {
  const agent = Object.entries(message.headers ?? {}).find(([k]) => k.toLowerCase() === "signature-agent")?.[1];
  const keyed = isDictionary(agent);
  const list = components.map((c) => (c === "signature-agent" && keyed ? { name: c, parameters: { key: label } } : c));
  const fields = await createSignature(descriptorOf(message), {
    label,
    components: list,
    parameters: {
      created: Math.floor(created.getTime() / 1000),
      expires: Math.floor(expires.getTime() / 1000),
      keyid: signer.keyid,
      alg: signer.algorithm,
      ...(tag === null ? {} : { tag }),
      ...(nonce === undefined ? {} : { nonce }),
    },
    signer,
  });
  return { Signature: fields.signature, "Signature-Input": fields.signatureInput };
}
