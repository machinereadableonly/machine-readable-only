#!/usr/bin/env bash
# Which contract is this Warden configured to talk to?
#
# The wrapper exists for the same reason tools/rehearse.sh does: node loads the
# configuration file itself, exactly as the systemd unit does, and nothing here
# reads or prints it. The two values it does print -- a contract address and a
# chain id -- are public by definition; they are on chain and in every token's
# metadata. No key, url or secret is touched.
#
#   cd warden && bash tools/which-contract.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --env-file=.env -e '
  const addr = process.env.MRO_CONTRACT_ADDRESS ?? "(unset)";
  console.log("MRO_CONTRACT_ADDRESS", addr);
  console.log("MRO_CHAIN_ID        ", process.env.MRO_CHAIN_ID ?? "(unset)");
  // Report only the SHAPE of the values that must never be printed, so a
  // missing one is still diagnosable without disclosing a set one.
  for (const k of ["CLOCK_PRIVATE_KEY", "BASE_RPC_URL", "TREASURY_ADDRESS"]) {
    console.log(k.padEnd(20), process.env[k] ? "set" : "(unset)");
  }
'
