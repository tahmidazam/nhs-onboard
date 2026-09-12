import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

/**
 * The single feature set every table in this app registers: sorting plus
 * pagination bookkeeping. Both tables page their data server-side, so
 * `manualPagination` is always set where pagination is used and this feature
 * never slices rows itself; it only supplies `getPageCount()` and friends for
 * the shadcn `Pagination` control.
 */
export const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

export type AppTableFeatures = typeof tableFeatureSet
