/**
 * Splits a saved call transcript into speaker turns.
 *
 * Vapi sends one string with a speaker prefix per line. A line without a
 * recognised prefix joins the turn above it, so a wrapped sentence stays whole.
 * Text before any prefix is dropped, and a transcript that matches no prefix at
 * all yields nothing, which is the caller's signal to render the raw string.
 */

export interface Turn {
  speaker: 'assistant' | 'patient'
  text: string
}

const PREFIX = /^\s*(AI|Assistant|Bot|User|Human|Customer)\s*:\s*(.*)$/i
const ASSISTANT = /^(AI|Assistant|Bot)$/i

export function parseTurns(transcript: string): Turn[] {
  const turns: Turn[] = []

  for (const line of transcript.split('\n')) {
    const match = PREFIX.exec(line)
    if (match) {
      turns.push({ speaker: ASSISTANT.test(match[1]) ? 'assistant' : 'patient', text: match[2].trim() })
      continue
    }
    if (turns.length && line.trim()) {
      const last = turns[turns.length - 1]
      last.text = last.text ? `${last.text} ${line.trim()}` : line.trim()
    }
  }

  return turns.filter((turn) => turn.text)
}

/**
 * Renders live turns in the same shape Vapi's saved transcript uses, so the
 * browser's fallback copy and the end-of-call report both read back through
 * `parseTurns`.
 */
export function formatTurns(turns: Turn[]): string {
  return turns.map((turn) => `${turn.speaker === 'assistant' ? 'AI' : 'User'}: ${turn.text}`).join('\n')
}
