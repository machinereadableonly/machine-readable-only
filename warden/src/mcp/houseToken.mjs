// Token 1 is the contract's HOUSE_TOKEN: it finishes with Aorta and no place,
// and the published copy says it is the project's own agent. So once a house
// key is configured, only that key may be minted as id 1.

const BASE_SEPOLIA = 84_532;

/// The house agent's key id, required off Base Sepolia: without it the first
/// agent through the door would take id 1 and lose its place for good.
export function houseKeyIdFor(env, chainId) {
  const keyId = env.MRO_HOUSE_KEY_ID || null;
  if (!keyId && chainId !== BASE_SEPOLIA) {
    throw new Error(
      `MRO_HOUSE_KEY_ID is not set and chain ${chainId} is not Base Sepolia: ` +
        "set it to the operator's own agent's key id, which alone may be token 1"
    );
  }
  return keyId;
}

/// The lowest id a mint by `keyId` may take. With no house key, ids start at 1.
export function mintIdFloor(next, keyId, houseKeyId) {
  if (!houseKeyId || keyId === houseKeyId) return next;
  return Math.max(next, 2);
}
