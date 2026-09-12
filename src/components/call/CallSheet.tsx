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
              <PhoneCallForm patientId={patientId} questionCount={context.goals.length} />
              <CallPanel
                patientName={context.patientName}
                patientAge={context.patientAge}
                patientDob={context.patientDob}
                goals={context.goals}
                onCallStarted={async (vapiCallId) => {
                  await register({ patientId, vapiCallId })
                }}
              />
              <StoredTranscript patientId={patientId} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
