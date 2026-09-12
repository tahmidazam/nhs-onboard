import { useCallback, useEffect, useRef, useState } from 'react'
import Vapi from '@vapi-ai/web'

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
}

export function useVapiCall() {
  const vapiRef = useRef<Vapi | null>(null)
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

    const vapi = new Vapi(key)
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

    return () => {
      vapi.stop()
      vapi.removeAllListeners()
      vapiRef.current = null
    }
  }, [])

  /**
   * Call this from a real click. Autoplay policy fails the call otherwise.
   * customerJoinTimeoutSeconds is assistant-level config, so it belongs in the
   * dashboard. It defaults to 15, which is short for conference wifi.
   */
  const start = useCallback(async ({ goals, patientName }: StartOptions) => {
    const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined
    if (!vapiRef.current || !assistantId) {
      setProblem('VITE_VAPI_ASSISTANT_ID is not set.')
      return
    }

    setTranscript([])
    setLanguage(null)
    setProblem(null)
    setStatus('connecting')

    try {
      await vapiRef.current.start(assistantId, {
        /** The dashboard prompt reads {{goals}} and {{patientName}}. */
        variableValues: {
          goals: goals.map((g, i) => `${i + 1}. ${g}`).join('\n') || 'No open questions.',
          patientName,
        },
      })
    } catch (e) {
      setStatus('failed')
      setProblem(e instanceof Error ? e.message : 'The call could not start.')
    }
  }, [])

  const stop = useCallback(() => vapiRef.current?.stop(), [])

  return { status, transcript, language, problem, start, stop }
}
