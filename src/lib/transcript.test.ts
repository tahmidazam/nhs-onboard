import { describe, expect, it } from 'vitest'
import { formatTurns, parseTurns } from './transcript'

describe('parseTurns', () => {
  it('splits the prefixes Vapi writes into turns', () => {
    const turns = parseTurns('AI: Good morning.\nUser: Hello.')

    expect(turns).toEqual([
      { speaker: 'assistant', text: 'Good morning.' },
      { speaker: 'patient', text: 'Hello.' },
    ])
  })

  it('joins a wrapped line onto the turn above it', () => {
    const turns = parseTurns('AI: Are you taking\nany medication?')

    expect(turns).toEqual([{ speaker: 'assistant', text: 'Are you taking any medication?' }])
  })

  it('returns nothing for a transcript carrying no prefixes, so the caller can fall back', () => {
    expect(parseTurns('an unstructured blob of text')).toEqual([])
  })

  it('drops a turn whose only content was the prefix', () => {
    expect(parseTurns('AI:  \nUser: Yes.')).toEqual([{ speaker: 'patient', text: 'Yes.' }])
  })

  it('reads Assistant and Customer as the same two speakers', () => {
    expect(parseTurns('Assistant: Hello.\nCustomer: Hi.').map((turn) => turn.speaker)).toEqual([
      'assistant',
      'patient',
    ])
  })

  it('ignores text before the first prefix', () => {
    expect(parseTurns('call started\nAI: Hello.')).toEqual([
      { speaker: 'assistant', text: 'Hello.' },
    ])
  })
})

describe('formatTurns', () => {
  it('writes the prefixes parseTurns reads back, so the live copy survives a round trip', () => {
    const turns = [
      { speaker: 'assistant', text: 'Good morning.' },
      { speaker: 'patient', text: 'Hello.' },
    ] as const

    expect(parseTurns(formatTurns([...turns]))).toEqual([...turns])
  })

  it('gives an empty transcript for a call where nobody spoke', () => {
    expect(formatTurns([])).toBe('')
  })
})
