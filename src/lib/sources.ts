/**
 * Brand-name datasets, one per country of origin.
 * Lookup order: country dataset, then IDD, then RxNav, then `unresolved`.
 */

export interface BrandSource {
  /** ISO 3166-1 alpha-2. */
  country: string
  label: string
  /** BCP-47. Selects the transliteration prompt. */
  languages: string[]
  /** File under data/. */
  file: string
  /** Column holding the brand name. */
  brandColumn: string
  /** Column holding the generic / composition. */
  genericColumn: string
  via: 'bd-medex' | 'indian-medicines' | 'idd'
  /** Row count, for the UI. */
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

/** Covers 44 countries including Ukraine, Russia, Poland, Nigeria, Philippines. */
export const INTERNATIONAL_FALLBACK = {
  file: 'idd.sqlite',
  exportedTo: 'idd.csv',
  via: 'idd' as const,
  rows: 424_357,
  generics: 11_734,
  countries: 44,
}

/** Total brands resolvable across every source. Shown in the UI. */
export const TOTAL_BRANDS =
  BRAND_SOURCES.reduce((n, s) => n + s.rows, 0) + INTERNATIONAL_FALLBACK.rows

export function sourceForCountry(country: string): BrandSource | undefined {
  return BRAND_SOURCES.find((s) => s.country === country.toUpperCase())
}

/** Normalise a brand string to the lookup key used by every dataset. */
export function normaliseBrand(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}
