/**
 * Brand-name datasets, one per country of origin.
 *
 * This is the ONLY language-specific layer in the pipeline. Transliteration and
 * extraction are model-driven and language-agnostic; the UK side (BNF, formulary)
 * doesn't care what language the input was. So "does this only support Bengali?"
 * is answered by adding a row here.
 *
 * Lookup order is: country-specific dataset → IDD (44 countries) → RxNav → give up
 * and mark `unresolved`. Giving up is a correct outcome, not a failure.
 */

export interface BrandSource {
  /** ISO 3166-1 alpha-2. */
  country: string
  label: string
  /** Primary language(s), BCP-47 — used to pick the transliteration prompt. */
  languages: string[]
  /** File under data/. */
  file: string
  /** Column holding the brand name. */
  brandColumn: string
  /** Column holding the generic / composition. */
  genericColumn: string
  via: 'bd-medex' | 'indian-medicines' | 'idd'
  /** Approximate row count, for the UI. */
  rows: number
}

export const BRAND_SOURCES: BrandSource[] = [
  {
    country: 'BD',
    label: 'Bangladesh (MEDEX)',
    languages: ['bn'],
    file: 'bd_medicines.csv',
    brandColumn: 'brand name',
    genericColumn: 'generic',
    via: 'bd-medex',
    rows: 21_714,
  },
  {
    country: 'IN',
    label: 'India',
    languages: ['hi', 'bn', 'ur', 'ta'],
    file: 'indian_medicines.csv',
    brandColumn: 'name',
    genericColumn: 'short_composition1',
    via: 'indian-medicines',
    rows: 253_973,
  },
]

/**
 * Fallback covering 44 countries — Ukraine, Russia, Poland, Nigeria, the
 * Philippines and more. Verified cases: No-Spa → drotaverine, Analgin →
 * metamizole, Lonart → artemether/lumefantrine.
 */
export const INTERNATIONAL_FALLBACK = {
  file: 'idd.sqlite',
  table: 'd',
  /** Normalised lookup key: lowercase, non-alphanumerics stripped. */
  keyColumn: 'k',
  genericColumn: 'ing',
  via: 'idd' as const,
  rows: 425_528,
  countries: 44,
}

export function sourceForCountry(country: string): BrandSource | undefined {
  return BRAND_SOURCES.find((s) => s.country === country.toUpperCase())
}

/** Normalise a brand string to the lookup key used by every dataset. */
export function normaliseBrand(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}
