import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  BUCKET_KEY,
  BUCKET_LABEL,
  BUCKET_ORDER,
  BUCKET_VARIANT,
  SILOS,
  SILO_TEXT,
} from '@/lib/buckets'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ageInYears, countryName, plural } from './copy'
import type { BackgroundItem, ClinicSummary } from './summary'

/**
 * The SBAR handover at the top of the clinician screen.
 *
 * Four bands, each read as something a clinician would say aloud: age and sex,
 * then history, then how much of that history we actually recovered, then the
 * work waiting. A description list rather than four cards, per the UI
 * conventions on density.
 *
 * Every band is one or two lines. The evidence under any of it is one click
 * away in the row Sheet, which is ADR 21's trade: brevity on the face of the
 * screen, nothing hidden.
 */

function Band({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="text-xs text-muted-foreground uppercase">{label}</dt>
      <dd className="flex flex-col gap-1 text-sm">{children}</dd>
    </div>
  )
}

/**
 * A recovered fact, named by its resolved UK term. The foreign original sits in
 * a tooltip rather than inline: `verbatim` is what the source document wrote
 * and a handover line reading "Napa (Paracetamol)" twelve times is the text
 * dump this screen replaces.
 */
function Fact({ item }: { item: BackgroundItem }) {
  if (item.verbatim === item.label) return <span>{item.label}</span>
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="underline decoration-dotted underline-offset-4" />}
      >
        {item.label}
      </TooltipTrigger>
      <TooltipContent>As the record wrote it: {item.verbatim}</TooltipContent>
    </Tooltip>
  )
}

function FactList({ items, none }: { items: BackgroundItem[]; none: string }) {
  if (items.length === 0) return <span className="text-muted-foreground">{none}</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      {items.map((item, index) => (
        <span key={item._id}>
          <Fact item={item} />
          {index < items.length - 1 && ','}
        </span>
      ))}
    </span>
  )
}

interface SbarHeaderProps {
  summary: ClinicSummary
  /** True while `nhs-establish-sex` is still queued for the call. */
  sexGapOpen: boolean
  /** The write-back button, so it lands level with the patient's name. */
  action?: React.ReactNode
}

export function SbarHeader({ summary, sexGapOpen, action }: SbarHeaderProps) {
  const { situation, background, assessment, recommendation } = summary
  const age = ageInYears(situation.birthDate)
  const from = countryName(situation.country)
  const waiting = `${situation.proposedCount} ${plural(situation.proposedCount, 'action')} waiting.`

  /**
   * An empty allergy list is not a clinical fact on its own, which is the whole
   * reason `allergiesAsked` exists. "None recorded" means the documents were
   * silent. "None, and the patient was asked" means somebody checked.
   */
  const noAllergies = background.allergiesAsked
    ? 'None, and the patient was asked on the call.'
    : 'None recorded, and the patient has not been asked.'

  /**
   * `BUCKET_KEY` is what turns a `Confidence` into the camel-case key the
   * payload carries, so the band reads the counts through the same map
   * `convex/clinic.ts` wrote them with rather than a fourth spelling of them.
   */
  const buckets = BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: assessment.proposedByConfidence[BUCKET_KEY[bucket]],
  }))

  const siloLinks = SILOS.filter((silo) => recommendation[silo.id] > 0)

  return (
    <TooltipProvider>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-medium">{situation.name}</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              Born {formatDate(situation.birthDate)}
            </p>
          </div>
          {action}
        </div>

        <dl className="flex flex-col">
          <Band label="Situation">
            {/*
              The sex flag closes its own clause rather than sitting mid-sentence.
              A badge between "female" and "registered from India" breaks the line
              as something a clinician would say aloud, which is the band's job.
            */}
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {situation.sex ? (
                <>
                  <span className="tabular-nums">
                    {age === null ? 'Age unknown,' : `${age}-year-old`}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="underline decoration-dotted underline-offset-4" />}
                    >
                      {situation.sex.value}
                    </TooltipTrigger>
                    {/* ADR 20: sex is read off the sim's own narrative, so the sentence it came from is the evidence. */}
                    <TooltipContent>{situation.sex.source.quote}</TooltipContent>
                  </Tooltip>
                  <Badge variant={BUCKET_VARIANT[situation.sex.confidence]}>
                    {BUCKET_LABEL[situation.sex.confidence]}
                  </Badge>
                </>
              ) : (
                <span className="tabular-nums">
                  {age === null ? 'Age unknown' : `${age} years old`}, sex not in the record.
                  {sexGapOpen && ' The call will settle it.'}
                </span>
              )}
            </span>
            <span className="tabular-nums">
              Registered from {from}. {waiting}
            </span>
          </Band>

          <Band label="Background">
            <span className="flex flex-wrap gap-x-1">
              <span className="text-muted-foreground">Problems</span>
              <FactList items={background.problems} none="None recorded." />
            </span>
            <span className="flex flex-wrap gap-x-1">
              <span className="text-muted-foreground">Medication</span>
              <FactList items={background.medications} none="None recorded." />
            </span>
            <span className="flex flex-wrap gap-x-1">
              <span className="text-muted-foreground">Allergies</span>
              <FactList items={background.allergies} none={noAllergies} />
            </span>
          </Band>

          <Band label="Assessment">
            {/* ADR 11 makes this the number that goes in front of judges, so it leads the band. */}
            <span className="tabular-nums">
              {assessment.recovery.recovered} of {assessment.recovery.total}{' '}
              {plural(assessment.recovery.total, 'fact')} recovered from the documents.
            </span>
            {situation.proposedCount > 0 && (
              <span className="flex flex-wrap items-center gap-1.5">
                {buckets
                  .filter((entry) => entry.count > 0)
                  .map((entry) => (
                    <Badge key={entry.bucket} variant={BUCKET_VARIANT[entry.bucket]}>
                      <span className="tabular-nums">{entry.count}</span>{' '}
                      {BUCKET_LABEL[entry.bucket].toLowerCase()}
                    </Badge>
                  ))}
              </span>
            )}
            {assessment.unverifiedClaims > 0 && (
              /* ADR 17: counted with === false, so this is a failed anchor and never a missing one. */
              <span className="text-muted-foreground tabular-nums">
                {assessment.unverifiedClaims} {plural(assessment.unverifiedClaims, 'quote')} did not
                anchor in the {assessment.unverifiedClaims === 1 ? 'document it names' : 'documents they name'}.
              </span>
            )}
          </Band>

          <Band label="Recommendation">
            {siloLinks.length === 0 ? (
              <span className="text-muted-foreground">Nothing proposed.</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {siloLinks.map((silo) => (
                  <a
                    key={silo.id}
                    href={`#silo-${silo.id}`}
                    className={cn(
                      'flex items-baseline gap-1 underline-offset-4 hover:underline',
                      SILO_TEXT[silo.id],
                    )}
                  >
                    <span className="tabular-nums">{recommendation[silo.id]}</span>
                    {recommendation[silo.id] === 1 ? silo.one : silo.many}
                  </a>
                ))}
              </span>
            )}
          </Band>
        </dl>
      </section>
    </TooltipProvider>
  )
}
