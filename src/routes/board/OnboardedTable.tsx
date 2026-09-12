import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
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
          <RecoveryCell patientName={row.original.name} metric={recoveryByPatientId.get(row.original._id)} />
        ),
      }),
    [recoveryByPatientId],
  )
}

const staticColumns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: ({ column }) => (
      <SortableHeader label="Name" sorted={column.getIsSorted()} onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />
    ),
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
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
  const columns = useMemo(() => [...staticColumns, recoveryColumn], [recoveryColumn])

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
