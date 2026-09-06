// The identity key.
//
// WHAT THIS KEY IS FOR, and it is the only thing it is for: signing HTTP
// request signatures, so the door can tell that one program composed a request
// and that the same program came back tomorrow. It is an Ed25519 key. Ed25519
// is not a curve any EVM chain accepts, so this key CANNOT sign a transaction
// even if some future version of this code tried to. That is not a promise
// about our discipline, it is a property of the algorithm.
//
// The wallet that pays is a separate key, on a separate curve, which this
// module never touches. See pay.mjs.
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { jwkToKeyID } from "web-bot-auth";

/// Where the identity key lives by default. Overridable so a caller can keep
/// several identities, and so the tests never touch a real one.
export function defaultKeyPath(home = process.env.HOME ?? ".") {
  return `${home}/.mro/identity.jwk.json`;
}

/**
 * The RFC 7638 thumbprint of a public JWK: this key's name everywhere.
 *
 * The Warden derives the same value from the signature it verified, and never
 * from anything the caller sends as an argument. So a key id is not a claim,
 * it is a consequence of holding the private key.
 */
export async function keyIdOf(publicJwk) {
  return jwkToKeyID(
    publicJwk,
    async (b) => crypto.subtle.digest("SHA-256", b),
    (u) => Buffer.from(u).toString("base64url")
  );
}

/// A fresh Ed25519 identity, as the two JWKs and the key id they share.
export async function generateIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  return { publicJwk, privateJwk, keyId: await keyIdOf(publicJwk) };
}

/**
 * Write an identity to disk, readable only by its owner.
 *
 * chmod 600 on the FILE and 700 on the directory. A private key that lands
 * world-readable because the process umask was loose is the cheapest possible
 * way to lose an identity, and the default umask on many systems is exactly
 * that loose.
 */
export function saveIdentity(identity, path = defaultKeyPath()) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // 5.L5. `mode` ON mkdirSync APPLIES ONLY WHEN IT CREATES. An existing ~/.mro
  // -- made by an older version, by a shell, or by a restore from a backup --
  // keeps whatever mode it had, and the umask that made it loose is exactly the
  // one this guard exists for. The file's own 0600 is what actually protects
  // the key; the directory is defence in depth, and defence that only applies
  // to first runs is not.
  try {
    chmodSync(dir, 0o700);
  } catch {
    // A directory somebody else owns cannot be chmodded, and refusing to save
    // the key over that would be worse than saving it: the FILE mode below is
    // the protection that matters, and it is set either way.
  }
  writeFileSync(path, JSON.stringify(identity, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/// Read an identity back, or null if there is none there yet.
export function loadIdentity(path = defaultKeyPath()) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/// The identity at `path`, creating and saving one if it does not exist.
export async function ensureIdentity(path = defaultKeyPath()) {
  const existing = loadIdentity(path);
  if (existing) return { identity: existing, created: false };
  const identity = await generateIdentity();
  saveIdentity(identity, path);
  return { identity, created: true };
}

/**
 * The public half of a private JWK, derived rather than trusted.
 *
 * Used when proving possession at registration: the server must be given the
 * PUBLIC key, and deriving it from the private one means a caller cannot
 * accidentally register somebody else's public key alongside its own private
 * key and then be unable to sign for it.
 */
export function publicFromPrivate(privateJwk) {
  return createPublicKey({ key: privateJwk, format: "jwk" }).export({ format: "jwk" });
}
