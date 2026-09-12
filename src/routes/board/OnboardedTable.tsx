import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { ExtractionCell } from '@/components/extraction/ExtractionCell'
import type { ExtractionProgress } from '@/components/extraction/types'
import { RecoveryCell } from '@/components/recovery/RecoveryCell'
import { CallCell } from '@/components/call/CallCell'
import { formatDate, formatStage } from '@/lib/format'

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<AppTableFeatures, Doc<'patients'>>()

type RecoveryMetric = { total: number; recovered: number }

/** Reads recovered/total for one patient, one query per page rather than one per row. */
function useRecoveryColumn(recoveryByPatientId: Map<Id<'patients'>, RecoveryMetric>) {
  return useMemo(
    () =>
      columnHelper.display({
        id: 'recovery',
        header: 'Recovery',
        cell: ({ row }) => (
          <RecoveryCell
            patientId={row.original._id}
            patientName={row.original.name}
            metric={recoveryByPatientId.get(row.original._id)}
          />
        ),
      }),
    [recoveryByPatientId],
  )
}

/**
 * Reads the live claim count and any extraction failure for one patient, one
 * query per page rather than one per row. The count comes from the `claims`
 * table, never from a field on `patients`. See ADR 16.
 */
function useClaimsColumn(extractionByPatientId: Map<Id<'patients'>, ExtractionProgress>) {
  return useMemo(
    () =>
      columnHelper.display({
        id: 'claims',
        header: 'Claims',
        cell: ({ row }) => (
          <ExtractionCell
            patientId={row.original._id}
            patientName={row.original.name}
            progress={extractionByPatientId.get(row.original._id)}
          />
        ),
      }),
    [extractionByPatientId],
  )
}

const staticColumns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: ({ column }) => (
      <SortableHeader label="Name" sorted={column.getIsSorted()} onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />
    ),
    cell: ({ row, getValue }) => (
      <Link
        to="/ops/patient/$id"
        params={{ id: row.original._id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor('birthDate', {
    header: 'Birth date',
    cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue())}</span>,
  }),
  columnHelper.accessor('country', {
    header: 'Country',
  }),
  columnHelper.accessor('stage', {
    header: ({ column }) => (
      <SortableHeader label="Stage" sorted={column.getIsSorted()} onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />
    ),
    cell: ({ getValue }) => formatStage(getValue()),
  }),
  columnHelper.display({
    id: 'call',
    header: 'Call',
    cell: ({ row }) => <CallCell patientId={row.original._id} patientName={row.original.name} />,
  }),
  columnHelper.display({
    id: 'open',
    header: '',
    cell: ({ row }) => (
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/ops/patient/$id" params={{ id: row.original._id }} />}
        >
          Documents
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/patient/$id" params={{ id: row.original._id }} />}
        >
          Review
        </Button>
      </div>
    ),
  }),
])

/** Every onboarded patient and their pipeline stage. Reactive: no refresh needed. */
export function OnboardedTable() {
  const patients = useQuery(api.patients.list)
  const [pageIndex, setPageIndex] = useState(0)

  const patientIds = useMemo(() => patients?.map((p) => p._id) ?? [], [patients])
  const recoveryList = useQuery(api.recovery.forPatients, patients ? { patientIds } : 'skip')
  const recoveryByPatientId = useMemo(
    () => new Map(recoveryList?.map((r) => [r.patientId, { total: r.total, recovered: r.recovered }])),
    [recoveryList],
  )
  const recoveryColumn = useRecoveryColumn(recoveryByPatientId)

  const extractionList = useQuery(api.board.extractionForPatients, patients ? { patientIds } : 'skip')
  const extractionByPatientId = useMemo(
    () =>
      new Map(
        extractionList?.map((e) => [e.patientId, { claimCount: e.claimCount, failures: e.failures }]),
      ),
    [extractionList],
  )
  const claimsColumn = useClaimsColumn(extractionByPatientId)

  const columns = useMemo(
    () => [...staticColumns, claimsColumn, recoveryColumn],
    [claimsColumn, recoveryColumn],
  )

  const pageCount = Math.max(1, Math.ceil((patients?.length ?? 0) / PAGE_SIZE))
  const page = patients?.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE) ?? []

  return (
    <DataTable
      columns={columns}
      data={page}
      loading={patients === undefined}
      emptyMessage="No patients have been onboarded yet."
      pagination={{ pageIndex, pageCount, onPageChange: setPageIndex }}
    />
  )
}
