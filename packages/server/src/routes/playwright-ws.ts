/**
 * Playwright/CDP client WebSocket endpoint (/cdp/:clientId).
 *
 * Handles incoming CDP commands from Playwright or other CDP clients,
 * routes them through the extension, and sends responses back.
 */

import type { Hono } from 'hono'
import type { Protocol } from '../cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase, CDPEventFor } from '../cdp-types.js'
import type { ServerContext } from '../server-context.js'
import { logCdpMessage } from '../server-context.js'
import { isRestrictedTarget } from '../target-filter.js'
import { EXTENSION_IDS } from '../utils.js'
import * as relayState from '../state.js'
import pc from 'picocolors'

export function registerPlaywrightWsRoute(
  app: Hono,
  ctx: ServerContext,
  upgradeWebSocket: ReturnType<typeof import('@hono/node-ws').createNodeWebSocket>['upgradeWebSocket'],
) {
  app.get(
    '/cdp/:clientId?',
    // Auth middleware
    (c, next) => {
      const origin = c.req.header('origin')

      if (origin) {
        if (origin.startsWith('chrome-extension://')) {
          const extensionId = origin.replace('chrome-extension://', '')
          if (!EXTENSION_IDS.includes(extensionId)) {
            ctx.logger?.log(pc.red(`Rejecting /cdp WebSocket from unknown extension: ${extensionId}`))
            return c.text('Forbidden', 403)
          }
        } else {
          ctx.logger?.log(pc.red(`Rejecting /cdp WebSocket from origin: ${origin}`))
          return c.text('Forbidden', 403)
        }
      }

      if (ctx.token) {
        const url = new URL(c.req.url, 'http://localhost')
        const providedToken = url.searchParams.get('token')
        if (providedToken !== ctx.token) {
          return c.text('Unauthorized', 401)
        }
      }
      return next()
    },
    upgradeWebSocket((c: any) => {
      const clientId = c.req.param('clientId') || 'default'
      const url = new URL(c.req.url, 'http://localhost')
      const requestedExtensionId = url.searchParams.get('extensionId')
      const resolvedExtension = requestedExtensionId
        ? ctx.getExtensionConnection(requestedExtensionId)
        : ctx.getExtensionConnection(null, { allowFallback: true })
      const clientExtensionId = resolvedExtension?.id || null

      const getBoundExtensionIdForClient = (): string | null => {
        const client = ctx.store.getState().playwrightClients.get(clientId)
        return client?.extensionId || null
      }

      return {
        async onOpen(_event: any, ws: any) {
          if (ctx.store.getState().playwrightClients.has(clientId)) {
            ctx.logger?.log(pc.yellow(`Rejecting duplicate Playwright clientId: ${clientId}`))
            ws.close(4004, 'Duplicate Playwright clientId')
            return
          }

          if (!clientExtensionId) {
            const reason = requestedExtensionId
              ? `Unknown extensionId: ${requestedExtensionId}`
              : 'Multiple extensions connected. Specify extensionId.'
            ctx.logger?.log(pc.yellow(`Rejecting Playwright client ${clientId}: ${reason}`))
            ws.close(4003, reason)
            return
          }

          ctx.store.setState((s) =>
            relayState.addPlaywrightClient(s, { id: clientId, extensionId: clientExtensionId, ws }),
          )
          const extensionConnection = ctx.getExtensionConnection(clientExtensionId)
          const targetCount = extensionConnection?.connectedTargets.size || 0
          ctx.logger?.log(
            pc.green(
              `Playwright client connected: ${clientId} (${ctx.store.getState().playwrightClients.size} total) (extension? ${!!extensionConnection}) (${targetCount} pages)`,
            ),
          )
        },

        async onMessage(event: any, ws: any) {
          let message: CDPCommand
          try {
            message = JSON.parse(event.data.toString())
          } catch {
            return
          }

          const { id, sessionId, method, params, source } = message

          ctx.logCdpJson({
            timestamp: new Date().toISOString(),
            direction: 'from-playwright',
            clientId,
            message,
          })

          logCdpMessage(ctx.logger, {
            direction: 'from-playwright',
            clientId,
            method,
            sessionId,
            id,
          })

          ctx.emitter.emit('cdp:command', { clientId, command: message })

          const boundExtensionId = getBoundExtensionIdForClient()
          const extensionConn = ctx.getExtensionConnection(boundExtensionId)
          if (!extensionConn) {
            ctx.sendToPlaywright({
              message: { id, sessionId, error: { message: 'Extension not connected' } },
              clientId,
            })
            return
          }

          try {
            const result = await ctx.routeCdpCommand({
              extensionId: extensionConn.id,
              method,
              params,
              sessionId,
              source,
            })

            // Post-command: emit synthetic events for Playwright
            emitPostCommandEvents(ctx, extensionConn.id, clientId, method, params, sessionId, result)

            const response: CDPResponseBase = { id, sessionId, result }
            ctx.sendToPlaywright({ message: response, clientId })
            ctx.emitter.emit('cdp:response', { clientId, response, command: message })
          } catch (e) {
            ctx.logger?.error('Error handling CDP command:', method, params, e)
            const errorResponse: CDPResponseBase = {
              id,
              sessionId,
              error: { message: (e as Error).message },
            }
            ctx.sendToPlaywright({ message: errorResponse, clientId })
            ctx.emitter.emit('cdp:response', { clientId, response: errorResponse, command: message })
          }
        },

        onClose() {
          ctx.store.setState((s) => relayState.removePlaywrightClient(s, { clientId }))
          ctx.logger?.log(
            pc.yellow(
              `Playwright client disconnected: ${clientId} (${ctx.store.getState().playwrightClients.size} remaining)`,
            ),
          )
        },

        onError(event: any) {
          ctx.logger?.error(`Playwright WebSocket error [${clientId}]:`, event)
        },
      }
    }),
  )
}

