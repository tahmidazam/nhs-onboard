/**
 * Extracts UKHSA migrant health guidance into data/country-guides.json.
 *
 *   copy the html/ folder into data/country-guides/
 *   pnpm data:countries
 *
 * One row per country per recommendation, each carrying its gov.uk citation.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'data/country-guides'

interface CountryRule {
  country: string
  countrySlug: string
  /** Section the block sits under: 'Main messages', 'Tuberculosis (TB)', etc. */
  section: string
  text: string
  citations: { url: string; label: string }[]
  /** Set when the guide flagged this as a call to action. */
  emphasis?: boolean
}

function decode(raw: string): string {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function citationsIn(block: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = []
  const links = /<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let a: RegExpExecArray | null
  while ((a = links.exec(block))) out.push({ url: a[1], label: stripTags(a[2]) })
  return out
}

/**
 * Walks the document tracking the most recent heading. Guides use one of two
 * layouts: call-to-action divs, or plain paragraphs and list items. Both carry
 * the same guidance, so take either and mark which.
 */
function extractRules(html: string, slug: string, country: string): CountryRule[] {
  const rules: CountryRule[] = []
  const pattern =
    /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>|<div class="call-to-action">([\s\S]*?)<\/div>|<li>([\s\S]*?)<\/li>|<p>([\s\S]*?)<\/p>/g
  const skip = /^(cookies|navigation|search|contents|is this page|help us improve|explore the topic|sign up for|related content|updates to this page|services and information|government activity|support links)/i
  let section = 'Main messages'
  let inCallToAction = false
  let m: RegExpExecArray | null

  while ((m = pattern.exec(html))) {
    if (m[2] !== undefined) {
      const heading = stripTags(m[2])
      if (heading && !skip.test(heading)) section = heading
      inCallToAction = false
      continue
    }

    const block = m[3] ?? m[4] ?? m[5] ?? ''
    const text = stripTags(block)
    if (text.length < 25 || skip.test(text)) continue

    if (m[3] !== undefined) {
      inCallToAction = true
      rules.push({ country, countrySlug: slug, section, text, citations: citationsIn(block), emphasis: true })
      continue
    }

    if (inCallToAction) continue
    rules.push({ country, countrySlug: slug, section, text, citations: citationsIn(block) })
  }

  const seen = new Set<string>()
  return rules.filter((r) => !seen.has(r.text) && seen.add(r.text))
}

if (!existsSync(DIR)) {
  console.log(`missing ${DIR}. Copy the country guide html/ folder there.`)
  process.exit(0)
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.html'))
const all: CountryRule[] = []

for (const file of files) {
  const slug = file.replace('-migrant-health-guide.html', '')
  const html = decode(readFileSync(join(DIR, file), 'utf8'))
  all.push(...extractRules(html, slug, titleCase(slug)))
}

writeFileSync('data/country-guides.json', JSON.stringify(all))

const countries = new Set(all.map((r) => r.countrySlug))
console.log(`${files.length} guides parsed`)
console.log(`${all.length} recommendations across ${countries.size} countries`)
console.log(`${all.filter((r) => r.citations.length).length} carry a citation`)

const bd = all.filter((r) => r.countrySlug === 'bangladesh')
console.log(`\nBangladesh: ${bd.length} recommendations`)
for (const r of bd.slice(0, 6)) console.log(`  [${r.section}] ${r.text.slice(0, 96)}`)
