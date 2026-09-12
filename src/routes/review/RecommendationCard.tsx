import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { mayWriteBack, type WriteBackRefusal } from '@/lib/writeBack'
import type { Confidence, RecommendationKind, SimTarget, SourceRef } from '@/types'
import type { Doc } from '../../../convex/_generated/dataModel'

/** Exhaustive over the union, so a new kind cannot render blank. */
const KIND_COPY: Record<RecommendationKind, string> = {
  prescription: 'Prescription',
  referral: 'Referral',
  screening: 'Screening referral',
  immunisation: 'Immunisation plan',
  test: 'Test request',
  task: 'Task',
}

const TARGET_COPY: Record<SimTarget, string> = {
  pharmacy: 'Pharmacy',
  referrals: 'Referrals',
  diagnostics: 'Diagnostics',
  gp: 'GP',
}

/** Per the badge table in the UI conventions. One colour, one meaning. */
const BUCKET_VARIANT: Record<Confidence, 'default' | 'secondary' | 'outline'> = {
  'document-evidenced': 'default',
  'patient-reported': 'secondary',
  'uncertain-mapping': 'outline',
}

const SOURCE_LABEL: Record<SourceRef['kind'], string> = {
  document: 'Document',
  transcript: 'Call transcript',
  'sim-record': 'Simulator record',
}

/** Names what the clinician has to do about a refusal, per src/lib/writeBack.ts. */
const REFUSAL_COPY: Record<WriteBackRefusal, string> = {
  'synthesised-evidence': 'Rests on a generated document, so it cannot be written to the sim.',
  'unconfirmed-report': 'Asserted by the patient. Confirm with the patient before this can be written.',
  'unresolved-mapping': 'Not resolved to a safe UK equivalent, so it cannot be actioned.',
}

function EvidenceItem({ source }: { source: SourceRef }) {
  return (
    <li className="flex flex-col gap-1 border-l border-border pl-3">
      <span className="text-xs text-muted-foreground">
        {SOURCE_LABEL[source.kind]} &middot; {source.id}
      </span>
      <blockquote className="text-sm">{source.quote}</blockquote>
    </li>
  )
}

function CitationItem({ citation }: { citation: { url: string; quote: string } }) {
  return (
    <li className="flex flex-col gap-1 border-l border-border pl-3">
      <blockquote className="text-sm">{citation.quote}</blockquote>
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground underline underline-offset-4 break-all"
      >
        {citation.url}
      </a>
    </li>
  )
}

interface RecommendationCardProps {
  recommendation: Doc<'recommendations'>
  selected: boolean
  dismissing: boolean
  onToggleSelected: () => void
  onDismiss: () => void
}

/**
 * One recommendation with its full evidence chain. ADR 3 requires the
 * unresolved and unconfirmed rows to stay visible with their reason, so this
 * renders every row the same way and only disables what the row cannot do.
 */
export function RecommendationCard({
  recommendation,
  selected,
  dismissing,
  onToggleSelected,
  onDismiss,
}: RecommendationCardProps) {
  const decision = mayWriteBack(recommendation)
  const isOpen = recommendation.status === 'proposed'

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={BUCKET_VARIANT[recommendation.confidence]}>{recommendation.confidence}</Badge>
          {recommendation.synthesised && <Badge variant="outline">Synthesised evidence</Badge>}
          {!isOpen && (
            <Badge variant={recommendation.status === 'approved' ? 'default' : 'outline'}>
              {recommendation.status === 'approved' ? 'Approved' : 'Dismissed'}
            </Badge>
          )}
        </div>
        <CardTitle>{recommendation.title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {KIND_COPY[recommendation.kind]}, to {TARGET_COPY[recommendation.target]}.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{recommendation.rationale}</p>

        {!decision.writable && (
          <p className="text-sm text-muted-foreground">{REFUSAL_COPY[decision.refusal]}</p>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Evidence</h3>
          <ul className="flex flex-col gap-3">
            {recommendation.evidence.map((source, index) => (
              <EvidenceItem key={`${source.kind}-${source.id}-${index}`} source={source} />
            ))}
          </ul>
        </div>

        {recommendation.citation && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Guidance</h3>
            <ul className="flex flex-col gap-3">
              <CitationItem citation={recommendation.citation} />
            </ul>
          </div>
        )}

        {recommendation.extraCitations && recommendation.extraCitations.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Also relevant</h3>
            <ul className="flex flex-col gap-3">
              {recommendation.extraCitations.map((citation, index) => (
                <CitationItem key={`${citation.url}-${index}`} citation={citation} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      {isOpen && (
        <CardFooter className="gap-2">
          <Button
            variant={selected ? 'default' : 'outline'}
            disabled={!decision.writable}
            onClick={onToggleSelected}
          >
            {selected ? 'Approved' : 'Approve'}
          </Button>
          <Button variant="ghost" disabled={dismissing} onClick={onDismiss}>
            {dismissing && <Spinner />}
            Dismiss
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
