import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { RecoveryMetric } from '@/types'

interface RecoverySheetProps {
  patientName: string
  metric: RecoveryMetric
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Detail view for one patient's recovery metric, opened from the board's recovery column. */
export function RecoverySheet({ patientName, metric, open, onOpenChange }: RecoverySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Recovery for {patientName}</SheetTitle>
          <SheetDescription>
            How many facts from the simulator record the pipeline has recovered so far.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Held in the simulator record</dt>
            <dd className="tabular-nums">{metric.total}</dd>
            <dt className="text-muted-foreground">Recovered so far</dt>
            <dd className="tabular-nums">{metric.recovered}</dd>
          </dl>
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
