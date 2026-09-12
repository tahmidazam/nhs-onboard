import { useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Id } from '../../../convex/_generated/dataModel'
import { ExtractionSheet } from './ExtractionSheet'
import type { ExtractionProgress } from './types'

interface ExtractionCellProps {
  patientId: Id<'patients'>
  patientName: string
  progress: ExtractionProgress | undefined
}

/**
 * Table cell showing the live claim count, opening the extraction detail sheet
 * on click.
 *
 * The count climbs during `extracting` because Convex is reactive over the
 * `claims` table, so a stage that takes fifteen seconds reads as working rather
 * than hung. See ADR 16.
 *
 * A patient with no claims and no failures held nothing worth extracting, which
 * is a legitimate record here. A patient with no claims and a failure is a bug,
 * and the warning is what separates the two on the row.
 */
export function ExtractionCell({ patientId, patientName, progress }: ExtractionCellProps) {
  const [open, setOpen] = useState(false)

  if (!progress) return <Skeleton className="h-4 w-12" />

  const { claimCount, failures } = progress
  const label =
    failures.length === 1 ? '1 extraction call failed' : `${failures.length} extraction calls failed`

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
          className="tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          {claimCount}
        </button>
        {failures.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              onClick={(event) => {
                event.stopPropagation()
                setOpen(true)
              }}
              className="flex items-center gap-1 text-destructive"
            >
              <TriangleAlertIcon className="size-3.5" />
              <span className="tabular-nums">{failures.length}</span>
              <span className="sr-only">{label}</span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <ExtractionSheet
        patientId={patientId}
        patientName={patientName}
        claimCount={claimCount}
        failures={failures}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
