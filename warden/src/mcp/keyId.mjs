// A key id in the two forms it has to exist in.
//
// Off chain it is an RFC 7638 thumbprint: base64url text, 43 characters for
// SHA-256. On chain it is a bytes32. Converting in two places independently is
// how a rebound agent ends up locked out by a comparison that cannot match, so
// there is exactly one converter and both callers use it.
import { createHash } from "node:crypto";

/// The thumbprint hashed to 32 bytes. Hashing rather than truncating means the
/// mapping is total: every thumbprint has an encoding, and no two share one.
export function keyIdToBytes32(keyId) {
  return "0x" + createHash("sha256").update(keyId, "utf8").digest("hex");
}
