/**
 * Generates rules/country-lists.generated.ts from data/country-guides.json.
 *
 *   pnpm data:countries                          # rebuilds the input, if needed
 *   pnpm exec tsx scripts/generate-country-lists.ts
 *
 * Country-gated rules declare a committed list of ISO 3166-1 alpha-2 codes, and
 * this is what writes it. Querying the guides at evaluation time is rejected: a
 * 135-country match computed live is something we cannot explain on stage and
 * something that changes under us. A committed list is a diff.
 * See docs/adr/0015-country-guides-gate-and-cite.md.
 *
 * Each emitted list carries the query that produced it, printed from the
 * predicate's own regexes so the comment cannot drift from the code that ran.
 *
 * Nothing here is stamped with the wall clock, so a re-run on unchanged data
 * produces a byte-identical file and any diff is a diff in UKHSA's guidance.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const IN = 'data/country-guides.json'
const OUT = 'rules/country-lists.generated.ts'

/** One row of data/country-guides.json, as scripts/parse-country-guides.ts wrote it. */
interface CountryRule {
  country: string
  countrySlug: string
  section: string
  text: string
  citations: { url: string; label: string }[]
  emphasis?: boolean
}

/** The guide page a row came from. The slug is the gov.uk path, so this is exact. */
function guideUrl(slug: string): string {
  return `https://www.gov.uk/guidance/${slug}-migrant-health-guide`
}

/**
 * Slug to ISO 3166-1 alpha-2, resolved against ICU's own region names rather
 * than a hand-written table of 135 codes: a table we typed is a table we can get
 * wrong, and ADR 9 fixes the code shape, not its spelling. Both English locales
 * are indexed because ICU splits on them ('St Lucia' against 'Saint Lucia').
 */
function isoIndex(): Map<string, string> {
  const index = new Map<string, string>()
  for (const locale of ['en-GB', 'en-US']) {
    const names = new Intl.DisplayNames([locale], { type: 'region' })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b)
        let name: string | undefined
        try {
          name = names.of(code)
        } catch {
          continue
        }
        // ICU echoes the input for codes it has no name for.
        if (!name || name === code) continue
        const slug = slugify(name)
        if (!index.has(slug)) index.set(slug, current(code))
      }
    }
  }
  return index
}

/**
 * ICU still names codes ISO has withdrawn, and they sort ahead of their
 * successors: 'Myanmar (Burma)' resolves to BU, 'Zimbabwe' to RH, 'Vietnam' to
 * VD, 'Yemen' to YD. Canonicalising through ICU's own territory aliases returns
 * the assigned code, so the withdrawn ones never reach a rule.
 */
