import { useQuery } from 'convex/react'
import { ChevronRightIcon } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAgent, formatDocumentKind } from '@/lib/format'

/**
 * The recorded model calls behind one patient's claims, per ADR 19.
 *
 * Everything shown here is what was sent and what came back, never a summary of
 * it: the question this answers is what the model literally said, and a tidied
 * version of that answers nothing. The document is rendered with `data-typeset`
 * so a Bengali prescription list keeps its own face rather than falling back to
 * whatever the system offers.
 */

interface AgentRunListProps {
  patientId: Id<'patients'>
}

/** Names the document a call was reading, for the row it sits in. */
function documentLabel(kind: string | undefined): string {
  if (!kind) return 'a document that has since been deleted'
  return formatDocumentKind(kind).toLowerCase()
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

interface BlockProps {
  title: string
  /** BCP-47, set on the document block only. */
  language?: string
  children: string
}

function Block({ title, language, children }: BlockProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <pre
        data-typeset
        lang={language}
        className="max-h-64 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs"
      >
        {children}
      </pre>
    </div>
  )
}

export function AgentRunList({ patientId }: AgentRunListProps) {
  const runs = useQuery(api.extractDb.runsForPatient, { patientId })

  if (runs === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No model calls recorded</EmptyTitle>
          <EmptyDescription>
            Extraction was skipped because claims were already stored, or it last ran before calls
            were recorded. Read the documents again to record them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {runs.length === 1 ? 'The model call' : `The ${runs.length} model calls`}
      </h3>
      <ul className="flex flex-col">
        {runs.map((run) => (
          <li key={run._id} className="border-b border-border last:border-b-0">
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 py-2 text-left text-sm">
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
                <span className="font-medium">{formatAgent(run.agent)} agent</span>
                <span className="text-muted-foreground">on the {documentLabel(run.documentKind)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {run.error ? 'Failed' : `${run.items ?? 0} facts`}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-3 pb-3 pl-6">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd>{run.model}</dd>
                  <dt className="text-muted-foreground">Attempts</dt>
                  <dd className="tabular-nums">{run.attempts}</dd>
                  <dt className="text-muted-foreground">Time</dt>
                  <dd className="tabular-nums">{formatSeconds(run.durationMs)}</dd>
                  {run.inputTokens !== undefined && (
                    <>
                      <dt className="text-muted-foreground">Tokens in</dt>
                      <dd className="tabular-nums">{run.inputTokens}</dd>
                    </>
                  )}
                  {run.outputTokens !== undefined && (
                    <>
                      <dt className="text-muted-foreground">Tokens out</dt>
                      <dd className="tabular-nums">{run.outputTokens}</dd>
                    </>
                  )}
                  {run.responseId && (
                    <>
                      <dt className="text-muted-foreground">Response</dt>
                      <dd className="break-all">{run.responseId}</dd>
                    </>
                  )}
                </dl>
                <Block title="Instructions sent">{run.instructions}</Block>
                <Block title="Document sent" language={run.documentLanguage}>
                  {run.input}
                </Block>
                {run.output && <Block title="What came back">{run.output}</Block>}
                {run.error && (
                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-medium">Why it failed</h4>
                    <p className="text-sm text-muted-foreground">{run.error}</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        One row per call, written as the call returned. The response id is the same one the run
        carries in the OpenAI dashboard.
      </p>
    </div>
  )
}
