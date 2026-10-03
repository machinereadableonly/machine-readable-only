// The daily split, as every Clock test that writes needs it: a key chain from a
// test seed, a bank, and a chain whose keys are revealed through yesterday, so
// a run sends no reveal of its own unless a test asks for one.
import { chainKeys, keyIndexFor, silentBit } from "../src/clock/split.mjs";

export const SPLIT_SEED = "0x" + "33".repeat(32);
export const SPLIT_KEYS = chainKeys(SPLIT_SEED);
export const SPLIT_BANK = [
  { id: "fog-or-thunder", text: "Fog or thunder?", answers: ["fog", "thunder"] },
  { id: "legs", text: "How many legs?", range: { min: 0, max: 100 } },
];

/// The anchor was set long before any day a test writes.
export const anchorDayFor = (today) => today - 400;

/// The runClock arguments the split needs, with every key through yesterday revealed.
export function splitArgs(today) {
  const anchorDay = anchorDayFor(today);
  return {
    splitKeys: SPLIT_KEYS,
    bank: SPLIT_BANK,
    readSplit: async () => ({
      anchor: SPLIT_KEYS[0],
      anchorDay,
      revealed: keyIndexFor(today - 1, anchorDay),
    }),
  };
}

/// The bit a mint or seed of `tokenId` on `day` carries.
export const firstAnswerFor = (today, day, tokenId) =>
  silentBit(SPLIT_KEYS[keyIndexFor(day, anchorDayFor(today))], tokenId) === 1;

/// Wrap a writer so the night's reveal lands without being recorded, for tests
/// about what comes after it. Tests about the reveal itself use a plain writer.
export function passingReveal(writer) {
  const send = writer.send;
  return Object.assign(writer, {
    async send(functionName, args, opts) {
      if (functionName === "revealSplitKeys") return { ok: true, hash: "0xreveal" };
      return send.call(this, functionName, args, opts);
    },
  });
}
