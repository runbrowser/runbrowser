/**
 * Custom command API endpoints.
 *
 * GET  /api/commands          — list available commands
 * POST /api/command/run       — execute a command
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'
import { listCustomCommands, loadCommand, type CommandContext } from '../custom-commands.js'

export function registerApiCustomCommandRoutes(app: Hono, ctx: ServerContext) {
  app.get('/api/commands', (c) => {
    const commands = listCustomCommands()
    return c.json({ commands })
  })

  app.post('/api/command/run', async (c) => {
    try {
      const body = await c.req.json() as {
        sessionId: string | number
        site: string
        name: string
        args?: Record<string, any>
      }

      const { site, name, args = {} } = body
      if (!site || !name) {
        return c.json({ error: 'site and name are required' }, 400)
      }

      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const executor = ctx.getCDPExecutor(sessionId)
      if (!executor) {
        return c.json({ error: `Session ${sessionId} not found` }, 404)
      }

      // Load command module
      const command = await loadCommand(site, name)
      if (!command) {
        return c.json({ error: `Command not found: ${site} ${name}` }, 404)
      }

      // Build command context that delegates to the CDP executor
      const commandCtx: CommandContext = {
        navigate: async (url: string) => {
          await executor.navigate(url)
        },
        evaluate: async (code: string) => {
          const result = await executor.execute(code, 30000)
          if (result.isError) throw new Error(result.text)
          try {
            return JSON.parse(result.text)
          } catch {
            return result.text
          }
        },
        wait: (ms: number) => new Promise(r => setTimeout(r, ms)),
      }

      // Run the command
      const data = await command.run(commandCtx, args)
      const columns = command.columns || (data.length > 0 ? Object.keys(data[0]) : [])

      return c.json({ data, columns })
    } catch (error: any) {
      return c.json({ error: error.message }, 500)
    }
  })
}
