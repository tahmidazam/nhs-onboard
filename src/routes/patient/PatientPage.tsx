import { useEffect, useRef, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { useParams } from '@tanstack/react-router'
import { RotateCcwIcon } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { toast } from '@/components/ui/toast'
import { formatDate, formatDocumentKind, formatStage } from '@/lib/format'
import { Typeset } from './Typeset'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Splits source documents against the extracted record. Documents-only for now; ADR 10. */
export function PatientPage() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const patientId = id as Id<'patients'> | undefined

  const patient = useQuery(api.patients.get, patientId ? { patientId } : 'skip')
  const documents = useQuery(api.degrade.list, patientId ? { patientId } : 'skip')
  const degrade = useAction(api.degrade.degrade)

  const [pending, setPending] = useState(false)
  const triggered = useRef(false)

  useEffect(() => {
    if (!patientId || !patient || documents === undefined) return
    if (documents.length > 0 || triggered.current) return
    triggered.current = true
    setPending(true)
    degrade({ patientId })
      .catch((err: unknown) => toast.add({ type: 'error', title: 'Degradation failed', description: message(err) }))
      .finally(() => setPending(false))
  }, [patientId, patient, documents, degrade])

  async function handleRedegrade() {
    if (!patientId) return
    setPending(true)
    try {
      await degrade({ patientId, force: true })
      toast.add({ type: 'success', title: 'Documents regenerated' })
    } catch (err) {
      toast.add({ type: 'error', title: 'Degradation failed', description: message(err) })
    } finally {
      setPending(false)
    }
  }

  if (!patientId) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No patient specified</EmptyTitle>
          <EmptyDescription>Navigate here from the board with a patient selected.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (patient === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (patient === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Patient not found</EmptyTitle>
          <EmptyDescription>This patient has not been onboarded.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium">{patient.name}</h1>
          <p className="text-sm text-muted-foreground">
            Born {formatDate(patient.birthDate)}, country of origin {patient.country}. {formatStage(patient.stage)}.
          </p>
        </div>
        <Button variant="outline" onClick={handleRedegrade} disabled={pending}>
          {pending ? <Spinner /> : <RotateCcwIcon />}
          Regenerate documents
        </Button>
      </div>

      {documents === undefined || (pending && documents.length === 0) ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Generating documents from the record.</p>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : documents.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No documents to show</EmptyTitle>
            <EmptyDescription>This patient's simulator record carries no conditions, medications or allergies.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {documents.map((doc) => (
            <Typeset
              key={doc._id}
              title={formatDocumentKind(doc.kind)}
              language={doc.language}
              action={doc.synthesised ? <Badge variant="outline">Synthesised</Badge> : undefined}
            >
              {doc.text}
            </Typeset>
          ))}
        </div>
      )}
    </div>
  )
}
