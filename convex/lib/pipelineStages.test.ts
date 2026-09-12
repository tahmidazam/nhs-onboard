import { describe, expect, it } from 'vitest'
import { isForwardMove } from './pipelineStages'

describe('isForwardMove', () => {
  it('allows a move to a later stage', () => {
    expect(isForwardMove('mapping', 'applying-rules')).toBe(true)
  })

  it('refuses a move to an earlier stage', () => {
    expect(isForwardMove('ready-for-review', 'mapping')).toBe(false)
  })

  it('refuses a move to the same stage', () => {
    expect(isForwardMove('applying-rules', 'applying-rules')).toBe(false)
  })

  it('allows skipping straight to ready-for-review from applying-rules', () => {
    expect(isForwardMove('applying-rules', 'ready-for-review')).toBe(true)
  })
})
