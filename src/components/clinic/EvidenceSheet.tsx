import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { BUCKET_LABEL, BUCKET_VARIANT } from '@/lib/buckets'
import { mayWriteBack } from '@/lib/writeBack'
import type { SourceRef } from '@/types'
import { KIND_COPY, REFUSAL_COPY, SOURCE_LABEL, TARGET_COPY } from './copy'
import type { Recommendation } from './summary'

/**
 * One row's whole evidence chain. The Sheet is where ADR 21 puts it: the silo
 * row carries a title and a flag, and everything that makes the row checkable
 * lives here, one click away.
 *
 * Complete on purpose. Every quote the rule rested on, the guidance it cites
 * with its URL, the country guide behind that, the rule id and the sim site the
 * row lands on. Brevity is the row's job, not this panel's.
 */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-muted-foreground uppercase">{label}</h3>
      {children}
    </div>
  )
}

function Quote({ source }: { source: SourceRef }) {
  return (
    <li className="flex flex-col gap-1 border-l border-border pl-3">
      <span className="text-xs text-muted-foreground">
        {SOURCE_LABEL[source.kind]}, {source.id}
        {/* ADR 17: absent means anchoring does not apply, so only a hard false is worth saying. */}
        {source.verified === false && ', quote did not anchor'}
      </span>
      <blockquote className="text-sm">{source.quote}</blockquote>
    </li>
  )
}

function Citation({ citation }: { citation: { url: string; quote: string } }) {
  return (
    <li className="flex flex-col gap-1 border-l border-border pl-3">
      <blockquote className="text-sm">{citation.quote}</blockquote>
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        className="text-xs break-all text-muted-foreground underline underline-offset-4"
      >
        {citation.url}
      </a>
    </li>
  )
}

interface DetailProps {
  recommendation: Recommendation
  dismissing: boolean
  onDismiss: (recommendation: Recommendation) => void
}

/**
 * Split out so the refusal decision and the flags are computed once, above the
 * markup, rather than inline in a panel that renders only when a row is open.
 */
function Detail({ recommendation, dismissing, onDismiss }: DetailProps) {
  const decision = mayWriteBack(recommendation)

  return (
    <>
      <SheetHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={BUCKET_VARIANT[recommendation.confidence]}>
            {BUCKET_LABEL[recommendation.confidence]}
          </Badge>
          {recommendation.synthesised && (
            /* Not a Badge: the three variants mean a confidence bucket and nothing else. */
            <span className="text-xs text-muted-foreground">Synthesised evidence</span>
          )}
          {recommendation.status !== 'proposed' && (
            <span className="text-xs text-muted-foreground">
              {recommendation.status === 'approved' ? 'Approved' : 'Dismissed'}
            </span>
          )}
        </div>
        <SheetTitle>{recommendation.title}</SheetTitle>
        <SheetDescription>
          {KIND_COPY[recommendation.kind]}, to {TARGET_COPY[recommendation.target]}.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 px-6 pb-6">
        <p className="text-sm">{recommendation.rationale}</p>

        {!decision.writable && (
          <p className="text-sm text-muted-foreground">{REFUSAL_COPY[decision.refusal]}</p>
        )}

        {recommendation.clinicianNote && (
          <Section label="Clinician note">
            <p className="text-sm">{recommendation.clinicianNote}</p>
          </Section>
        )}

        {recommendation.evidence.length > 0 && (
          <Section label="Evidence">
            <ul className="flex flex-col gap-3">
              {recommendation.evidence.map((source, index) => (
                <Quote key={`${source.kind}-${source.id}-${index}`} source={source} />
              ))}
            </ul>
          </Section>
        )}

        {recommendation.citation && (
          <Section label="Guidance">
            <ul className="flex flex-col gap-3">
              <Citation citation={recommendation.citation} />
            </ul>
          </Section>
        )}

        {recommendation.extraCitations && recommendation.extraCitations.length > 0 && (
          /* ADR 15: the matched country guide travels behind the primary, never displacing it. */
          <Section label="Country guide">
            <ul className="flex flex-col gap-3">
              {recommendation.extraCitations.map((citation, index) => (
                <Citation key={`${citation.url}-${index}`} citation={citation} />
              ))}
            </ul>
          </Section>
        )}

        <Separator />

        <Section label="Provenance">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 text-sm">
            {/* ADR 13: the pack is typed modules, so a rule id is a file a reader can open. */}
            <dt className="text-muted-foreground">Rule</dt>
            <dd>{recommendation.ruleId ?? 'Not recorded'}</dd>
            <dt className="text-muted-foreground">Writes to</dt>
            <dd>{TARGET_COPY[recommendation.target]}</dd>
            {recommendation.simResourceId && (
              <>
                <dt className="text-muted-foreground">Sim resource</dt>
                <dd className="break-all">{recommendation.simResourceId}</dd>
              </>
            )}
          </dl>
        </Section>

        {recommendation.status === 'proposed' && (
          <div className="flex">
            <Button
              variant="outline"
              disabled={dismissing}
              onClick={() => onDismiss(recommendation)}
            >
              {dismissing && <Spinner />}
              Dismiss this action
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

interface EvidenceSheetProps {
  /** Null closes the Sheet. Resolved from the live query, so a saved note or a dismiss lands here. */
  recommendation: Recommendation | null
  onOpenChange: (open: boolean) => void
  dismissing: boolean
  onDismiss: (recommendation: Recommendation) => void
}

export function EvidenceSheet({
  recommendation,
  onOpenChange,
  dismissing,
  onDismiss,
}: EvidenceSheetProps) {
  return (
    <Sheet open={recommendation !== null} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto">
        {recommendation && (
          <Detail
            recommendation={recommendation}
            dismissing={dismissing}
            onDismiss={onDismiss}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
