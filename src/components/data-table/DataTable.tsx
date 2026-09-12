import { useState } from 'react'
import { useTable, type ColumnDef, type RowData, type SortingState } from '@tanstack/react-table'
import { ArrowUpDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { type AppTableFeatures, tableFeatureSet } from './features'

/**
 * A page the caller already fetched, plus enough to render the shadcn
 * `Pagination` control and ask for another one. The simulator and the
 * onboarded-patients query both page server-side, so this is always manual:
 * TanStack Table never slices `data` itself.
 */
export interface DataTablePagination {
  pageIndex: number
  pageCount: number
  onPageChange: (pageIndex: number) => void
}

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<AppTableFeatures, TData, any>[]
  data: TData[]
  /** Shown in place of rows while the source query or action is still resolving. */
  loading?: boolean
  emptyMessage: string
  onRowClick?: (row: TData) => void
  isRowSelected?: (row: TData) => boolean
  pagination?: DataTablePagination
}

/**
 * A sortable table over a page of rows. The sort itself runs inside TanStack
 * Table, never by hand. Paging happens server-side; this only renders the
 * page it is given and reports page changes upward.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  loading,
  emptyMessage,
  onRowClick,
  isRowSelected,
  pagination,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useTable({
    features: tableFeatureSet,
    data,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
    // A page never holds more rows than fit on one sim or Convex page, so a
    // pageSize this large means the pagination feature never re-slices rows
    // that are already exactly one page.
    initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
    manualPagination: true,
    pageCount: pagination?.pageCount ?? 1,
  })

  return (
    <div className="flex flex-col gap-3">
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
      {pagination && pagination.pageCount > 1 && <TablePagination {...pagination} />}
    </div>
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

/**
 * Builds the page indexes to render around the current page: the first page,
 * the last page, one on either side of the current page, and an ellipsis
 * marker for any gap between them.
 */
function pageWindow(current: number, count: number): Array<number | 'ellipsis'> {
  const kept = new Set<number>([0, count - 1, current - 1, current, current + 1])
  const sorted = [...kept].filter((p) => p >= 0 && p < count).sort((a, b) => a - b)

  const result: Array<number | 'ellipsis'> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis')
    result.push(sorted[i])
  }
  return result
}

/**
 * Pages in place rather than navigating: every control renders as a button,
 * not an anchor, so there is no `href` for the dialog to follow.
 */
function TablePagination({ pageIndex, pageCount, onPageChange }: DataTablePagination) {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            render={<button type="button" />}
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          />
        </PaginationItem>
        {pageWindow(pageIndex, pageCount).map((page, i) =>
          page === 'ellipsis' ? (
            <PaginationItem key={`ellipsis-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={page}>
              <PaginationLink
                render={<button type="button" aria-current={page === pageIndex ? 'page' : undefined} />}
                isActive={page === pageIndex}
                onClick={() => onPageChange(page)}
              >
                {page + 1}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            render={<button type="button" />}
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
