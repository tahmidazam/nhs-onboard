import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface TypesetProps {
  title: string
  action?: ReactNode
  children: string
}

/** Renders one PresentedDocument so it reads as a document rather than a stack of divs. */
export function Typeset({ title, action, children }: TypesetProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap">{children}</pre>
      </CardContent>
    </Card>
  )
}
