/**
 * Flattens dm+d VTM and VMP XML into data/dmd.json.
 *
 *   put f_vtm2_*.xml and f_vmp2_*.xml in data/dmd/
 *   pnpm exec tsx scripts/parse-dmd.ts
 *   pnpm data:seed
 *
 * Streams by tag rather than building a DOM, so the VMP file's size does not
 * matter.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'data/dmd'

interface Vtm {
  vtmId: string
  vtmName: string
}

interface Vmp {
  vpid: string
  name: string
  vtmId?: string
}

function findFile(prefix: string): string | undefined {
  if (!existsSync(DIR)) return undefined
  const hit = readdirSync(DIR).find(
    (f) => f.toLowerCase().startsWith(prefix) && f.toLowerCase().endsWith('.xml'),
  )
  return hit ? join(DIR, hit) : undefined
}

/** Yields the inner XML of every <tag>...</tag> occurrence. */
function* blocks(xml: string, tag: string): Generator<string> {
  const open = `<${tag}>`
  const close = `</${tag}>`
  let i = 0
  for (;;) {
    const start = xml.indexOf(open, i)
    if (start === -1) return
    const end = xml.indexOf(close, start)
    if (end === -1) return
    yield xml.slice(start + open.length, end)
    i = end + close.length
  }
}

function field(block: string, tag: string): string | undefined {
  const start = block.indexOf(`<${tag}>`)
  if (start === -1) return undefined
  const end = block.indexOf(`</${tag}>`, start)
  if (end === -1) return undefined
  return block
    .slice(start + tag.length + 2, end)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function parseVtms(): Vtm[] {
  const path = findFile('f_vtm2')
  if (!path) {
    console.log('missing f_vtm2_*.xml in data/dmd/')
    return []
  }
  const xml = readFileSync(path, 'utf8')
  const out: Vtm[] = []
  for (const b of blocks(xml, 'VTM')) {
    const vtmId = field(b, 'VTMID')
    const vtmName = field(b, 'NM')
    if (vtmId && vtmName) out.push({ vtmId, vtmName })
  }
  console.log(`VTM  ${out.length} from ${path}`)
  return out
}

function parseVmps(): Vmp[] {
  const path = findFile('f_vmp2')
  if (!path) {
    console.log('missing f_vmp2_*.xml in data/dmd/')
    return []
  }
  const xml = readFileSync(path, 'utf8')
  const out: Vmp[] = []
  for (const b of blocks(xml, 'VMP')) {
    const vpid = field(b, 'VPID')
    const name = field(b, 'NM')
    if (vpid && name) {
      out.push({ vpid, name, vtmId: field(b, 'VTMID') })
    }
  }
  console.log(`VMP  ${out.length} from ${path}`)
  return out
}

/** f_bnf1_*.xml from the dmdbonus release. Maps VPID to BNF and ATC. */
function parseBnf(): Map<string, { bnf?: string; atc?: string }> {
  const path = findFile('f_bnf1')
  const map = new Map<string, { bnf?: string; atc?: string }>()
  if (!path) {
    console.log('missing f_bnf1_*.xml. Unzip week*-BNF.zip from the dmdbonus release into data/dmd/')
    return map
  }
  const xml = readFileSync(path, 'utf8')
  for (const b of blocks(xml, 'VMP')) {
    const vpid = field(b, 'VPID')
    if (!vpid) continue
    const atc = field(b, 'ATC')
    map.set(vpid, { bnf: field(b, 'BNF'), atc: atc === 'n/a' ? undefined : atc })
  }
  console.log(`BNF  ${map.size} from ${path}`)
  return map
}

const vtms = parseVtms()
const vmps = parseVmps()
const bnf = parseBnf()

if (!vtms.length) {
  console.log('nothing to write')
  process.exit(0)
}

/** Prefers a plain oral solid, which is what a GP prescribes by default. */
function pickVmp(candidates: Vmp[]): Vmp | undefined {
  if (!candidates.length) return undefined
  const oral = candidates.filter((v) => /tablet|capsule/i.test(v.name) && !/\//.test(v.name))
  const pool = oral.length ? oral : candidates
  return pool.sort((a, b) => a.name.length - b.name.length)[0]
}

const byVtm = new Map<string, Vmp[]>()
for (const v of vmps) {
  if (!v.vtmId) continue
  const list = byVtm.get(v.vtmId) ?? []
  list.push(v)
  byVtm.set(v.vtmId, list)
}

const rows = vtms.map((vtm) => {
  const vmp = pickVmp(byVtm.get(vtm.vtmId) ?? [])
  const codes = vmp ? bnf.get(vmp.vpid) : undefined
  return {
    key: norm(vtm.vtmName),
    vtmId: vtm.vtmId,
    vtmName: vtm.vtmName,
    vmpId: vmp?.vpid,
    vmpName: vmp?.name,
    bnfCode: codes?.bnf,
    atcCode: codes?.atc,
  }
})

writeFileSync('data/dmd.json', JSON.stringify(rows))
console.log(`wrote data/dmd.json with ${rows.length} rows, ${rows.filter((r) => r.vmpName).length} carrying a VMP`)
