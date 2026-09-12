import { useEffect, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { ChevronRightIcon } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { BUCKET_LABEL, BUCKET_VARIANT, SILOS, SILO_ACCENT, SILO_TEXT } from '@/lib/buckets'
import { cn } from '@/lib/utils'
import { mayWriteBack } from '@/lib/writeBack'
import { REFUSAL_COPY } from './copy'
import { groupBySilo, type Recommendation } from './summary'

/**
 * The actions, siloed by what the GP has to do.
 *
 * ADR 21 makes clinical action type the axis of this screen rather than
 * evidence class: a prescription to issue and a referral to make are different
 * jobs, while how well evidenced either is belongs on the row. So the silo
 * carries the colour and the row carries the flag.
 *
 * Silo colour comes from the six `--silo-*` tokens through `SILO_ACCENT` and
 * `SILO_TEXT`. It cannot come from a badge variant: those three mean a
 * confidence bucket everywhere in the app and borrowing one here would make a
 * colour mean two things.
 */

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const SAVE_DELAY_MS = 600

/**
 * The clinician's own words, which reach the sim on `indication` or
 * `clinicalDetails`. Debounced rather than saved per keystroke, and flushed on
 * blur so clicking straight through to the write button cannot lose the note.
 *
 * Local state is seeded once and never resynced from the server. The only
 * writer is the person typing in it, and resyncing would fight them mid-word.
 */
function NoteField({
  recommendationId,
  note,
}: {
  recommendationId: Id<'recommendations'>
  note: string | undefined
}) {
  const setNote = useMutation(api.review.setNote)
  const [value, setValue] = useState(note ?? '')
  const saved = useRef(note ?? '')

  function save(next: string) {
    if (next === saved.current) return
    saved.current = next
    // Raw, not trimmed: review.setNote trims server-side and drops the field on empty.
    void setNote({ recommendationId, note: next }).catch((err) => {
      toast.add({ type: 'error', title: 'Could not save the note', description: message(err) })
    })
  }

  useEffect(() => {
    if (value === saved.current) return
    const timer = setTimeout(() => save(value), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // The text alone: `save` reads a ref and the mutation, neither of which
    // changes what the pending timer should write.
  }, [value])

  return (
    <Textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => save(value)}
      placeholder="Additional information for the record"
      className="min-h-14 text-sm"
      aria-label="Additional information"
    />
  )
}

interface ActionRowProps {
  recommendation: Recommendation
  selected: boolean
  onToggle: (recommendationId: Id<'recommendations'>) => void
  onOpenDetail: (recommendation: Recommendation) => void
}

/**
 * One action. A checkbox, the title, its confidence flag, and a way in. That is
 * the whole face of the row: the quotes, the citation and the rule live in the
 * Sheet.
 *
 * A row `mayWriteBack` refuses still renders here, with the ground for the
 * refusal and no tick. ADR 3 suppresses nothing, and a row hidden below a
 * threshold is the failure a clinician cannot compensate for.
 */
function ActionRow({ recommendation, selected, onToggle, onOpenDetail }: ActionRowProps) {
  const decision = mayWriteBack(recommendation)
  const proposed = recommendation.status === 'proposed'

  return (
    <li className="flex flex-col gap-2 border-t border-border py-2 first:border-t-0">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={selected}
          disabled={!proposed || !decision.writable}
          onCheckedChange={() => onToggle(recommendation._id)}
          aria-label={`Approve ${recommendation.title}`}
        />
        <button
          type="button"
          onClick={() => onOpenDetail(recommendation)}
          className="flex flex-1 items-start gap-1 text-left text-sm underline-offset-4 hover:underline"
        >
          {recommendation.title}
          <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {recommendation.synthesised && (
            /* A flag, not a Badge: the variants are spoken for by the buckets. */
            <span className="text-xs text-muted-foreground">Synthesised</span>
          )}
          <Badge variant={BUCKET_VARIANT[recommendation.confidence]}>
            {BUCKET_LABEL[recommendation.confidence]}
          </Badge>
        </div>
      </div>

      {!proposed ? (
        <p className="pl-7 text-xs text-muted-foreground">
          {recommendation.status === 'approved' ? 'Approved and written.' : 'Dismissed.'}
        </p>
      ) : (
        !decision.writable && (
          <p className="pl-7 text-xs text-muted-foreground">{REFUSAL_COPY[decision.refusal]}</p>
        )
      )}

      {/*
        The note box opens on the tick rather than sitting on every row: a note
        travels to the sim with the action, so a row that cannot be written has
        nowhere to put one, and a textarea under thirty rows is the wall of text
        this screen exists to remove.
      */}
      {proposed && decision.writable && (selected || recommendation.clinicianNote) && (
        <div className="pl-7">
          <NoteField
            recommendationId={recommendation._id}
            note={recommendation.clinicianNote}
          />
        </div>
      )}
    </li>
  )
}

interface ActionSilosProps {
  recommendations: readonly Recommendation[]
  selected: Set<Id<'recommendations'>>
  onToggle: (recommendationId: Id<'recommendations'>) => void
  onOpenDetail: (recommendation: Recommendation) => void
}

export function ActionSilos({
  recommendations,
  selected,
  onToggle,
  onOpenDetail,
}: ActionSilosProps) {
  const bySilo = groupBySilo(recommendations)

  return (
    <div className="flex flex-col gap-6">
      {SILOS.map((silo) => {
        const rows = bySilo.get(silo.id)
        if (!rows || rows.length === 0) return null
        const waiting = rows.filter((row) => row.status === 'proposed').length

        return (
          <section
            key={silo.id}
            id={`silo-${silo.id}`}
            className={cn('flex scroll-mt-6 flex-col gap-1 border-l-2 pl-4', SILO_ACCENT[silo.id])}
          >
            <h2 className={cn('flex items-baseline gap-1.5 text-sm font-medium', SILO_TEXT[silo.id])}>
              {silo.title}
              <span className="text-xs text-muted-foreground tabular-nums">{waiting} waiting</span>
            </h2>
            <ul className="flex flex-col">
              {rows.map((row) => (
                <ActionRow
                  key={row._id}
                  recommendation={row}
                  selected={selected.has(row._id)}
                  onToggle={onToggle}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
