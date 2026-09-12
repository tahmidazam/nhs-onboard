import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pack } from './index'

/**
 * Pack-wide guarantees. See #14.
 *
 * The placeholder-quote test is red until every rule ticket lands, and that is
 * the point: it is what stops a paraphrased or invented quote reaching a demo.
 */

describe('the pack', () => {
  it('gives every rule a unique id', () => {
    const ids = pack.map((r) => r.id)
    assert.deepEqual(ids, [...new Set(ids)], 'a renamed or duplicated id orphans Gap rows')
  })

  it('gives every rule at least one citation', () => {
    for (const rule of pack) assert.ok(rule.citations.length > 0, rule.id)
  })

  it('cites no licensed source', () => {
    const forbidden = ['cks.nice.org.uk', 'bnf.nice.org.uk']
    for (const rule of pack) {
      for (const c of rule.citations) {
        for (const host of forbidden) {
          assert.ok(!c.url.includes(host), `${rule.id} cites ${host}, which is not OGL`)
        }
      }
    }
  })

  it('carries no placeholder quote', () => {
    const unquoted = pack
      .filter((r) => r.citations.some((c) => c.quote.includes('TODO')))
      .map((r) => r.id)
    assert.deepEqual(unquoted, [], `paste the verbatim line from the source for: ${unquoted.join(', ')}`)
  })

  it('gives every rule prose describing what it reads', () => {
    for (const rule of pack) assert.ok(rule.reads.length > 0, rule.id)
  })
})
