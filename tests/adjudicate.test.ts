import { describe, expect, it } from 'vitest'
import { selectGaps, type GapInput } from '../convex/lib/adjudicate'

function gap(id: string, ruleId: string, priority: 1 | 2 | 3): GapInput {
  return { id, ruleId, priority, question: `question for ${id}` }
}

describe('selectGaps', () => {
  it('caps at five, highest priority first, rest deferred', () => {
    const gaps = [
      gap('g1', 'r1', 2),
      gap('g2', 'r2', 1),
      gap('g3', 'r3', 3),
      gap('g4', 'r4', 1),
      gap('g5', 'r5', 2),
      gap('g6', 'r6', 3),
      gap('g7', 'r7', 1),
    ]
    const packOrder = ['r2', 'r4', 'r7', 'r1', 'r5', 'r3', 'r6']

    const { selected, deferred } = selectGaps(gaps, packOrder)

    expect(selected.map((g) => g.id)).toEqual(['g2', 'g4', 'g7', 'g1', 'g5'])
    expect(deferred.map((g) => g.id)).toEqual(['g3', 'g6'])
  })

  it('breaks a tie within one priority on pack order', () => {
    const gaps = [gap('g1', 'r3', 1), gap('g2', 'r1', 1), gap('g3', 'r2', 1)]
    const packOrder = ['r1', 'r2', 'r3']

    const { selected } = selectGaps(gaps, packOrder)

    expect(selected.map((g) => g.id)).toEqual(['g2', 'g3', 'g1'])
  })

  it('selects everything when there are fewer gaps than the cap', () => {
    const gaps = [gap('g1', 'r1', 2), gap('g2', 'r2', 1)]
    const { selected, deferred } = selectGaps(gaps, ['r1', 'r2'])

    expect(selected).toHaveLength(2)
    expect(deferred).toHaveLength(0)
  })

  it('selects everything when there are exactly cap gaps', () => {
    const gaps = [1, 2, 3, 4, 5].map((n) => gap(`g${n}`, `r${n}`, 2))
    const packOrder = gaps.map((g) => g.ruleId)

    const { selected, deferred } = selectGaps(gaps, packOrder)

    expect(selected).toHaveLength(5)
    expect(deferred).toHaveLength(0)
  })

  it('is deterministic across repeated calls', () => {
    const gaps = [
      gap('g1', 'r1', 2),
      gap('g2', 'r2', 1),
      gap('g3', 'r3', 3),
      gap('g4', 'r4', 1),
      gap('g5', 'r5', 2),
      gap('g6', 'r6', 3),
    ]
    const packOrder = ['r4', 'r2', 'r1', 'r5', 'r6', 'r3']

    const first = selectGaps(gaps, packOrder)
    const second = selectGaps(gaps, packOrder)

    expect(first.selected.map((g) => g.id)).toEqual(second.selected.map((g) => g.id))
    expect(first.deferred.map((g) => g.id)).toEqual(second.deferred.map((g) => g.id))
  })

  it('never alters a gap question', () => {
    const gaps = [gap('g1', 'r1', 1), gap('g2', 'r2', 2), gap('g3', 'r3', 3)]
    const packOrder = ['r1', 'r2', 'r3']

    const { selected, deferred } = selectGaps(gaps, packOrder, 1)

    for (const g of [...selected, ...deferred]) {
      const original = gaps.find((original) => original.id === g.id)!
      expect(g.question).toBe(original.question)
    }
  })

  // A ruleId absent from the pack order sorts last within its priority tier,
  // rather than jumping the queue on Array.indexOf's -1. See the doc comment
  // on selectGaps.
  it('sorts a gap whose ruleId is not in the pack order last within its priority', () => {
    const gaps = [gap('g1', 'known', 1), gap('g2', 'unknown', 1)]
    const packOrder = ['known']

    const { selected } = selectGaps(gaps, packOrder)

    expect(selected.map((g) => g.id)).toEqual(['g1', 'g2'])
  })
})
