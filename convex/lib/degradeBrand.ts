/**
 * Writes a local brand name over a generic medication name inside an already
 * assembled document. Pure: the brand lookup happens in the caller
 * (convex/degrade.ts, which has database access); this module only rewrites
 * text. See docs/adr/0010-degrader-is-template-driven.md.
 */

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces each whole-word occurrence of a medication name with its local
 * brand. A name with no entry in `brandsByName` is left as the generic,
 * which is the required fallback: never dropped, never invented.
 */
export function applyBrandNames(lines: string[], brandsByName: Record<string, string>): string[] {
  return lines.map((line) => {
    let out = line
    for (const [name, brand] of Object.entries(brandsByName)) {
      if (!name || !brand || name === brand) continue
      out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g'), brand)
    }
    return out
  })
}
