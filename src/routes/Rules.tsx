import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { pack } from '../../rules/index'
import type { Rule } from '../../rules/types'
import type { Confidence, RecommendationKind, SimTarget } from '../types'

/**
 * The pack, rendered from its own metadata.
 *
 * ADR 13 dropped YAML on the promise that legibility would come from a
 * generated view rather than the storage format, so this page is the thing that
 * makes ADR 5's claim checkable: a judge follows a URL and finds the quote on
 * the page. It maps over `pack`, so a seventh rule appears here with no edit.
 *
 * Read-only by construction. Nothing here calls a mutation.
 */

/** Exhaustive over the union, so a rule with a new kind cannot render blank. */
const KIND_COPY: Record<RecommendationKind, string> = {
  prescription: 'A prescription',
  referral: 'A referral',
  screening: 'A screening referral',
  immunisation: 'An immunisation plan',
  test: 'A test request',
  task: 'A task',
}

const TARGET_COPY: Record<SimTarget, string> = {
  gp: 'the GP site',
  referrals: 'the referrals site',
  diagnostics: 'the diagnostics site',
  pharmacy: 'the pharmacy',
}

/** Per the badge table in the UI conventions. One colour, one meaning. */
const BUCKET_VARIANT: Record<Confidence, 'default' | 'secondary' | 'outline'> = {
  'document-evidenced': 'default',
  'patient-reported': 'secondary',
  'uncertain-mapping': 'outline',
}

function Metadata({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function RuleEntry({ rule }: { rule: Rule }) {
  return (
    <li className="flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-mono text-sm">{rule.id}</h2>
        <p className="text-sm">{rule.reads}</p>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <Metadata label="Output">
          {KIND_COPY[rule.kind]}, to {TARGET_COPY[rule.target]}.
        </Metadata>

        <Metadata label="Confidence">
          {rule.confidenceFloor ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={BUCKET_VARIANT[rule.confidenceFloor]}>{rule.confidenceFloor}</Badge>
              <span className="text-muted-foreground">
                Fixed here, because the rule consumes no claim to inherit from.
              </span>
            </span>
          ) : (
            'Inherited from the weakest evidence the rule reads.'
          )}
        </Metadata>

        <Metadata label="Countries">
          {rule.countries === 'all' ? (
            'Every country.'
          ) : (
            <>
              <span className="tabular-nums">{rule.countries.length}</span> countries, from the
              UKHSA country guides.
            </>
          )}
        </Metadata>

        {/* Gap-only metadata, so the row is absent on a rule that asks nothing
            rather than showing a number nothing reads. See #32. */}
        {rule.priority === undefined ? null : (
          <Metadata label="Priority">
            <span className="tabular-nums">{rule.priority}</span>
          </Metadata>
        )}
      </dl>

      <ul className="flex flex-col gap-4">
        {rule.citations.map((citation) => (
          <li
            key={`${citation.url} ${citation.quote}`}
            className="flex flex-col gap-2 border-l border-border pl-4"
          >
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
        ))}
      </ul>
    </li>
  )
}

export function Rules() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-4">
        <h1 className="text-lg">The rule pack</h1>
        <p className="text-sm text-muted-foreground">
          Every recommendation and every question this system produces comes from one of these{' '}
          <span className="tabular-nums">{pack.length}</span> rules. Each one carries the guidance
          line it rests on, quoted from the source and linked, so the guidance can be checked
          rather than trusted. Priority orders what a call asks first, and 1 is highest, so
          only a rule that asks the patient something carries one.
        </p>
        <Alert>
          <AlertTitle>These rules are a start on NHS screening, not the whole of it.</AlertTitle>
          <AlertDescription>
            Cervical, breast and abdominal aortic aneurysm screening are gated on sex, which the
            simulator does not hold, so they ask the patient instead of recommending anything.
            Newborn blood spot, newborn hearing and the newborn physical examination fire only on
            infants, and the examination has no catch-up route at all. The rest of the routine
            immunisation schedule beyond measles dose validity is not encoded.
          </AlertDescription>
        </Alert>
      </header>

      <ol className="flex flex-col gap-6">
        {pack.map((rule) => (
          <RuleEntry key={rule.id} rule={rule} />
        ))}
      </ol>
    </div>
  )
}
