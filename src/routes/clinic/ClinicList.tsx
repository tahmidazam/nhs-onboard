import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { Link, useNavigate } from '@tanstack/react-router'
import type { FunctionReturnType } from 'convex/server'
import { CheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { BUCKET_KEY, BUCKET_LABEL, BUCKET_ORDER, BUCKET_VARIANT } from '@/lib/buckets'
import { formatDate, formatStage } from '@/lib/format'
import { cn } from '@/lib/utils'
import { api } from '../../../convex/_generated/api'

/**
 * The clinician's list: patients whose recommendations are waiting on a
 * signature. Distinct from the operator board, which lists pipeline stages.
 * See ADR 21.
 *
 * `clinic.list` already aggregates per patient and caps at 100 rows, so this
 * screen fires one subscription for the whole table rather than one per row.
 * That is the same lesson convex/board.ts records, reached from the other end.
 */

type ClinicRow = FunctionReturnType<typeof api.clinic.list>[number]

/** The camelCase shape the validator forces on the bucket counts. */
/**
 * The three buckets of ADR 3, as they are spelled on the wire against how a
 * Convex validator key has to be spelled: `document-evidenced` is not a legal
 * identifier, so the counts arrive camelCased and this is what reads them back
 * in BUCKET_ORDER. Exhaustive over the union, and keyed off the query's own
 * return type, so neither spelling can drift without failing the typecheck.
 * convex/clinic.ts holds the mirror of this for the write side.
 */
const SEX_LABEL: Record<'male' | 'female', string> = { male: 'Male', female: 'Female' }

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<AppTableFeatures, ClinicRow>()

/** Whole years at today's date, UTC both sides so a timezone cannot shift a birthday. */
function ageInYears(birthDate: string, now: Date): number | null {
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null

  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())
  if (beforeBirthday) age -= 1
  return age < 0 ? null : age
}

/**
 * Age, then sex where the record has one.
 *
 * Per ADR 20 sex is read off the simulator's pronouns, so it can be missing
 * entirely: a record with no pronoun and no call has nothing to show, and
 * guessing a default here would be inventing a clinical fact. Where it is
 * present the badge carries its confidence bucket, which is how the column
 * distinguishes a pronoun in the notes from an answer the patient gave on the
 * call. The badge variants mean a bucket and nothing else. See ADR 3.
 */
function AgeAndSexCell({ birthDate, sex }: { birthDate: string; sex: ClinicRow['sex'] }) {
  // The wall clock, not the sim clock: ADR 21 keeps simulation time off the
  // clinician side, and reading it is an action, not a subscription.
  const age = ageInYears(birthDate, new Date())

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger className="tabular-nums">{age ?? birthDate}</TooltipTrigger>
        <TooltipContent>Born {formatDate(birthDate)}</TooltipContent>
      </Tooltip>
      {sex ? (
        <Tooltip>
          <TooltipTrigger className="flex items-center">
            <Badge variant={BUCKET_VARIANT[sex.confidence]}>{SEX_LABEL[sex.value]}</Badge>
          </TooltipTrigger>
          <TooltipContent>
            {SEX_LABEL[sex.value]}, {BUCKET_LABEL[sex.confidence].toLowerCase()}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted-foreground">Sex not recorded</span>
      )}
    </div>
  )
}

/**
 * How well evidenced the waiting actions are, strongest bucket first.
 *
 * Three counts at table density, so the colour carries the bucket and the
 * label lives in a tooltip: three full badges reading "Document verified" in
 * one cell pushes every other column off the row. The zeros stay in place
 * rather than collapsing, because a column only scans if a bucket is always in
 * the same position, and they are dimmed so the eye lands on what exists.
 */
