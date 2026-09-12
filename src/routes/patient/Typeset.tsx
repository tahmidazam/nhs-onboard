import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface TypesetProps {
  title: string
  /** BCP-47. Picks up a Bengali or Devanagari face where Inter carries none. */
  language?: string
  action?: ReactNode
  children: string
}

/** Renders one PresentedDocument so it reads as a document rather than a stack of divs. */
export function Typeset({ title, language, action, children }: TypesetProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        <pre data-typeset lang={language} className="whitespace-pre-wrap">
          {children}
        </pre>
      </CardContent>
    </Card>
  )
}
