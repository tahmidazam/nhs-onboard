import { useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import type { Confidence } from '@/types'
import { ConfirmWriteDialog } from './ConfirmWriteDialog'
import { RecommendationCard } from './RecommendationCard'

const routeApi = getRouteApi('/patient/$id/review')

const COLUMNS: { bucket: Confidence; title: string; description: string }[] = [
  {
    bucket: 'document-evidenced',
    title: 'Document evidenced',
    description: 'Backed by a source document. Approve to write it to the sim.',
  },
  {
    bucket: 'patient-reported',
    title: 'Patient reported',
    description: 'Asserted by the patient on the call. Needs the clinician to confirm before it can be written.',
  },
  {
    bucket: 'uncertain-mapping',
    title: 'Uncertain mapping',
    description: 'Found but not safely resolved. Shown as is and cannot be actioned.',
  },
]

function groupByConfidence(recommendations: Doc<'recommendations'>[]): Map<Confidence, Doc<'recommendations'>[]> {
  const grouped = new Map<Confidence, Doc<'recommendations'>[]>()
  for (const recommendation of recommendations) {
    const list = grouped.get(recommendation.confidence) ?? []
    list.push(recommendation)
    grouped.set(recommendation.confidence, list)
  }
  return grouped
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The GP review screen. Recommendations grouped by confidence bucket, each
 * with its full evidence chain, approve and dismiss per row, and a single
 * confirm step that writes the approved set to the sim.
 */
export function Review() {
  const { id } = routeApi.useParams()
  const patientId = id as Id<'patients'>

  const data = useQuery(api.review.forPatient, { patientId })
  const confirmApproved = useMutation(api.review.confirmApproved)
  const dismiss = useMutation(api.review.dismiss)

  const [selected, setSelected] = useState<Set<Id<'recommendations'>>>(new Set())
  const [dismissing, setDismissing] = useState<Set<Id<'recommendations'>>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  function toggleSelected(recommendationId: Id<'recommendations'>) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(recommendationId)) next.delete(recommendationId)
      else next.add(recommendationId)
      return next
    })
  }

  async function handleDismiss(recommendationId: Id<'recommendations'>) {
    setDismissing((prev) => new Set(prev).add(recommendationId))
    setSelected((prev) => {
      if (!prev.has(recommendationId)) return prev
      const next = new Set(prev)
      next.delete(recommendationId)
      return next
    })
    try {
      await dismiss({ recommendationId })
    } catch (err) {
      toast.add({ type: 'error', title: 'Could not dismiss the recommendation', description: message(err) })
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev)
        next.delete(recommendationId)
        return next
      })
    }
  }

  async function handleConfirm() {
    const recommendationIds = [...selected]
    setConfirming(true)
    try {
      await confirmApproved({ recommendationIds })
      toast.add({
        type: 'success',
        title: `${recommendationIds.length} action${recommendationIds.length === 1 ? '' : 's'} written to the record.`,
      })
      setSelected(new Set())
      setDialogOpen(false)
    } catch (err) {
      toast.add({ type: 'error', title: 'Could not write to the record', description: message(err) })
    } finally {
      setConfirming(false)
    }
  }

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-7 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((column) => (
            <div key={column} className="flex flex-col gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.patient === null) {
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

  if (data.recommendations.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No recommendations yet</EmptyTitle>
          <EmptyDescription>
            The rule pack has not produced recommendations for {data.patient.name}. It runs after
            extraction, mapping and the call.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const byBucket = groupByConfidence(data.recommendations)
  const selectedCount = selected.size

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">Review for {data.patient.name}</h1>
          <p className="text-sm text-muted-foreground">
            Every recommendation the rule pack produced, grouped by how well evidenced it is.
          </p>
        </div>
        <Button disabled={selectedCount === 0} onClick={() => setDialogOpen(true)}>
          Write {selectedCount} action{selectedCount === 1 ? '' : 's'} to the record
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const rows = byBucket.get(column.bucket) ?? []
          return (
            <div key={column.bucket} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-medium">{column.title}</h2>
                <p className="text-xs text-muted-foreground">{column.description}</p>
              </div>

              <div className="flex flex-col gap-3">
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None in this bucket.</p>
                ) : (
                  rows.map((recommendation) => (
                    <RecommendationCard
                      key={recommendation._id}
                      recommendation={recommendation}
                      selected={selected.has(recommendation._id)}
                      dismissing={dismissing.has(recommendation._id)}
                      onToggleSelected={() => toggleSelected(recommendation._id)}
                      onDismiss={() => handleDismiss(recommendation._id)}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmWriteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        count={selectedCount}
        confirming={confirming}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