function current(code: string): string {
  return new Intl.Locale(`und-${code}`).region ?? code
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The gov.uk guide titles ICU does not carry: registry renamings (Eswatini,
 * Türkiye, Czechia), the two Congos, definite articles gov.uk keeps, and the
 * saints ICU abbreviates. Every other slug resolves through ICU.
 */
const ALIASES: Record<string, string> = {
  'bahamas-the': 'BS',
  'brunei-darussalam': 'BN',
  congo: 'CG', // Republic of the Congo. 'democratic-republic-of-congo' is CD.
  'cote-divoire-ivory-coast': 'CI',
  'czech-republic': 'CZ',
  'democratic-republic-of-congo': 'CD',
  'gambia-the': 'GM',
  'saint-kitts-and-nevis': 'KN',
  'saint-lucia': 'LC',
  'saint-vincent-and-the-grenadines': 'VC',
  swaziland: 'SZ', // Renamed Eswatini in 2018; the guide keeps the old title.
  turkey: 'TR',
}

/**
 * A query over the guides. `where` decides, `describe` renders it into the
 * generated file from the predicate's own regexes, so the two cannot diverge.
 */
interface Query {
  describe: string
  where(row: CountryRule): boolean
}

const HEPB_SECTION = /hepatitis b/i
/**
 * The new-arrival screening line, and only it. The section's other lines are a
 * pregnancy screening offer, neonatal immunisation, and a note about the UK
 * programme: none of them is a recommendation about the patient in front of us,
 * and the sim carries no sex, so the pregnancy line could not gate anything.
 */
const HEPB_SCREEN_NEW_ARRIVALS = /consider screening for hepatitis B/i
/** The prevalence statement the screening line hangs off. Names the country. */
const HEPB_PREVALENCE = /(high|intermediate) prevalence of (of )?hepatitis B/i
const ENTITLEMENTS_URL = 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide'

const SCREENING: Query = {
  describe: `section ~ ${HEPB_SECTION} and text ~ ${HEPB_SCREEN_NEW_ARRIVALS}`,
  where: (r) => HEPB_SECTION.test(r.section) && HEPB_SCREEN_NEW_ARRIVALS.test(r.text),
}

const PREVALENCE: Query = {
  describe: `section ~ ${HEPB_SECTION} and text ~ ${HEPB_PREVALENCE}`,
  where: (r) => HEPB_SECTION.test(r.section) && HEPB_PREVALENCE.test(r.text),
}

const ENTITLEMENTS: Query = {
  describe: `any citation url = '${ENTITLEMENTS_URL}'`,
  where: (r) => r.citations.some((c) => c.url === ENTITLEMENTS_URL),
}

if (!existsSync(IN)) {
  console.log(`missing ${IN}. Run pnpm data:countries first.`)
  process.exit(1)
}

const rows: CountryRule[] = JSON.parse(readFileSync(IN, 'utf8'))
const index = isoIndex()
const slugs = [...new Set(rows.map((r) => r.countrySlug))].sort()

const codeFor = new Map<string, string>()
const dropped: string[] = []
for (const slug of slugs) {
  const code = ALIASES[slug] ?? index.get(slug)
  if (code) codeFor.set(slug, code)
  // Silent truncation reads as "covered everything" when it did not, so a slug
  // we cannot map is named in the output and in the console, never skipped.
  else dropped.push(slug)
}

/** Codes for the slugs a query matched, deduplicated and sorted. */
function codes(query: Query): string[] {
  const matched = new Set<string>()
  for (const row of rows) {
    if (!query.where(row)) continue
    const code = codeFor.get(row.countrySlug)
    if (code) matched.add(code)
  }
  return [...matched].sort()
}

/** The matched rows for one country, in the order the guide prints them. */
function rowsFor(code: string, queries: Query[]): CountryRule[] {
  const out: CountryRule[] = []
  for (const row of rows) {
    if (codeFor.get(row.countrySlug) !== code) continue
    if (queries.some((q) => q.where(row))) out.push(row)
  }
  return out
}

const guideCodes = codes({ describe: 'every row', where: () => true })
const hepbCodes = codes(SCREENING)
const entitlementsCodes = codes(ENTITLEMENTS)

function ts(s: string): string {
  return JSON.stringify(s)
}

/** Twelve codes to a line, so a diff points at a region rather than a file. */
function list(matched: string[]): string {
  const lines: string[] = []
  for (let i = 0; i < matched.length; i += 12) {
    lines.push(`  ${matched.slice(i, i + 12).map(ts).join(', ')},`)
  }
  return lines.join('\n')
}

/** The guide rows a hepatitis B recommendation cites, one entry per country. */
function citationMap(): string {
  const out: string[] = []
  for (const code of hepbCodes) {
    const cited = rowsFor(code, [SCREENING, PREVALENCE])
    const slug = [...codeFor.entries()].find(([, c]) => c === code)?.[0] ?? ''
    const entries = cited.map((r) => `    { url: ${ts(guideUrl(slug))}, quote: ${ts(r.text)} },`)
    out.push(`  ${code}: [\n${entries.join('\n')}\n  ],`)
  }
  return out.join('\n')
}

const header = `/**
 * Generated by scripts/generate-country-lists.ts. Do not edit by hand.
 *
 *   pnpm exec tsx scripts/generate-country-lists.ts
 *
 * Source: data/country-guides.json, ${rows.length} UKHSA migrant health rows
 * across ${slugs.length} countries, Open Government Licence v3.0. Slugs resolve to
 * ISO 3166-1 alpha-2 through ICU's region names plus the alias table in the
 * script. Dropped slugs: ${dropped.length === 0 ? 'none' : dropped.join(', ')}.
 *
 * A rule gates on a list here and cites the rows here. No recommendation text is
 * templated from one: the rows are clinician-facing prose that names no
 * destination, no specimen and no interval, and a recommendation whose text came
 * out of a row is generated. See docs/adr/0015-country-guides-gate-and-cite.md.
 *
 * Nothing here is dated, so a re-run on unchanged guidance is a no-op diff and
 * any real diff is UKHSA having revised a guide.
 */
import type { Citation } from './types'
`

const body = `
/**
 * Every country the guides cover.
 *
 * Query: distinct countrySlug, every row
 * Matched: ${guideCodes.length} countries.
 *
 * Not a rule gate, and nothing in the shipped pack reads it. It is the whole
 * set HEPB_SCREENING_COUNTRIES below is a subset of, which is what makes that
 * gate's ${hepbCodes.length} of ${guideCodes.length} checkable rather than asserted.
 *
 * All ${entitlementsCodes.length} cite the NHS entitlements guide, the one section every guide carries.
 * ADR 15 recorded that as licensing a rule that fires on every patient, and
 * \`ukhsa-new-arrival-orientation\` was it. That rule is gone: orientation is not
 * clinical, and a review screen whose emptiness was prevented by a
 * non-clinical row was hiding the thin record rather than reporting it.
 * \`ukhsa-imm-primary-course\` and \`nhs-general-history\` fire on every patient
 * on clinical grounds, and they are what carries a thin record now.
 */
export const GUIDE_COUNTRIES: string[] = [
${list(guideCodes)}
]

/**
 * Countries whose UKHSA guide recommends hepatitis B screening for new arrivals.
 *
 * Query: distinct countrySlug where ${SCREENING.describe}
 * Matched: ${hepbCodes.length} of ${guideCodes.length} countries.
 *
 * The remaining ${guideCodes.length - hepbCodes.length} carry a hepatitis B section without that line, almost
 * all of them stating low prevalence, so the gate is the guidance's own and not
 * a threshold we chose.
 */
export const HEPB_SCREENING_COUNTRIES: string[] = [
${list(hepbCodes)}
]

/**
 * The rows a hepatitis B recommendation attaches as secondary citations: the
 * screening line the gate matched, and the prevalence statement it hangs off,
 * which is the part that names the country. Both from the patient's own guide
 * page. See ADR 15.
 *
 * Query: rows where ${SCREENING.describe}
 *        or where ${PREVALENCE.describe}
 *
 * Quotes are verbatim from data/country-guides.json. Keyed by the same codes as
 * HEPB_SCREENING_COUNTRIES, so the gate and the citation cannot disagree.
 */
export const HEPB_GUIDE_ROWS: Record<string, [Citation, ...Citation[]]> = {
${citationMap()}
}
`

writeFileSync(OUT, `${header}${body}`)

console.log(`${rows.length} rows across ${slugs.length} countries read from ${IN}`)
console.log(`${codeFor.size} slugs mapped to ISO 3166-1 alpha-2`)
console.log(
  dropped.length === 0
    ? 'no slugs dropped'
    : `${dropped.length} slugs dropped, and so absent from every list: ${dropped.join(', ')}`,
)
console.log(`\nGUIDE_COUNTRIES: ${guideCodes.length}`)
console.log(`  query: distinct countrySlug, every row`)
console.log(`HEPB_SCREENING_COUNTRIES: ${hepbCodes.length}`)
console.log(`  query: ${SCREENING.describe}`)
console.log(`HEPB_GUIDE_ROWS: ${hepbCodes.length} countries`)
console.log(`  query: ${SCREENING.describe}`)
console.log(`      or ${PREVALENCE.describe}`)
console.log(`\n${entitlementsCodes.length} of ${guideCodes.length} guides cite the NHS entitlements guide`)
console.log(`  query: ${ENTITLEMENTS.describe}`)
console.log(`\nwrote ${OUT}`)

// The alias table is the one hand-typed thing here, so print what each code
// resolves to and let a reader check the twelve rather than trust them.
const names = new Intl.DisplayNames(['en-GB'], { type: 'region' })
console.log('\naliases, for checking:')
for (const [slug, code] of Object.entries(ALIASES)) {
  console.log(`  ${slug} -> ${code} (${names.of(code)})`)
}
