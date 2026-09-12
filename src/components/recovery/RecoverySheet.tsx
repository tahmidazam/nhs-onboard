import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { RecoveryMetric } from '@/types'

interface RecoverySheetProps {
  patientId: Id<'patients'>
  patientName: string
  metric: RecoveryMetric
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ScoredFact = { kind: 'condition' | 'medication' | 'allergy'; fact: string; recovered: boolean }

const KIND_LABEL = {
  condition: 'Condition',
  medication: 'Medication',
  allergy: 'Allergy',
} as const

function FactList({ facts }: { facts: ScoredFact[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {facts.map((scored) => (
        <li key={`${scored.kind}:${scored.fact}`} className="flex items-baseline justify-between gap-4">
          <span className="text-sm">{scored.fact}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[scored.kind]}</span>
        </li>
      ))}
    </ul>
  )
}

/** Detail view for one patient's recovery metric, opened from the board's recovery column. */
export function RecoverySheet({ patientId, patientName, metric, open, onOpenChange }: RecoverySheetProps) {
  /** Read only while the sheet is open, so the board does not fan out a query per row. */
  const detail = useQuery(api.recovery.detailForPatient, open ? { patientId } : 'skip')

  const missed = detail?.facts.filter((scored) => !scored.recovered) ?? []
  const recovered = detail?.facts.filter((scored) => scored.recovered) ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Recovery for {patientName}</SheetTitle>
          <SheetDescription>
            {metric.recovered} of {metric.total} facts in the simulator record have been recovered.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 pb-6">
          {detail === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Still missing</h2>
                {missed.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Every fact the simulator holds has been recovered.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      The documents carried these, and nothing reached the record. A call is the
                      remaining way to get them.
                    </p>
                    <FactList facts={missed} />
                  </>
                )}
              </div>

              {recovered.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h2 className="text-sm font-medium">Recovered</h2>
                  <FactList facts={recovered} />
                </div>
              ) : null}
            </>
          )}

          <p className="text-sm text-muted-foreground">
            Excludes synthesised facts, such as the generated vaccination card, because the
            simulator holds no ground truth to check them against.
          </p>
        </div>

        <div className="mt-auto flex justify-end p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
