import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

/**
 * Vapi posts here when a call ends. Set the same URL as the assistant's server
 * URL in the dashboard:
 *   https://<deployment>.convex.site/vapi/webhook
 */

const http = httpRouter()

interface EndOfCallReport {
  message?: {
    type?: string
    endedReason?: string
    call?: { id?: string }
    artifact?: { transcript?: string }
  }
}

http.route({
  path: '/vapi/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.VAPI_SERVER_SECRET
    if (secret && request.headers.get('x-vapi-secret') !== secret) {
      return new Response('forbidden', { status: 403 })
    }

    const body = (await request.json()) as EndOfCallReport
    const message = body.message

    /** Vapi posts several event types to one URL. Everything else is informational. */
    if (message?.type !== 'end-of-call-report') return new Response(null, { status: 200 })

    const vapiCallId = message.call?.id
    if (!vapiCallId) return new Response('no call id', { status: 400 })

    await ctx.runMutation(internal.call.recordTranscript, {
      vapiCallId,
      transcript: message.artifact?.transcript ?? '',
      ended: message.endedReason ?? 'unknown',
    })

    return new Response(null, { status: 200 })
  }),
})

export default http
