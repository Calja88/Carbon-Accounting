/**
 * The rename rules that carry an already-seeded BOARD demo from its original
 * synthetic site names to the real UK operating-site identities, with no
 * database dependency — the same split as `collection-plan-fixture.ts`, so the
 * rules can be asserted (and their idempotency proved) without a live
 * connection.
 *
 * `align-site-identity.ts` is the only thing that applies them.
 *
 * Real site identity over synthetic demonstration data: these change names and
 * nothing else. No quantity, factor, calculation or requirement is derived from
 * them.
 */

/**
 * The fixture's superseded synthetic names. Longest match first, so "Northstar
 * Identification" is consumed before the bare "Northstar" in the internal-policy
 * issuing party. No replacement contains a needle, which is what makes a rerun
 * a no-op.
 */
export const LEGACY_RENAMES: readonly (readonly [string, string])[] = [
  ["Northstar Identification", "Paragon ID UK"],
  ["North Works", "Paragon ID — Hull"],
  ["East Cards", "Thames Technology — Rayleigh"],
  ["Central Digital", "RFID Discovery — Milton Keynes"],
  ["Northstar", "Paragon ID UK"],
];

export function applyLegacyRenames(value: string): string {
  return LEGACY_RENAMES.reduce((text, [from, to]) => text.split(from).join(to), value);
}
