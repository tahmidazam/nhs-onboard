/**
 * Translates short strings via the model. Called only from convex/degrade.ts.
 *
 * The model receives an array of lines and returns an array of lines. It is
 * never asked to write a document, and it never sees clinical content it
 * could elaborate on beyond translating what is already there. See
 * docs/adr/0010-degrader-is-template-driven.md.
 */

const OPENAI_ORIGIN = 'https://api.openai.com'
const MODEL = 'gpt-4o-mini'

function apiKey(): string {
  const value = process.env.OPENAI_API_KEY
  if (!value) throw new Error('OPENAI_API_KEY is not set on this Convex deployment')
  return value
}

/**
 * Translates each line independently, preserving order and count. Falls back
 * to the English lines whenever the call fails or the response does not
 * match, so a translation hiccup never blocks the demo.
 */
export async function translateLines(lines: string[], language: string): Promise<string[]> {
  if (lines.length === 0) return lines

  try {
    const response = await fetch(`${OPENAI_ORIGIN}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              `Translate every string in the given JSON array into the language with BCP-47 tag "${language}".`,
              'Return a JSON object of the shape {"lines": string[]} with exactly the same number of elements, in the same order.',
              'Translate the sentences. Leave reference numbers, clinic names and drug brand names as written.',
            ].join(' '),
          },
          { role: 'user', content: JSON.stringify(lines) },
        ],
      }),
    })

    if (!response.ok) {
      console.error(`[degrade] translation call failed: ${response.status} ${await response.text()}`)
      return lines
    }

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content
    if (!content) return lines

    const parsed = JSON.parse(content) as { lines?: unknown }
    if (!Array.isArray(parsed.lines) || parsed.lines.length !== lines.length) return lines

    return parsed.lines.map((line, i) => (typeof line === 'string' && line.trim() ? line : lines[i]))
  } catch (err) {
    console.error(`[degrade] translation error: ${String(err)}`)
    return lines
  }
}
