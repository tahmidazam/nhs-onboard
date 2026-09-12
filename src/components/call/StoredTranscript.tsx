import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { parseTurns } from '@/lib/transcript'

/**
 * The transcript as it was saved, not the live pane.
 * It appears on its own when the end-of-call report reaches the webhook,
 * because the query is reactive.
 */

interface StoredTranscriptProps {
  patientId: Id<'patients'>
  patientName: string
}

const WAITING = {
  pending: 'The call has not connected yet.',
  'in-progress': 'The call is running. The transcript is saved when it ends.',
  failed: 'The last call did not connect, so there is no transcript.',
} as const

export function StoredTranscript({ patientId, patientName }: StoredTranscriptProps) {
  const call = useQuery(api.call.latestCall, { patientId })

  if (call === undefined) return null

  if (call === null) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Saved transcript</h2>
        <p className="text-sm text-muted-foreground">
          No call has been placed for this patient yet.
        </p>
      </div>
    )
  }

  if (call.status !== 'complete' || !call.transcript) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Saved transcript</h2>
        <p className="text-sm text-muted-foreground">
          {WAITING[call.status as keyof typeof WAITING] ??
            'The call ended without a transcript. Check the assistant server URL ends .convex.site.'}
        </p>
      </div>
    )
  }

  const turns = parseTurns(call.transcript)

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Saved transcript</h2>
      {turns.length === 0 ? (
        <p className="text-sm whitespace-pre-wrap">{call.transcript}</p>
      ) : (
        turns.map((turn, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {turn.speaker === 'assistant' ? 'Assistant' : patientName}
            </span>
            <p className="text-sm">{turn.text}</p>
          </div>
        ))
      )}
    </div>
  )
}
