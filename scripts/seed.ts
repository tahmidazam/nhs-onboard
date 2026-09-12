/**
 * Builds JSONL for every reference table, then loads it with `convex import`.
 *
 *   pnpm data:fetch
 *   pnpm data:seed
 *
 * Each table is imported with --replace, so running this twice leaves the same
 * rows. Add --prod to target the production deployment.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'data/seed'
const prod = process.argv.includes('--prod')

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Mirrors genericKeyFor in convex/brands.ts. Drives the country-plus-generic reverse lookup. */
const genericKey = (generic: string) => norm(generic.split(/[ (]/)[0])

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])))
}

mkdirSync(OUT, { recursive: true })

/** Accumulates rows per table so several sources can share one destination. */
const tables = new Map<string, unknown[]>()

function add(table: string, rows: unknown[]) {
  tables.set(table, (tables.get(table) ?? []).concat(rows))
}

function readJson<T>(path: string, hint: string): T[] {
  if (!existsSync(path)) {
    console.log(`skip    ${path}. ${hint}`)
    return []
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T[]
}

function brandsFromCsv(
  path: string,
  brandColumn: string,
  genericColumn: string,
  country: string,
  via: string,
) {
  if (!existsSync(path)) return console.log(`skip    ${path}`)
  const seen = new Set<string>()
  const rows = parseCsv(readFileSync(path, 'utf8'))
    .map((r) => ({ brand: (r[brandColumn] ?? '').trim(), generic: (r[genericColumn] ?? '').trim() }))
    .filter((r) => r.brand && r.generic)
    .map((r) => ({
      key: norm(r.brand),
      brand: r.brand,
      generic: r.generic,
      country,
      via,
      genericKey: genericKey(r.generic),
    }))
    .filter((r) => r.key && !seen.has(r.key) && seen.add(r.key))
  add('brands', rows)
  console.log(`${via}: ${rows.length}`)
}

brandsFromCsv('data/bd_medicines.csv', 'brand name', 'generic', 'BD', 'bd-medex')
brandsFromCsv('data/indian_medicines.csv', 'name', 'short_composition1', 'IN', 'indian-medicines')

/**
 * IDD carries no country column, so its rows are tagged XX and act as the
 * fallback when no country dataset matches.
 */
{
  const path = 'data/idd.csv'
  if (!existsSync(path)) console.log(`skip    ${path}. Run: bash scripts/export-idd.sh`)
  else {
    const seen = new Set<string>()
    const rows = parseCsv(readFileSync(path, 'utf8'))
      .filter((r) => r.key && r.generic)
      .map((r) => ({
        key: r.key,
        brand: r.brand,
        generic: r.generic,
        country: 'XX',
        via: 'idd',
        genericKey: genericKey(r.generic),
      }))
      .filter((r) => !seen.has(r.key) && seen.add(r.key))
    add('brands', rows)
    console.log(`idd: ${rows.length}`)
  }
}

add('dmd', readJson<{ key: string }>('data/dmd.json', 'Run: pnpm data:dmd').filter((r) => r.key))
add('countryGuides', readJson('data/country-guides.json', 'Run: pnpm data:countries'))

add(
  'formulary',
  readJson<{ drug: string; chapter?: string; tlAlt?: string }>('data/formulary.json', '')
    .filter((r) => r.drug)
    .map((r) => ({ key: norm(r.drug), drug: r.drug, chapter: r.chapter ?? '', rag: r.tlAlt ?? '' })),
)

for (const [table, rows] of tables) {
  if (!rows.length) continue
  const file = `${OUT}/${table}.jsonl`
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(`\nimporting ${rows.length} rows into ${table}`)
  execFileSync(
    'pnpm',
    ['exec', 'convex', 'import', '--table', table, '--replace', '--yes', ...(prod ? ['--prod'] : []), file],
    { stdio: 'inherit' },
  )
}
