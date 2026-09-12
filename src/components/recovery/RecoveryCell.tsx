import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { RecoveryMetric } from '@/types'
import { RecoverySheet } from './RecoverySheet'

interface RecoveryCellProps {
  patientName: string
  metric: RecoveryMetric | undefined
}

/** Table cell showing recovered/total, opening the recovery detail sheet on click. */
export function RecoveryCell({ patientName, metric }: RecoveryCellProps) {
  const [open, setOpen] = useState(false)

  if (!metric) return <Skeleton className="h-4 w-12" />

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        className="tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        {metric.recovered} / {metric.total}
      </button>
      <RecoverySheet patientName={patientName} metric={metric} open={open} onOpenChange={setOpen} />
    </>
  )
}
