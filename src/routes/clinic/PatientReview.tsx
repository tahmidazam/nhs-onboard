import { useState } from 'react'
import { Link, getRouteApi } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ActionSilos } from '@/components/clinic/ActionSilos'
import { ConfirmWriteDialog } from '@/components/clinic/ConfirmWriteDialog'
import { EvidenceSheet } from '@/components/clinic/EvidenceSheet'
import { GapPanel } from '@/components/clinic/GapPanel'
import { SbarHeader } from '@/components/clinic/SbarHeader'
import { plural } from '@/components/clinic/copy'
import { toast } from '@/components/ui/toast'
import { formatStage } from '@/lib/format'

/**
 * One patient, ready to sign off. The clinician screen at `/patient/$id`.
 *
 * ADR 21 makes this the whole of the clinician side rather than a child route
 * under the operator's document view: an SBAR handover over rows siloed by
 * clinical action type, with the evidence chain a click away in a Sheet.
 *
 * Everything the screen reads comes from one subscription. `clinic.summary`
 * counts the bands server-side for the reason its own comment gives: a UI that
 * filters five hundred recommendations in the browser to show one number is the
 * mistake it exists to avoid.
 */

/** Pathless layout routes, so the generated id carries `_clinic`. See ADR 21. */
const routeApi = getRouteApi('/_clinic/patient/$id')

/**
 * The rule whose gap the call uses to settle sex. A string because this screen
 * reads a stored `gaps.ruleId` and imports nothing from `rules/`, the direction
 * `convex/clinic.ts` already runs in.
 */
const SEX_GAP_RULE = 'nhs-establish-sex'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Shaped like the header and two silos, per the UI conventions on pending states. */
function ReviewSkeleton() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((band) => (
          <div key={band} className="grid gap-2 border-t border-border py-3 sm:grid-cols-[7rem_1fr]">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1].map((silo) => (
          <div key={silo} className="flex flex-col gap-2 pl-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PatientReview() {
  const { id } = routeApi.useParams()
  const patientId = id as Id<'patients'>

  const summary = useQuery(api.clinic.summary, { patientId })
  const confirmApproved = useMutation(api.review.confirmApproved)
  const dismiss = useMutation(api.review.dismiss)

  const [selected, setSelected] = useState<Set<Id<'recommendations'>>>(new Set())
  /** Held by id, not by document, so the open Sheet tracks a dismiss or a saved note. */
  const [detailId, setDetailId] = useState<Id<'recommendations'> | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  function toggle(recommendationId: Id<'recommendations'>) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(recommendationId)) next.delete(recommendationId)
      else next.add(recommendationId)
      return next
    })
  }

  if (summary === undefined) return <ReviewSkeleton />

  if (summary === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Patient not found</EmptyTitle>
          <EmptyDescription>
            This patient has not been onboarded, or the record no longer exists.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const { situation, gaps, recommendations } = summary
  const detail = recommendations.find((row) => row._id === detailId) ?? null

  /**
   * A tick can outlive the row it was on: a second tab dismissing a row leaves
   * a stale id in the set, and `review.confirmApproved` would skip it silently
   * while the button had already counted it. So the count is the intersection.
   */
  const proposedIds = new Set(
    recommendations.filter((row) => row.status === 'proposed').map((row) => row._id),
  )
  const approving = [...selected].filter((recommendationId) => proposedIds.has(recommendationId))

  async function handleDismiss(recommendationId: Id<'recommendations'>) {
    setDismissing(true)
    setSelected((prev) => {
      if (!prev.has(recommendationId)) return prev
      const next = new Set(prev)
      next.delete(recommendationId)
      return next
    })
    try {
      await dismiss({ recommendationId })
      setDetailId(null)
    } catch (err) {
      toast.add({ type: 'error', title: 'Could not dismiss the action', description: message(err) })
    } finally {
      setDismissing(false)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      await confirmApproved({ recommendationIds: approving })
      toast.add({
        type: 'success',
        title: `${approving.length} ${plural(approving.length, 'action')} written to the record.`,
      })
      setSelected(new Set())
      setDialogOpen(false)
    } catch (err) {
      toast.add({ type: 'error', title: 'Could not write to the record', description: message(err) })
    } finally {
      setConfirming(false)
    }
  }

  const writeLabel = `Write ${approving.length} ${plural(approving.length, 'action')} to the record`

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/*
       * The shell's brand link also goes to `/`, but a GP reading one patient
       * should not have to work out that the product name is the way back. It
       * lives here rather than in `ClinicShell` so the list itself does not
       * offer to navigate to the list.
       */}
      <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        All patients
      </Link>

      <SbarHeader
        summary={summary}
        sexGapOpen={gaps.some((gap) => gap.ruleId === SEX_GAP_RULE && gap.status === 'open')}
        action={
          <Button
            disabled={approving.length === 0 || confirming}
            onClick={() => setDialogOpen(true)}
          >
            {confirming && <Spinner />}
            {writeLabel}
          </Button>
        }
      />

      <GapPanel gaps={gaps} />

      {recommendations.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No actions proposed</EmptyTitle>
            <EmptyDescription>
              The rule pack runs after extraction, mapping and the call. {situation.name} is at{' '}
              {formatStage(situation.stage).toLowerCase()}.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ActionSilos
          recommendations={recommendations}
          selected={selected}
          onToggle={toggle}
          onOpenDetail={(recommendation) => setDetailId(recommendation._id)}
        />
      )}

      <EvidenceSheet
        recommendation={detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
        dismissing={dismissing}
        onDismiss={(recommendation) => void handleDismiss(recommendation._id)}
      />

      <ConfirmWriteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        count={approving.length}
        confirming={confirming}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  )
}
