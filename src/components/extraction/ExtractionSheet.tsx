import { useState } from 'react'
import { useAction } from 'convex/react'
import { RotateCcwIcon } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { formatAgent, formatDocumentKind } from '@/lib/format'
import { AgentRunList } from './AgentRunList'
import type { ExtractionFailure } from './types'

/** Names the document a failed call was reading, for the sentence it sits in. */
function formatDocumentSource(kind: string | undefined): string {
  if (!kind) return 'a document that has since been deleted'
  return `the ${formatDocumentKind(kind).toLowerCase()}`
}

interface ExtractionSheetProps {
  patientId: Id<'patients'>
  patientName: string
  claimCount: number
  failures: ExtractionFailure[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Detail view for one patient's extraction, opened from the board's claims column. */
export function ExtractionSheet({
  patientId,
  patientName,
  claimCount,
  failures,
  open,
  onOpenChange,
}: ExtractionSheetProps) {
  const reExtract = useAction(api.extract.reExtract)
  const [running, setRunning] = useState(false)

  async function handleReExtract() {
    setRunning(true)
    try {
      const summary = await reExtract({ patientId })
      toast.add({
        type: 'success',
        title: 'Extraction re-run',
        description: `${summary.claims} claims, ${summary.failures} calls still failing.`,
      })
    } catch (err) {
      toast.add({
        type: 'error',
        title: 'Re-extraction failed',
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Extraction for {patientName}</SheetTitle>
          <SheetDescription>
            Four agents read each document. Every fact one of them finds becomes a claim.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Claims extracted</dt>
            <dd className="tabular-nums">{claimCount}</dd>
            <dt className="text-muted-foreground">Calls that failed</dt>
            <dd className="tabular-nums">{failures.length}</dd>
          </dl>
          {failures.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                {failures.length === 1 ? 'The call that failed' : 'The calls that failed'}
              </h3>
              <ul className="flex flex-col gap-3">
                {failures.map((failure, index) => (
                  <li
                    key={`${failure.documentId}-${failure.agent}-${index}`}
                    className="flex flex-col gap-1 border-b border-border pb-3 text-sm last:border-b-0 last:pb-0"
                  >
                    <span className="font-medium">
                      {formatAgent(failure.agent)} agent on {formatDocumentSource(failure.documentKind)}
                    </span>
                    <span className="text-muted-foreground">{failure.message}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                A call is retried once before it is recorded here. Whatever that document held for
                that agent is missing from the record, so the recovery figure counts it as not
                recovered.
              </p>
            </div>
          )}
          <AgentRunList patientId={patientId} />
        </div>
        <div className="mt-auto flex justify-end gap-2 p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleReExtract} disabled={running}>
            {running ? <Spinner /> : <RotateCcwIcon />}
            {running ? 'Reading the documents again' : 'Read the documents again'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
