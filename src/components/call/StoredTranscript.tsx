import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The transcript as it was saved, not the live pane.
 * It appears on its own when the end-of-call report reaches the webhook,
 * because the query is reactive.
 */

interface StoredTranscriptProps {
  patientId: Id<'patients'>
}

const WAITING = {
  pending: 'The call has not connected yet.',
  'in-progress': 'The call is running. The transcript is saved when it ends.',
  failed: 'The last call did not connect, so there is no transcript.',
} as const

export function StoredTranscript({ patientId }: StoredTranscriptProps) {
  const call = useQuery(api.call.latestCall, { patientId })

  if (call === undefined) return null

  if (call === null) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm">Saved transcript</h2>
        <p className="text-sm text-muted-foreground">
          No call has been placed for this patient yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm">Saved transcript</h2>
      {call.status === 'complete' && call.transcript ? (
        <p className="text-sm whitespace-pre-wrap">{call.transcript}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {WAITING[call.status as keyof typeof WAITING] ??
            'The call ended without a transcript. Check the assistant server URL ends .convex.site.'}
        </p>
      )}
    </div>
  )
}
