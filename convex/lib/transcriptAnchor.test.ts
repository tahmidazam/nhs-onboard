import { describe, expect, it } from 'vitest'
import { formatTurns, parseTurns } from '../../src/lib/transcript'
import { anchor } from './anchor'

/**
 * The contract convex/callExtract.ts rests on, held here because it is a
 * composition of two modules rather than a function of its own: the model is
 * handed the whole transcript, and ADR 17's containment runs against the
 * patient's turns alone.
 *
 * That is the difference between prompting against a failure and refusing it.
 * The dashboard prompt's verification ladder has the assistant read every drug
 * name and dose back out loud at least twice, and read one back WRONG on
 * purpose to test whether the patient has stopped listening. A claim quoted
 * from a readback is our own guess wearing the patient's authority, so it has
 * to fail structurally. See ADR 17 and ADR 22.
 */

/** The string Vapi saves, and the one the browser builds with `formatTurns`. */
const TRANSCRIPT = [
  'AI: Hello, this is the onboarding assistant from Elmwood Surgery. Am I speaking to Rahim Uddin?',
  'User: Yes, speaking.',
  'User: I take a tablet for my sugar, metformin, five hundred twice a day.',
  'AI: Metformin, five hundred milligrams. Five hundred, not fifty. Twice a day, morning and evening.',
  'AI: So that is ten milligrams of amlodipine as well?',
  'User: Yes, that is right.',
].join('\n')

/** Exactly what convex/callExtract.ts builds as its anchor target. */
function patientLines(transcript: string): string {
  return formatTurns(parseTurns(transcript).filter((turn) => turn.speaker === 'patient'))
}

describe('anchoring a transcript claim', () => {
  it('matches the speaker prefixes Vapi writes, so the patient has turns at all', () => {
    const turns = parseTurns(TRANSCRIPT)

    expect(turns.filter((turn) => turn.speaker === 'patient')).toHaveLength(3)
    expect(turns.filter((turn) => turn.speaker === 'assistant')).toHaveLength(3)
  })

  it('anchors a fact the patient said, quoted from their own line', () => {
    const quote = 'I take a tablet for my sugar, metformin, five hundred twice a day.'

    expect(anchor(patientLines(TRANSCRIPT), quote, 'metformin').verified).toBe(true)
  })

  /**
   * The assistant's readback is a correct reading of what the patient said, and
   * it still must not anchor: the line is the assistant's, so admitting it
   * admits the wrong ones too. Nothing distinguishes them at this layer.
   */
  it('refuses a quote lifted from the assistant readback', () => {
    const quote =
      'Metformin, five hundred milligrams. Five hundred, not fifty. Twice a day, morning and evening.'

    expect(anchor(patientLines(TRANSCRIPT), quote, 'Metformin').verified).toBe(false)
  })

  /**
   * The acquiescence check in the dashboard prompt: the assistant reads back a
   * value the patient never gave, and a tired patient agrees. This is the drug
   * the record must not gain, and the quote is the only place it appears.
   */
  it('refuses a drug the patient only agreed to, which the assistant invented', () => {
    const quote = 'So that is ten milligrams of amlodipine as well?'

    expect(anchor(patientLines(TRANSCRIPT), quote, 'amlodipine').verified).toBe(false)
  })

  it('refuses a verbatim that is not inside the quote it came with', () => {
    const quote = 'I take a tablet for my sugar, metformin, five hundred twice a day.'

    expect(anchor(patientLines(TRANSCRIPT), quote, 'insulin').verified).toBe(false)
  })

  /**
   * The prefixes are left on the anchor target for this: a quote stitched
   * across two turns reads as one sentence and is two, and the `User:` between
   * them is what breaks containment.
   */
  it('refuses a quote stitched across two of the patient turns', () => {
    const quote = 'Yes, speaking. I take a tablet for my sugar'

    expect(anchor(patientLines(TRANSCRIPT), quote, 'sugar').verified).toBe(false)
  })

  it('anchors the same fact said in another script, since containment is not translation', () => {
    const transcript = ['AI: আপনি কি কোনো ওষুধ খান?', 'User: আমি নাপা খাই, দিনে তিন বার।'].join('\n')

    expect(anchor(patientLines(transcript), 'আমি নাপা খাই, দিনে তিন বার।', 'নাপা').verified).toBe(
      true,
    )
  })

  it('has nothing to anchor against when the patient never spoke', () => {
    const transcript = ['AI: Hello, am I speaking to Rahim Uddin?', 'AI: Hello?'].join('\n')

    expect(patientLines(transcript)).toBe('')
    expect(anchor(patientLines(transcript), 'Hello?', 'Hello').verified).toBe(false)
  })
})
