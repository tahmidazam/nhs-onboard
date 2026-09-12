import { useEffect, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { createColumnHelper } from '@tanstack/react-table'
import { ShuffleIcon } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, SortableHeader } from '@/components/data-table/DataTable'
import type { AppTableFeatures } from '@/components/data-table/features'
import { formatDate, formatStage } from '@/lib/format'
import { selectableCountries } from '@/lib/sources'
import { toast } from '@/components/ui/toast'

const PAGE_SIZE = 30
const DEBOUNCE_MS = 300
const COUNTRIES = selectableCountries()

/** Matches DEFAULT_SEVERITY in convex/lib/degradeConstants.ts, on the slider's 0 to 100 scale. */
const DEFAULT_SEVERITY_PERCENT = 50

/**
 * Names each stretch of the dial, so the number means something before the
 * documents exist. Ordered by ascending ceiling; the first match wins.
 */
const SEVERITY_BANDS: Array<{ upTo: number; label: string; blurb: string }> = [
  { upTo: 0, label: 'Pristine', blurb: 'Nothing is dropped. Every fact reaches the documents intact.' },
  { upTo: 25, label: 'Light', blurb: 'Most facts survive. Doses and reactions go first.' },
  { upTo: 55, label: 'Typical', blurb: 'What a real transferred record tends to look like.' },
  { upTo: 80, label: 'Heavy', blurb: 'Around half the record is gone, and coded diagnoses are rare.' },
  { upTo: 100, label: 'Severe', blurb: 'Most of the record is lost. The call has to do the work.' },
]

function band(percent: number) {
  return SEVERITY_BANDS.find((candidate) => percent <= candidate.upTo) ?? SEVERITY_BANDS[SEVERITY_BANDS.length - 1]
}

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
    header: 'Born',
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
 * Search or roll on the left, set up the onboarding on the right.
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
  const [severity, setSeverity] = useState(DEFAULT_SEVERITY_PERCENT)
  const [translate, setTranslate] = useState(true)
  const [onboarding, setOnboarding] = useState(false)

  const existing = useQuery(api.patients.bySimId, selected ? { simId: selected.id } : 'skip')

  useEffect(() => {
    if (open) return
    setSelected(null)
    setPreview(null)
    setQuery('')
    setListError(null)
    setSeverity(DEFAULT_SEVERITY_PERCENT)
    setTranslate(true)
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
      await onboard({
        patientId: selected.id,
        name: selected.name,
        birthDate: selected.birthDate,
        country,
        degradation: { severity: severity / 100, translate },
      })
      toast.add({
        type: 'success',
        title: `${selected.name} onboarded`,
        description: `${country}, ${band(severity).label.toLowerCase()} degradation${translate ? '' : ', untranslated'}.`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.add({ type: 'error', title: 'Onboarding failed', description: message(err) })
    } finally {
      setOnboarding(false)
    }
  }

  const countryName = COUNTRIES.find((c) => c.code === country)?.label ?? 'the country of origin'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Find a patient</DialogTitle>
          <DialogDescription>
            Search the simulator or pick at random from all 50,000 patients, then choose how badly their records
            arrive.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1.5fr_1fr]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search by name, condition or identifier"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleRandom} disabled={rolling}>
                {rolling ? <Spinner /> : <ShuffleIcon />}
                Random
              </Button>
            </div>

            {listError && (
              <Alert variant="destructive">
                <AlertTitle>The simulator did not respond</AlertTitle>
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              <DataTable
                columns={columns}
                data={items}
                loading={loadingList}
                emptyMessage="No simulator patients match that search."
                onRowClick={setSelected}
                isRowSelected={(row) => row.id === selected?.id}
                pagination={{
                  pageIndex: offset / PAGE_SIZE,
                  pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
                  onPageChange: (pageIndex) => setOffset(pageIndex * PAGE_SIZE),
                }}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-md border border-border">
            {!selected ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle>No patient chosen</EmptyTitle>
                  <EmptyDescription>
                    Pick a row, or roll at random. Their record and the degradation settings appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-5 p-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{selected.name}</p>
                    {existing ? <Badge variant="secondary">{formatStage(existing.stage)}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selected.id}, born {formatDate(selected.birthDate)}
                  </p>
                </div>

                {previewLoading || !preview ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : (
                  <dl className="flex flex-col gap-3 text-sm">
                    <RecordCount label="Conditions" values={preview.conditions} />
                    <RecordCount label="Medications" values={preview.medications} />
                    <RecordCount label="Allergies" values={preview.allergies} />
                  </dl>
                )}

                <Separator />

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

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-sm font-medium" htmlFor="severity">
                      How much is lost
                    </label>
                    <span className="text-sm tabular-nums text-muted-foreground">{band(severity).label}</span>
                  </div>
                  <Slider
                    id="severity"
                    min={0}
                    max={100}
                    step={5}
                    value={severity}
                    onValueChange={(value) => setSeverity(Array.isArray(value) ? value[0] : value)}
                  />
                  <p className="text-sm text-muted-foreground">{band(severity).blurb}</p>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium" htmlFor="translate">
                      Translate the documents
                    </label>
                    <p className="text-sm text-muted-foreground">
                      {translate
                        ? `Written in the language of ${countryName}, as they would arrive.`
                        : 'Kept in English. Faster, and the brand names still come out foreign.'}
                    </p>
                  </div>
                  <Switch id="translate" checked={translate} onCheckedChange={setTranslate} />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
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
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">
        {label} ({values.length})
      </dt>
      <dd>{values.length > 0 ? values.join(', ') : 'None recorded'}</dd>
    </div>
  )
}
