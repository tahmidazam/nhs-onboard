import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { formatSimTime } from '@/lib/format'

const REFRESH_MS = 30_000

/** Reads the simulator's clock endpoint and renders simulation time. */
export function SimClock() {
  const readClock = useAction(api.sim.clock)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const clock = await readClock()
        if (!cancelled) setNow(clock.now)
      } catch {
        // Left blank on failure; the previous reading stays on screen.
      }
    }

    refresh()
    const interval = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [readClock])

  if (now === null) return null

  return <span className="text-sm text-muted-foreground tabular-nums">Simulation time {formatSimTime(now)}</span>
}
