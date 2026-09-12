/**
 * Loads data/ into the Convex `brands` and `formulary` tables.
 *
 *   npm run data:fetch
 *   npm run data:seed
 *
 * Run once per deployment. Both developers share one deployment, so one of you
 * runs it. Re-running duplicates rows.
 */
import { readFileSync, existsSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { api, internal } from '../convex/_generated/api'

const URL = process.env.VITE_CONVEX_URL
if (!URL) throw new Error('VITE_CONVEX_URL is not set. Copy .env.example to .env.local.')

const client = new ConvexHttpClient(URL)
const BATCH = 500

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

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

async function send<T>(rows: T[], fn: (batch: T[]) => Promise<unknown>, label: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await fn(rows.slice(i, i + BATCH))
    process.stdout.write(`\r${label}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }
  process.stdout.write('\n')
}

async function seedBangladesh() {
  const path = 'data/bd_medicines.csv'
  if (!existsSync(path)) return console.log('skip    bd_medicines.csv')
  const seen = new Set<string>()
  const rows = parseCsv(readFileSync(path, 'utf8'))
    .map((r) => ({ brand: (r['brand name'] ?? '').trim(), generic: (r.generic ?? '').trim() }))
    .filter((r) => r.brand && r.generic)
    .map((r) => ({ key: norm(r.brand), brand: r.brand, generic: r.generic, country: 'BD', via: 'bd-medex' }))
    .filter((r) => r.key && !seen.has(r.key) && seen.add(r.key))
  await send(rows, (batch) => client.mutation(internal.brands.insertBrands, { rows: batch }), 'BD brands')
}

async function seedIndia() {
  const path = 'data/indian_medicines.csv'
  if (!existsSync(path)) return console.log('skip    indian_medicines.csv')
  const seen = new Set<string>()
  const rows = parseCsv(readFileSync(path, 'utf8'))
    .map((r) => ({ brand: (r.name ?? '').trim(), generic: (r.short_composition1 ?? '').trim() }))
    .filter((r) => r.brand && r.generic)
    .map((r) => ({ key: norm(r.brand), brand: r.brand, generic: r.generic, country: 'IN', via: 'indian-medicines' }))
    .filter((r) => r.key && !seen.has(r.key) && seen.add(r.key))
  await send(rows, (batch) => client.mutation(internal.brands.insertBrands, { rows: batch }), 'IN brands')
}

/** 425,528 brands across 44 countries. Fallback when no country dataset matches. */
async function seedInternational() {
  const path = 'data/idd.csv'
  if (!existsSync(path)) return console.log('skip    idd.csv. Run: bash scripts/export-idd.sh')
  const seen = new Set<string>()
  const rows = parseCsv(readFileSync(path, 'utf8'))
    .filter((r) => r.key && r.generic)
    .map((r) => ({ key: r.key, brand: r.brand, generic: r.generic, country: 'XX', via: 'idd' }))
    .filter((r) => !seen.has(r.key) && seen.add(r.key))
  await send(rows, (batch) => client.mutation(internal.brands.insertBrands, { rows: batch }), 'IDD brands')
}

async function seedFormulary() {
  const path = 'data/formulary.json'
  if (!existsSync(path)) return console.log('skip    formulary.json')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    drug: string; chapter: string; tlAlt: string
  }[]
  const rows = raw
    .filter((r) => r.drug)
    .map((r) => ({ key: norm(r.drug), drug: r.drug, chapter: r.chapter ?? '', rag: r.tlAlt ?? '' }))
  await send(rows, (batch) => client.mutation(internal.brands.insertFormulary, { rows: batch }), 'Formulary')
}

await seedBangladesh()
await seedIndia()
await seedInternational()
await seedFormulary()
console.log(await client.query(api.brands.counts, {}))
