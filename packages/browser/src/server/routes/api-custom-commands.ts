/**
 * Custom command API endpoints.
 *
 * GET  /api/commands          — list available commands
 * POST /api/command/run       — execute a command
 */

import type { Routes } from '../http.js'
import { readJson } from '../http.js'
import type { ServerContext } from '../server-context.js'
import type { CDPExecutor } from '../cdp-executor.js'
import { listCustomCommands, loadCommand, type CommandContext } from '../custom-commands.js'

/**
 * Poll document.readyState until the page finishes loading.
 *
 * Page.navigate resolves as soon as navigation is committed, not when the
 * document is usable, and site commands assume the latter.
 */
async function waitForDocumentReady(executor: CDPExecutor, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = (await executor.rawCDP('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })) as { result?: { value?: string } }
    if (response?.result?.value === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function apiCustomCommandRoutes(ctx: ServerContext): Routes {
  return {
    '/api/commands': async () => Response.json({ commands: await listCustomCommands() }),

    '/api/command/run': {
      POST: async (request) => {
        try {
          const body = await readJson<{
            sessionId: string | number
            site: string
            name: string
            args?: Record<string, any>
          }>(request, { sessionId: '', site: '', name: '' })

          const { site, name, args = {} } = body
          if (!site || !name) {
            return Response.json({ error: 'site and name are required' }, { status: 400 })
          }

          const sessionId = ctx.normalizeSessionId(body.sessionId)
          if (!sessionId) {
            return Response.json({ error: 'sessionId is required' }, { status: 400 })
          }

          const executor = ctx.getCDPExecutor(sessionId)
          if (!executor) {
            return Response.json({ error: `Session ${sessionId} not found` }, { status: 404 })
          }

          const command = await loadCommand(site, name)
          if (!command) {
            return Response.json({ error: `Command not found: ${site} ${name}` }, { status: 404 })
          }

          // Build command context that delegates to the CDP executor.
          //
          // `navigate` stays in the context even though the CLI no longer has a
          // navigate verb: it is the published contract for site commands in the
          // runbrowser/commands repo, so it is implemented here on raw CDP rather
          // than dropped.
          const commandCtx: CommandContext = {
            navigate: async (url: string) => {
              await executor.rawCDP('Page.enable')
              await executor.rawCDP('Page.navigate', { url })
              await waitForDocumentReady(executor)
            },
            evaluate: async (code: string) => {
              const result = await executor.execute(code, 30000)
              if (result.isError) throw new Error(result.text)
              try {
                return JSON.parse(result.text)
              } catch {
                // A plain string result is not JSON; hand it back as-is.
                return result.text
              }
            },
            wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
          }

          const data = await command.run(commandCtx, args)
          const columns = command.columns || (data.length > 0 ? Object.keys(data[0]) : [])

          return Response.json({ data, columns })
        } catch (error: any) {
          ctx.logger?.error(`[CustomCommand] error:`, error.message, error.stack)
          return Response.json({ error: error.message }, { status: 500 })
        }
      },
    },
  }
}
