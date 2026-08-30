// The solver child process. One token in, one bitmap out, then exit.
//
// A CHILD PROCESS, not a worker thread. resvg's buffers are native, and this
// project has already measured that only a process exit returns them -- see the
// header of tools/payload-length-check.mjs. A thread would share this heap and
// hold the 532 MB.
//
// Run as:  node --max-old-space-size=768 src/solve/worker.mjs <domain> <tokenId>
import { robustSolveFor } from "../../../tools/robust-solve.mjs";
import { packModules } from "../../../tools/qart.mjs";

/// The stdout contract: one hex string, no "0x" prefix -- the same convention
/// tools/token-bitmap.mjs already uses (its callers do
/// `Buffer.from(bitmap.hex, "hex")`), so a bitmap solved here and a bitmap
/// solved by that CLI look identical to every downstream reader.
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const [domain, tokenId] = process.argv.slice(2);

try {
  const solved = robustSolveFor(domain, Number(tokenId));
  // solved.qr is the raw QRCode.create() object from the `qrcode` package --
  // not a bitmap, and not JSON-safe (its modules.data serializes to one
  // property per module). The stored, renderer-ready form is the packed
  // bitmap qart.mjs already defines: one bit per module, row major -- the
  // same packing tools/token-bitmap.mjs ships and tools/heart-mask.mjs
  // indexes against.
  const packed = packModules(solved.modules, solved.size);
  // The parent reads one line of JSON from stdout. Anything else on stdout
  // would be parsed as a result, so diagnostics go to stderr.
  process.stdout.write(JSON.stringify({ ok: true, hex: hex(packed), mask: solved.mask, match: solved.match }) + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`solve failed for token ${tokenId}: ${err.message}\n`);
  process.exit(1);
}
