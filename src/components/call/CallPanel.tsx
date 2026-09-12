import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { Turn } from '@/lib/transcript'
import { useVapiCall } from './useVapiCall'

/**
 * Places one call and renders each turn as it completes.
 * This is the live view. The same turns are saved when the call ends, and are
 * replaced by Vapi's own copy once the end-of-call report lands.
 */

interface CallPanelProps {
  patientName: string
  patientAge: number
  patientDob: string
  /** Gap questions. Passed to the assistant as {{goals}}. */
  goals: string[]
  /**
   * Runs once Vapi returns the call id. Wire this to `api.call.register` so the
   * end-of-call report has a row to write into. Without it the call still runs
   * and the transcript is discarded.
   */
  onCallStarted?: (vapiCallId: string) => void | Promise<void>
  /**
   * Runs when the call ends, with the turns spoken. Wire this to
   * `api.call.finish` so the transcript is saved as soon as the call is over,
   * rather than whenever the end-of-call report turns up.
   */
  onCallEnded?: (vapiCallId: string, turns: Turn[]) => void | Promise<void>
}

const STATUS_COPY = {
  idle: 'Not started.',
  connecting: 'Connecting.',
  'in-progress': 'Call in progress.',
  ended: 'Call ended.',
  failed: 'Call failed.',
} as const

/**
 * Vapi has no language-change event, so the script the patient is speaking in
 * is read off the transcript instead. A script is not a language: Devanagari
 * carries Hindi, Marathi and Nepali alike, so the label names the script.
 */
const SCRIPTS: [RegExp, string][] = [
  [/[ঀ-৿]/, 'Bengali'],
  [/[ऀ-ॿ]/, 'Devanagari'],
  [/[؀-ۿ]/, 'Arabic'],
  [/[Ѐ-ӿ]/, 'Cyrillic'],
]

function scriptOf(turns: { speaker: string; text: string }[]): string | null {
  const said = turns
    .filter((t) => t.speaker !== 'assistant')
    .map((t) => t.text)
    .join(' ')
  return SCRIPTS.find(([pattern]) => pattern.test(said))?.[1] ?? null
}

export function CallPanel({
  patientName,
  patientAge,
  patientDob,
  goals,
  onCallStarted,
  onCallEnded,
}: CallPanelProps) {
  const { status, transcript, problem, start, stop } = useVapiCall({
    onStarted: onCallStarted,
    onEnded: onCallEnded,
  })
  const live = status === 'connecting' || status === 'in-progress'
  const script = scriptOf(transcript)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {live ? (
          <Button variant="destructive" onClick={stop}>
            End call
          </Button>
        ) : (
          <Button onClick={() => start({ goals, patientName, patientAge, patientDob })}>Call {patientName}</Button>
        )}
        <span className="text-sm text-muted-foreground">{STATUS_COPY[status]}</span>
        {script ? (
          <span className="text-sm text-muted-foreground">
            {patientName} is answering in {script} script.
          </span>
        ) : null}
      </div>

      {problem ? (
        <Alert variant="destructive">
          <AlertTitle>The call could not run.</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has spoken yet. Each line appears here when a turn finishes.
          </p>
        ) : (
          transcript.map((line, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {line.speaker === 'assistant' ? 'Assistant' : patientName}
              </span>
              <p className="text-sm">{line.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