// ============================================================================
// Post-command event emission
// ============================================================================

/**
 * After certain CDP commands, we need to emit synthetic events to Playwright.
 * This handles Target.setAutoAttach, Target.setDiscoverTargets, Target.attachToTarget.
 */
function emitPostCommandEvents(
  ctx: ServerContext,
  extensionId: string,
  clientId: string,
  method: string,
  params: unknown,
  sessionId: string | undefined,
  result: unknown,
) {
  if (method === 'Target.setAutoAttach' && !sessionId) {
    emitAttachedToTargetForAll(ctx, extensionId, clientId)
  }

  if (method === 'Target.setDiscoverTargets' && (params as any)?.discover) {
    emitTargetCreatedForAll(ctx, extensionId, clientId)
  }

  if (method === 'Target.attachToTarget') {
    const attachResponse = result as Protocol.Target.AttachToTargetResponse | undefined
    const attachRequestParams = params as Protocol.Target.AttachToTargetRequest | undefined
    if (attachResponse?.sessionId && attachRequestParams?.targetId) {
      emitAttachedToTargetForOne(ctx, extensionId, clientId, attachResponse.sessionId, attachRequestParams.targetId)
    }
  }
}

function emitAttachedToTargetForAll(ctx: ServerContext, extensionId: string, clientId: string) {
  const freshExt = ctx.store.getState().extensions.get(extensionId)
  const freshTargets = freshExt?.connectedTargets || new Map()
  for (const target of freshTargets.values()) {
    if (isRestrictedTarget(target.targetInfo)) continue
    const payload = {
      method: 'Target.attachedToTarget',
      params: {
        sessionId: target.sessionId,
        targetInfo: { ...target.targetInfo, attached: true },
        waitingForDebugger: false,
      },
    } satisfies CDPEventFor<'Target.attachedToTarget'>
    if (!target.targetInfo.url) {
      ctx.logger?.error(pc.red('[Server] WARNING: Target.attachedToTarget sent with empty URL!'), JSON.stringify(payload))
    }
    ctx.logger?.log(pc.magenta('[Server] Target.attachedToTarget full payload:'), JSON.stringify(payload))
    ctx.sendToPlaywright({ message: payload, clientId, source: 'server' })
  }
}

function emitTargetCreatedForAll(ctx: ServerContext, extensionId: string, clientId: string) {
  const freshExt = ctx.store.getState().extensions.get(extensionId)
  const freshTargets = freshExt?.connectedTargets || new Map()
  for (const target of freshTargets.values()) {
    if (isRestrictedTarget(target.targetInfo)) continue
    const payload = {
      method: 'Target.targetCreated',
      params: {
        targetInfo: { ...target.targetInfo, attached: true },
      },
    } satisfies CDPEventFor<'Target.targetCreated'>
    if (!target.targetInfo.url) {
      ctx.logger?.error(pc.red('[Server] WARNING: Target.targetCreated sent with empty URL!'), JSON.stringify(payload))
    }
    ctx.logger?.log(pc.magenta('[Server] Target.targetCreated full payload:'), JSON.stringify(payload))
    ctx.sendToPlaywright({ message: payload, clientId, source: 'server' })
  }
}

function emitAttachedToTargetForOne(
  ctx: ServerContext,
  extensionId: string,
  clientId: string,
  responseSessionId: string,
  requestTargetId: string,
) {
  const freshExt = ctx.store.getState().extensions.get(extensionId)
  const freshTargets = freshExt?.connectedTargets || new Map()
  const target = Array.from(freshTargets.values()).find((t) => t.targetId === requestTargetId)
  if (target) {
    const payload = {
      method: 'Target.attachedToTarget',
      params: {
        sessionId: responseSessionId,
        targetInfo: { ...target.targetInfo, attached: true },
        waitingForDebugger: false,
      },
    } satisfies CDPEventFor<'Target.attachedToTarget'>
    if (!target.targetInfo.url) {
      ctx.logger?.error(
        pc.red('[Server] WARNING: Target.attachedToTarget (from attachToTarget) sent with empty URL!'),
        JSON.stringify(payload),
      )
    }
    ctx.logger?.log(
      pc.magenta('[Server] Target.attachedToTarget (from attachToTarget) payload:'),
      JSON.stringify(payload),
    )
    ctx.sendToPlaywright({ message: payload, clientId, source: 'server' })
  }
}
