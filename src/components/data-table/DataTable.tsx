import { useState } from 'react'
import { useTable, type ColumnDef, type RowData, type SortingState } from '@tanstack/react-table'
import { ArrowUpDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type AppTableFeatures, tableFeatureSet } from './features'

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<AppTableFeatures, TData, any>[]
  data: TData[]
  /** Shown in place of rows while the source query or action is still resolving. */
  loading?: boolean
  emptyMessage: string
  onRowClick?: (row: TData) => void
  isRowSelected?: (row: TData) => boolean
}

/** A sortable table over a fixed row array. The sort itself runs inside TanStack Table, never by hand. */
export function DataTable<TData extends RowData>({
  columns,
  data,
  loading,
  emptyMessage,
  onRowClick,
  isRowSelected,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useTable({
    features: tableFeatureSet,
    data,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
  })

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {columns.map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              data-state={isRowSelected?.(row.original) ? 'selected' : undefined}
              className={cn(onRowClick && 'cursor-pointer')}
            >
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}

/** A column header that toggles ascending/descending sort on click. */
export function SortableHeader({ label, sorted, onToggle }: { label: string; sorted: false | 'asc' | 'desc'; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} className="-ml-3">
      {label}
      <ArrowUpDownIcon data-icon="inline-end" className={sorted ? 'opacity-100' : 'opacity-40'} />
    </Button>
  )
}
