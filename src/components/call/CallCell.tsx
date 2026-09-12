import { useState } from 'react'
import { PhoneIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Id } from '../../../convex/_generated/dataModel'
import { CallSheet } from './CallSheet'

interface CallCellProps {
  patientId: Id<'patients'>
  patientName: string
}

/** Table cell opening the call sheet for one patient. */
export function CallCell({ patientId, patientName }: CallCellProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <PhoneIcon />
        Call
      </Button>
      <CallSheet
        patientId={patientId}
        patientName={patientName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
