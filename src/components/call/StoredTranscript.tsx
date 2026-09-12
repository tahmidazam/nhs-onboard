import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Message,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from '@/components/ui/message'
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

/** Only reached while the call is still open; an ended one always has a state. */
const WAITING = {
  pending: 'The call has not connected yet.',
  'in-progress': 'The call is running. The transcript is saved when it ends.',
} as const

/**
 * Vapi's endedReason, in words. A transcript that stops mid-sentence looks the
 * same however the call died, so name the cause rather than leave the reader
 * guessing.
 */
const ENDED: Record<string, string> = {
  'customer-ended-call': 'The patient hung up.',
  'assistant-ended-call': 'The assistant ended the call.',
  'silence-timed-out': 'The line went quiet and the call timed out.',
  'customer-did-not-answer': 'Nobody answered.',
  'exceeded-max-duration': 'The call hit its maximum duration.',
  'pipeline-error': 'The call failed part way through.',
}

function endedAs(reason: string | undefined): string | null {
  if (!reason) return null
  if (ENDED[reason]) return ENDED[reason]
  /** Anything to do with credit or billing stops the call without warning. */
  if (/credit|balance|payment|billing/i.test(reason)) return 'The account ran out of credit.'
  if (/error|failed/i.test(reason)) return `The call failed: ${reason}.`
  return `Ended as ${reason}.`
}

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
    /**
     * A row sits at in-progress until something reports the call is over, so
     * say which of the two it is rather than claiming a finished call is
     * running. See `api.call.finish` and the poll in `convex/call.ts`.
     */
    const waiting =
      call.status === 'failed'
        ? 'The last call ended without a transcript. Nobody picked up, or it ended before anyone spoke.'
        : call.ended
          ? 'The call has ended. Vapi has not sent the transcript back yet.'
          : (WAITING[call.status as keyof typeof WAITING] ??
            'The call ended without a transcript. Check the assistant server URL ends .convex.site.')

    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Saved transcript</h2>
        <p className="text-sm text-muted-foreground">{waiting}</p>
      </div>
    )
  }

  const turns = parseTurns(call.transcript)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-medium">Saved transcript</h2>
        {endedAs(call.endedReason) ? (
          <span className="text-xs text-muted-foreground">{endedAs(call.endedReason)}</span>
        ) : null}
        {call.transcriptSource === 'live' ? (
          <span className="text-xs text-muted-foreground">
            Saved from the browser. Vapi's copy replaces it when it arrives.
          </span>
        ) : null}
      </div>
      {turns.length === 0 ? (
        /** No line carried a speaker prefix, so show the transcript as it arrived. */
        <p className="text-sm whitespace-pre-wrap">{call.transcript}</p>
      ) : (
        <MessageGroup className="gap-4">
          {turns.map((turn, i) => {
            const assistant = turn.speaker === 'assistant'
            return (
              <Message key={i} align={assistant ? 'start' : 'end'}>
                <MessageContent>
                  <MessageHeader>{assistant ? 'Assistant' : patientName}</MessageHeader>
                  <Bubble variant={assistant ? 'muted' : 'default'}>
                    <BubbleContent>{turn.text}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            )
          })}
        </MessageGroup>
      )}
    </div>
  )
}
