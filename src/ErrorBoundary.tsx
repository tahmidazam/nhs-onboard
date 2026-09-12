import { Component, type ReactNode } from 'react'

/**
 * Renders the error instead of unmounting to a blank page.
 * A thrown render or effect otherwise leaves nothing on screen to read.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[nhs-onboard]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col gap-3 p-8 max-w-2xl">
        <h1 className="text-lg">NHS Onboard stopped.</h1>
        <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto">
          {this.state.error.stack}
        </pre>
      </div>
    )
  }
}
