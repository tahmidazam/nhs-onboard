import { useCallback, useEffect, useRef, useState } from 'react'
import VapiClass from '@vapi-ai/web'
import type { Turn } from '@/lib/transcript'

/**
 * The package ships CommonJS with no exports map, so the bundler's interop puts
 * the class under `.default`. Reading through it keeps both shapes working.
 */
const Vapi = ((VapiClass as unknown as { default?: typeof VapiClass }).default ??
  VapiClass) as typeof VapiClass

type VapiInstance = InstanceType<typeof VapiClass>

/**
 * Drives one browser call. The assistant lives in the Vapi dashboard, so this
 * passes goals in and never sends prompt text.
 * See .claude/skills/vapi-call/SKILL.md.
 */

export type CallStatus = 'idle' | 'connecting' | 'in-progress' | 'ended' | 'failed'

interface StartOptions {
  goals: string[]
  patientName: string
  patientAge: number
  patientDob: string
}

interface UseVapiCallOptions {
  /**
   * Runs once Vapi returns the call id. Register the call here, or the
   * end-of-call report arrives with no row to write into.
   */
  onStarted?: (vapiCallId: string) => void | Promise<void>
  /**
   * Runs exactly once when the call is over, whether it hung up, errored, or
   * the sheet closed under it. Save the turns here: the end-of-call report is
   * the better transcript but arrives later, and never at all if the assistant
   * has no server URL.
   */
  onEnded?: (vapiCallId: string, turns: Turn[]) => void | Promise<void>
}

export function useVapiCall({ onStarted, onEnded }: UseVapiCallOptions = {}) {
  const vapiRef = useRef<VapiInstance | null>(null)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  /**
   * The SDK's listeners are bound once at mount, so everything they read has to
   * come through a ref. A closure would still hold the first render's empty
   * transcript when the call ends.
   */
  const callIdRef = useRef<string | null>(null)
  const turnsRef = useRef<Turn[]>([])
  const endedRef = useRef(false)
  /** Resolves once the row exists, so a short call cannot end before it does. */
  const registeredRef = useRef<Promise<unknown> | null>(null)
  const onStartedRef = useRef(onStarted)
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onStartedRef.current = onStarted
    onEndedRef.current = onEnded
  })

  useEffect(() => {
    turnsRef.current = transcript
  }, [transcript])

  useEffect(() => {
    const key = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined
    if (!key) {
      setProblem('VITE_VAPI_PUBLIC_KEY is not set.')
      return
    }

    let vapi: VapiInstance
    try {
      vapi = new Vapi(key)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The Vapi SDK failed to start.')
      return
    }
    vapiRef.current = vapi

    /** Every way a call can end funnels through here, and it reports once. */
    const settle = () => {
      const callId = callIdRef.current
      if (!callId || endedRef.current) return
      endedRef.current = true
      const turns = turnsRef.current
      void Promise.resolve(registeredRef.current)
        .catch(() => {})
        .then(() => onEndedRef.current?.(callId, turns))
    }

    vapi.on('call-start', () => setStatus('in-progress'))
    vapi.on('call-end', () => {
      setStatus('ended')
      settle()
    })

    vapi.on('message', (message: any) => {
      if (message?.type === 'transcript' && message.transcriptType === 'final') {
        setTranscript((turns) => [
          ...turns,
          { speaker: message.role === 'assistant' ? 'assistant' : 'patient', text: message.transcript },
        ])
      }
    })

    vapi.on('error', (e: any) => {
      setStatus('failed')
      setProblem(typeof e?.message === 'string' ? e.message : 'The call failed.')
      settle()
    })

    /**
     * StrictMode mounts, unmounts and remounts, so this runs against a call that
     * never started. A throw here would unmount the whole tree.
     * Closing the sheet mid-call lands here too, which is why it settles: the
     * turns spoken so far are worth more than a row stuck at in-progress.
     */
    return () => {
      try {
        vapi.stop()
      } catch {
        /* nothing to stop */
      }
      settle()
      try {
        vapi.removeAllListeners()
      } catch {
        /* nothing bound */
      }
      vapiRef.current = null
    }
  }, [])

  /**
   * Call this from a real click. Autoplay policy fails the call otherwise.
   * customerJoinTimeoutSeconds is assistant-level config, so it belongs in the
   * dashboard. It defaults to 15, which is short for conference wifi.
   */
  const start = useCallback(
    async ({ goals, patientName, patientAge, patientDob }: StartOptions) => {
      const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined
      if (!assistantId) {
        setProblem('VITE_VAPI_ASSISTANT_ID is not set.')
        return
      }
      if (!vapiRef.current) {
        setProblem('The Vapi SDK did not load, so there is nothing to place a call with.')
        return
      }

      setTranscript([])
      turnsRef.current = []
      callIdRef.current = null
      endedRef.current = false
      registeredRef.current = null
      setProblem(null)
      setStatus('connecting')

      try {
        const call = await vapiRef.current.start(assistantId, {
          /**
           * Names here must match the placeholders in the dashboard prompt, and
           * the set must match what convex/call.ts sends, or the phone and the
           * browser paths ask the patient different questions.
           */
          variableValues: {
            patientName,
            patientAge: String(patientAge),
            patientDob,
            goals:
              goals.map((g, i) => `${i + 1}. ${g}`).join('\n') ||
              'Nothing specific is outstanding. Work the call plan.',
          },
        })
        /** No id means nothing can claim the transcript afterwards, so say so now. */
        if (!call?.id) {
          setProblem('Vapi started the call without an id, so its transcript cannot be saved.')
          return
        }
        callIdRef.current = call.id
        registeredRef.current = Promise.resolve(onStartedRef.current?.(call.id))
        await registeredRef.current
      } catch (e) {
        setStatus('failed')
        setProblem(e instanceof Error ? e.message : 'The call could not start.')
      }
    },
    [],
  )

  const stop = useCallback(() => vapiRef.current?.stop(), [])

  return { status, transcript, problem, start, stop }
}
