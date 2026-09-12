import { useCallback, useEffect, useRef, useState } from 'react'
import VapiClass from '@vapi-ai/web'

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

export interface TranscriptLine {
  role: 'assistant' | 'user'
  text: string
}

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
}

export function useVapiCall({ onStarted }: UseVapiCallOptions = {}) {
  const vapiRef = useRef<VapiInstance | null>(null)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [language, setLanguage] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

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

    vapi.on('call-start', () => setStatus('in-progress'))
    vapi.on('call-end', () => setStatus('ended'))

    vapi.on('message', (message: any) => {
      if (message?.type === 'transcript' && message.transcriptType === 'final') {
        setTranscript((lines) => [...lines, { role: message.role, text: message.transcript }])
      }
      /** Absent from the default serverMessages, so it only arrives once enabled. */
      if (message?.type === 'language-change-detected') setLanguage(message.language ?? null)
    })

    vapi.on('error', (e: any) => {
      setStatus('failed')
      setProblem(typeof e?.message === 'string' ? e.message : 'The call failed.')
    })

    /**
     * StrictMode mounts, unmounts and remounts, so this runs against a call that
     * never started. A throw here would unmount the whole tree.
     */
    return () => {
      try {
        vapi.stop()
        vapi.removeAllListeners()
      } catch {
        /* nothing to stop */
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
    setLanguage(null)
    setProblem(null)
    setStatus('connecting')

    try {
      const call = await vapiRef.current.start(assistantId, {
        /** The dashboard prompt reads {{goals}} and {{patientName}}. */
        variableValues: {
          goals: goals.map((g, i) => `${i + 1}. ${g}`).join('\n') || 'No open questions.',
          patientName,
        },
      })
      if (call?.id) await onStarted?.(call.id)
    } catch (e) {
      setStatus('failed')
      setProblem(e instanceof Error ? e.message : 'The call could not start.')
    }
    },
    [onStarted],
  )

  const stop = useCallback(() => vapiRef.current?.stop(), [])

  return { status, transcript, language, problem, start, stop }
}
