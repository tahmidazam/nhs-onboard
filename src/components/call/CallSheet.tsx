import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTurns } from '@/lib/transcript'
import { CallPanel } from './CallPanel'
import { PhoneCallForm } from './PhoneCallForm'
import { StoredTranscript } from './StoredTranscript'

interface CallSheetProps {
  patientId: Id<'patients'>
  patientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Both call paths for one patient, opened from the board's call column.
 * The questions come from the patient's open gaps, so the call asks what the
 * records could not answer.
 */
export function CallSheet({ patientId, patientName, open, onOpenChange }: CallSheetProps) {
  /** Nothing is read until the sheet opens, so the board does not fan out a query per row. */
  const context = useQuery(api.call.callContext, open ? { patientId } : 'skip')
  const register = useMutation(api.call.register)
  const finish = useMutation(api.call.finish)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Call {patientName}</SheetTitle>
          <SheetDescription>
            Ring the phone on DEMO_PHONE_NUMBER, or talk to the assistant in this browser.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 pb-6">
          {context === undefined ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : context === null ? (
            <p className="text-sm text-muted-foreground">
              That patient is no longer in the database.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">What the assistant will ask</h2>
                {context.goals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    The rules left no open questions, so a call has nothing to recover. Run the
                    pipeline first if you expected some.
                  </p>
                ) : (
                  <ol className="flex list-decimal flex-col gap-2 pl-5">
                    {context.goals.map((goal) => (
                      <li key={goal} className="text-sm">
                        {goal}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <PhoneCallForm patientId={patientId} questionCount={context.goals.length} />
              <CallPanel
                patientName={context.patientName}
                patientAge={context.patientAge}
                patientDob={context.patientDob}
                goals={context.goals}
                onCallStarted={async (vapiCallId) => {
                  await register({ patientId, vapiCallId })
                }}
                onCallEnded={async (vapiCallId, turns) => {
                  await finish({ vapiCallId, transcript: formatTurns(turns) })
                }}
              />
              <StoredTranscript patientId={patientId} patientName={context.patientName} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
