// Reservations whose settlement never reported back.
//
// Both paid tools clear the way before reserving, because the unique indexes
// that make "one mint per key" and "one Mark per token" real are held by a
// stale row exactly as firmly as by a live one.
//
// WHAT CHANGED AND WHY IT MATTERS. Such a row used to be DELETED. It only ever
// exists because the process stopped between the handler returning and the
// settlement answer arriving -- which is the one case where the EIP-3009
// transfer may already be mined -- so deleting it took a paid-for token away
// from an agent whose authorisation stayed claimed. The rows are moved to
// 'payment-unresolved' instead and the Clock decides them against the chain.
//
// The consequence is deliberate: the key stays locked out of minting until that
// decision. Selling it a second token cannot be undone; waiting a night can.

/// Move any expired reservations and say out loud that money is in doubt.
export function sweep(q, who, alert = console.error) {
  const { mints, marks } = q.sweepExpiredReservations();
  if (!mints.length && !marks.length) return { mints, marks };
  const held = [
    ...mints.map((r) => `token ${r.tokenId}`),
    ...marks.map((r) => `Mark ${r.upgradeId} on token ${r.tokenId}`),
  ].join(", ");
  alert(
    `${who}: ${mints.length + marks.length} reservation(s) outlived the payment window with no ` +
      `settlement answer and are HELD for the Clock to resolve against the chain (${held})`
  );
  return { mints, marks };
}
