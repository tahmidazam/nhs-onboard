import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

interface ConfirmWriteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  confirming: boolean
  onConfirm: () => void
}

/** Confirms the approved set before it writes to the sim. See ui-conventions on Dialog. */
export function ConfirmWriteDialog({ open, onOpenChange, count, confirming, onConfirm }: ConfirmWriteDialogProps) {
  const label = `Write ${count} action${count === 1 ? '' : 's'} to the record`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Each approved recommendation moves to the pharmacy, referrals, diagnostics or GP site
            it names. This cannot be undone from this screen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={confirming} />}>Cancel</DialogClose>
          <Button onClick={onConfirm} disabled={confirming}>
            {confirming && <Spinner />}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
