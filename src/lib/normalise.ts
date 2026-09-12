/**
 * The one normalising function. ADR 11's recovery matcher and the rule pack's
 * profile builder both key on it, so the metric and the engine cannot disagree
 * about whether this patient has diabetes.
 *
 * Lowercased with non-alphanumerics stripped, exactly as
 * docs/adr/0011-recovery-is-measured-against-a-frozen-snapshot.md specifies.
 * Import it. A second copy is a second definition of "has diabetes".
 */
export function normaliseKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}
