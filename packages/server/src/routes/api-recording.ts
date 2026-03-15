/**
 * Recording API endpoints.
 *
 * /recording/start, /recording/stop, /recording/status, /recording/cancel
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'
import type {
  StartRecordingBody,
  StopRecordingParams,
  IsRecordingParams,
  CancelRecordingParams,
} from '../protocol.js'

export function registerApiRecordingRoutes(app: Hono, ctx: ServerContext) {
  app.post('/recording/start', async (c) => {
    const body = (await c.req.json()) as {
      outputPath?: string
      sessionId?: string | number
      frameRate?: number
      audio?: boolean
      videoBitsPerSecond?: number
      audioBitsPerSecond?: number
    }
    const sessionId = ctx.normalizeSessionId(body.sessionId)
    const { sessionId: _sessionId, ...recordingOptions } = body
    const { extensionId, sessionId: resolvedSessionId } = await ctx.resolveRecordingRoute({
      sessionId,
    })
    const relay = ctx.getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const recordingParams = (
      resolvedSessionId
        ? { ...recordingOptions, sessionId: resolvedSessionId }
        : recordingOptions
    ) as StartRecordingBody
    const result = await relay.startRecording(recordingParams)
    const status = result.success ? 200 : (result as any).error?.includes('required') ? 400 : 500
    return c.json(result, status)
  })

  app.post('/recording/stop', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = ctx.normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await ctx.resolveRecordingRoute({
      sessionId,
    })
    const relay = ctx.getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const stopParams: StopRecordingParams = resolvedSessionId
      ? { sessionId: resolvedSessionId }
      : {}
    const result = await relay.stopRecording(stopParams)
    const status = result.success ? 200 : (result as any).error?.includes('not found') ? 404 : 500
    return c.json(result, status)
  })

  app.get('/recording/status', async (c) => {
    const sessionId = ctx.normalizeSessionId(c.req.query('sessionId'))
    const { extensionId, sessionId: resolvedSessionId } = await ctx.resolveRecordingRoute({
      sessionId,
    })
    const relay = ctx.getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ isRecording: false })
    }
    const isRecordingParams: IsRecordingParams = resolvedSessionId
      ? { sessionId: resolvedSessionId }
      : {}
    const result = await relay.isRecording(isRecordingParams)
    return c.json(result)
  })

  app.post('/recording/cancel', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = ctx.normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await ctx.resolveRecordingRoute({
      sessionId,
    })
    const relay = ctx.getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const cancelParams: CancelRecordingParams = resolvedSessionId
      ? { sessionId: resolvedSessionId }
      : {}
    const result = await relay.cancelRecording(cancelParams)
    return c.json(result)
  })
}