function EvidenceCell({ row }: { row: ClinicRow }) {
  // Nothing waiting means nothing to evidence. Three zeroes here would be
  // noise on the rows still working through the pipeline.
  if (row.proposedCount === 0) return null

  return (
    <div className="flex items-center gap-1">
      {BUCKET_ORDER.map((bucket) => {
        const count = row.proposedByConfidence[BUCKET_KEY[bucket]]
        return (
          <Tooltip key={bucket}>
            {/* Out of the tab order: the count and its bucket are already in
                the screen reader text below, and three extra stops per row
                turns keyboard travel through the table into a chore. */}
            <TooltipTrigger
              tabIndex={-1}
              className={cn('flex items-center', count === 0 && 'opacity-40')}
            >
              <Badge variant={BUCKET_VARIANT[bucket]} className="tabular-nums">
                {count}
              </Badge>
              <span className="sr-only">
                {BUCKET_LABEL[bucket]}: {count}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {BUCKET_LABEL[bucket]}: {count}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: ({ column }) => (
      <SortableHeader
        label="Name"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    cell: ({ row, getValue }) => (
      <Link
        to="/patient/$id"
        params={{ id: row.original._id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {getValue()}
      </Link>
    ),
  }),
  // Sorts on the birth date the age is computed from, which is the same
  // ordering reversed, so the column needs no second field to sort by.
  columnHelper.accessor('birthDate', {
    header: ({ column }) => (
      <SortableHeader
        label="Age and sex"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    cell: ({ row, getValue }) => <AgeAndSexCell birthDate={getValue()} sex={row.original.sex} />,
  }),
  columnHelper.accessor('country', {
    header: 'From',
  }),
  columnHelper.accessor('proposedCount', {
    header: ({ column }) => (
      <SortableHeader
        label="Waiting"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    // A zero says nothing on its own, so the row explains itself with the
    // stage it is still on. That is the one place the pipeline surfaces on
    // this side, and it is an answer to "why is there nothing to sign", not
    // the operator's stage column. See ADR 21.
    cell: ({ row, getValue }) =>
      getValue() === 0 ? (
        <span className="text-xs text-muted-foreground">{formatStage(row.original.stage)}</span>
      ) : (
        <span className="tabular-nums">{getValue()}</span>
      ),
  }),
  columnHelper.display({
    id: 'evidence',
    header: 'Evidence',
    cell: ({ row }) => <EvidenceCell row={row.original} />,
  }),
  // The row's cue that review can start: the call has ended and left a
  // transcript, so the gaps it was placed to answer are answered. See ADR 22.
  columnHelper.accessor('callComplete', {
    header: 'Call',
    cell: ({ getValue }) =>
      getValue() ? (
        <span className="flex items-center gap-1.5 text-sm">
          <CheckIcon className="size-3.5" />
          Transcript ready
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">No call yet</span>
      ),
  }),
  columnHelper.display({
    id: 'open',
    header: '',
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/patient/$id" params={{ id: row.original._id }} />}
        >
          {row.original.proposedCount > 0 ? 'Review actions' : 'Open record'}
        </Button>
      </div>
    ),
  }),
])

/** How many rows are actually waiting on the clinician, as a sentence. */
function waitingSentence(rows: readonly ClinicRow[]): string {
  const waiting = rows.filter((row) => row.proposedCount > 0).length
  if (waiting === 0) return 'No patient has actions waiting on a decision.'
  if (waiting === 1) return '1 patient has actions waiting on a decision.'
  return `${waiting} patients have actions waiting on a decision.`
}

export function ClinicList() {
  const patients = useQuery(api.clinic.list, {})
  const navigate = useNavigate()
  const [pageIndex, setPageIndex] = useState(0)

  const pageCount = Math.max(1, Math.ceil((patients?.length ?? 0) / PAGE_SIZE))
  const page = useMemo(
    () => patients?.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE) ?? [],
    [patients, pageIndex],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium">Patients</h1>
        {patients === undefined ? (
          <Skeleton className="h-4 w-64" />
        ) : (
          <p className="text-sm text-muted-foreground">{waitingSentence(patients)}</p>
        )}
      </div>
      {patients !== undefined && patients.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No patients onboarded yet</EmptyTitle>
            <EmptyDescription>
              Onboard a patient on the <Link to="/ops">operator board</Link>, or seed the demo
              cohort from there.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DataTable
          columns={columns}
          data={page}
          loading={patients === undefined}
          emptyMessage="No patients on this page."
          onRowClick={(row) => navigate({ to: '/patient/$id', params: { id: row._id } })}
          pagination={{ pageIndex, pageCount, onPageChange: setPageIndex }}
        />
      )}
    </div>
  )
}
