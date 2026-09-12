import { useState } from 'react'
import { useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { formatDate, formatStage } from '@/lib/format'

const PAGE_SIZE = 20

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
  const [pageIndex, setPageIndex] = useState(0)

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
