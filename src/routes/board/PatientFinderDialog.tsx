import { useEffect, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { api } from '../../../convex/_generated/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { formatDate, formatStage } from '@/lib/format'
import { selectableCountries } from '@/lib/sources'
import { toast } from '@/components/ui/toast'

const PAGE_SIZE = 30
const DEBOUNCE_MS = 300
const COUNTRIES = selectableCountries()

interface CandidateRow {
  id: string
  name: string
  birthDate: string
  conditionCount: number
}

const columnHelper = createColumnHelper<AppTableFeatures, CandidateRow>()

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
  columnHelper.accessor('conditionCount', {
    header: ({ column }) => (
      <SortableHeader label="Conditions" sorted={column.getIsSorted()} onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />
    ),
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
])

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface PatientFinderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Search or roll, read the record size, choose a country, then commit.
 * Re-rolling stays inside this dialog and in view. See ADR 12.
 */
export function PatientFinderDialog({ open, onOpenChange }: PatientFinderDialogProps) {
  const search = useAction(api.sim.search)
  const random = useAction(api.sim.random)
  const previewAction = useAction(api.sim.preview)
  const onboard = useAction(api.patients.onboard)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<CandidateRow[]>([])
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [selected, setSelected] = useState<CandidateRow | null>(null)
  const [preview, setPreview] = useState<{ conditions: string[]; medications: string[]; allergies: string[] } | null>(
    null,
  )
  const [previewLoading, setPreviewLoading] = useState(false)
  const [country, setCountry] = useState<string | null>(COUNTRIES[0]?.code ?? null)
  const [onboarding, setOnboarding] = useState(false)

  const existing = useQuery(api.patients.bySimId, selected ? { simId: selected.id } : 'skip')

  useEffect(() => {
    if (open) return
    setSelected(null)
    setPreview(null)
    setQuery('')
    setListError(null)
  }, [open])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setOffset(0)
  }, [debouncedQuery])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingList(true)
    search({ q: debouncedQuery || undefined, offset })
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setListError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(message(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, debouncedQuery, offset, search])

  useEffect(() => {
    if (!selected) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    previewAction({ patientId: selected.id, name: selected.name, birthDate: selected.birthDate })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, previewAction])

  async function handleRandom() {
    setRolling(true)
    try {
      const result = await random({ q: debouncedQuery || undefined })
      if (!result) return
      setSelected(result.patient)
      setListError(null)
    } catch (err) {
      setListError(message(err))
    } finally {
      setRolling(false)
    }
  }

  async function handleOnboard() {
    if (!selected || !country) return
    setOnboarding(true)
    try {
      await onboard({ patientId: selected.id, name: selected.name, birthDate: selected.birthDate, country })
      toast.add({
        type: 'success',
        title: `${selected.name} onboarded`,
        description: `Country of origin set to ${country}.`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.add({ type: 'error', title: 'Onboarding failed', description: message(err) })
    } finally {
      setOnboarding(false)
    }
  }

  const canGoBack = offset > 0
  const canGoForward = offset + PAGE_SIZE < total

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find a patient</DialogTitle>
          <DialogDescription>Search the simulator or pick at random from all 50,000 patients.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by name, condition or identifier"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleRandom} disabled={rolling}>
              {rolling && <Spinner />}
              Pick random patient
            </Button>
          </div>

          {listError && (
            <Alert variant="destructive">
              <AlertTitle>The simulator did not respond</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          )}

          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <DataTable
              columns={columns}
              data={items}
              loading={loadingList}
              emptyMessage="No simulator patients match that search."
              onRowClick={setSelected}
              isRowSelected={(row) => row.id === selected?.id}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={!canGoBack || loadingList}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!canGoForward || loadingList}
            >
              Next
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {total > 0 ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total.toLocaleString()}` : ''}
            </span>
          </div>

          {selected && (
            <div className="flex flex-col gap-4 rounded-md border border-border p-4">
              <div>
                <p className="font-medium">{selected.name}</p>
                <p className="text-sm text-muted-foreground">
                  {selected.id}, born {formatDate(selected.birthDate)}
                </p>
              </div>

              {existing && (
                <p className="text-sm text-muted-foreground">
                  Already onboarded. Current stage: {formatStage(existing.stage)}.
                </p>
              )}

              {previewLoading || !preview ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">Reading the record from the simulator.</p>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : (
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <RecordCount label="Conditions" values={preview.conditions} />
                  <RecordCount label="Medications" values={preview.medications} />
                  <RecordCount label="Allergies" values={preview.allergies} />
                </dl>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="country">
                  Country of origin
                </label>
                <Select
                  items={COUNTRIES.map((c) => ({ label: c.label, value: c.code }))}
                  value={country}
                  onValueChange={(value) => setCountry(value as string)}
                >
                  <SelectTrigger id="country" className="w-full">
                    <SelectValue placeholder="Select a country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleOnboard} disabled={!selected || !country || onboarding}>
            {onboarding && <Spinner />}
            {existing ? 'Update onboarding' : 'Onboard this patient'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordCount({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="text-muted-foreground">
        {label} ({values.length})
      </dt>
      <dd>{values.length > 0 ? values.join(', ') : 'None recorded'}</dd>
    </div>
  )
}
