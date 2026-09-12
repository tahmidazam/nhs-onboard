import { useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { formatDate, formatStage } from '@/lib/format'

const columnHelper = createColumnHelper<AppTableFeatures, Doc<'patients'>>()

const columns = columnHelper.columns([
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
])

/** Every onboarded patient and their pipeline stage. Reactive: no refresh needed. */
export function OnboardedTable() {
  const patients = useQuery(api.patients.list)

  return (
    <DataTable
      columns={columns}
      data={patients ?? []}
      loading={patients === undefined}
      emptyMessage="No patients have been onboarded yet."
    />
  )
}
