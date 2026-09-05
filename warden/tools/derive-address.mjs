// Print the public address of a private key read from STDIN.
//
// WHY THIS EXISTS AT ALL. `make-clock-key.sh` used to answer "which address is
// the Clock?" with `cast wallet address --private-key "$KEY"`, which puts the
// key in argv. On Linux `/proc/<pid>/cmdline` is mode 0444 -- readable by every
// local user, unlike the 0600 file the key is stored in -- so that one call
// carried the key across the boundary the file mode exists to hold. `cast` has
// no stdin route: `--interactive` opens the terminal directly and fails with
// "No such device or address" when handed a pipe (measured, foundry 1.7.1).
//
// Reading stdin keeps the key out of argv, out of the environment, and out of
// any terminal Claude can see. Nothing here prints the key, including on the
// error paths -- an invalid key is reported by its shape, never by its value.
//
// The script writes the derived address into the environment file as
// CLOCK_ADDRESS, so this runs at most once per key and the ordinary
// "remind me which address this is" path never touches the secret again.
//
//   printf '%s' "$KEY" | node warden/tools/derive-address.mjs
import { privateKeyToAccount } from "viem/accounts";

const key = (await new Response(process.stdin).text()).trim();

if (key === "") {
  console.error("ERROR: no private key on stdin.");
  process.exit(1);
}

// 0x plus 64 hex characters. Checked here so a malformed value is reported as
// a shape rather than reaching viem, whose error text quotes what it was given.
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error(
    `ERROR: that does not look like a private key ` +
      `(expected 0x followed by 64 hex characters, got ${key.length} characters).`,
  );
  process.exit(1);
}

try {
  process.stdout.write(privateKeyToAccount(key).address + "\n");
} catch {
  // Deliberately swallowing the cause: viem's message includes the key.
  console.error("ERROR: that private key could not be turned into an address.");
  process.exit(1);
}
