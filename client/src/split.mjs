// THE DAILY SPLIT: which answers fill a square, and the silent coin flip.
// warden/src/clock/split.mjs is an identical copy; both are pinned by the same vectors.

import { keccak256, encodePacked } from "viem";

export const CHAIN_LENGTH = 36_500;

// k[CHAIN_LENGTH] is the seed; each earlier key is the hash of the next, and
// k[0] is the anchor the contract holds. Key n belongs to day anchorDay + n - 1.
export function chainKeys(seedHex) {
  const k = new Array(CHAIN_LENGTH + 1);
  k[CHAIN_LENGTH] = seedHex.toLowerCase();
  for (let i = CHAIN_LENGTH; i > 0; i--) k[i - 1] = keccak256(k[i]);
  return k;
}

export const keyIndexFor = (day, anchorDay) => day - anchorDay + 1;

const h = (key, tag, i) => BigInt(keccak256(encodePacked(["bytes32", "string", "uint256"], [key, tag, BigInt(i)])));

// Rank the n answers by (hash, index); the first floor(n / 2) give a 1.
export function splitBit(keyHex, n, answer) {
  const hs = Array.from({ length: n }, (_, i) => h(keyHex, "split", i));
  const order = [...hs.keys()].sort((a, b) => (hs[a] < hs[b] ? -1 : hs[a] > hs[b] ? 1 : a - b));
  return order.indexOf(answer) < Math.floor(n / 2) ? 1 : 0;
}

export const silentBit = (keyHex, tokenId) => Number(h(keyHex, "silent", tokenId) & 1n);

export const answerBit = ({ keyHex, n, answer, tokenId }) =>
  answer === null || answer === undefined ? silentBit(keyHex, tokenId) : splitBit(keyHex, n, answer);
