#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import pc from 'picocolors'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import {
  killPortProcess,
  isPortInUse,
  VERSION,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  CONFIG_FILE_PATH,
  RELAY_PORT,
  getExtensionOutdatedWarning,
  RelayApiClient,
  readConfig,
  writeConfig,
} from '@agmod/runbrowser-relay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Create a RelayApiClient from CLI options, env vars, then config file (in that priority order) */
function createClient(argv: { host?: string; token?: string }): RelayApiClient {
  const config = readConfig()
  return new RelayApiClient({
    host: argv.host || process.env.RUNBROWSER_HOST || config.host,
    token: argv.token || process.env.RUNBROWSER_TOKEN || config.token,
    logger: console,
  })
}

/** Get sessionId from argv or env, exit if missing */
function requireSession(argv: { session?: string | number }): string {
  const sessionId = argv.session != null ? String(argv.session) : process.env.RUNBROWSER_SESSION
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Run `runbrowser session-new` first to get a session ID.')
    process.exit(1)
  }
  return sessionId!
}

/** Ensure server running and create client */
async function initClient(argv: { host?: string; token?: string }) {
  const client = createClient(argv)
  await client.ensureServer(cliRelayEnv)
  return client
}

// ---------------------------------------------------------------------------
// Shared option builders
// ---------------------------------------------------------------------------

const hostOption = {
  host: { type: 'string' as const, describe: 'Remote relay server host (or RUNBROWSER_HOST env var)' },
} as const

const tokenOption = {
  token: { type: 'string' as const, describe: 'Authentication token (or RUNBROWSER_TOKEN env var)' },
} as const

const sessionOption = {
  session: {
    alias: 's',
    type: 'string' as const,
    describe: 'Session ID (get one with `runbrowser session-new`)',
  },
} as const

const browserOptions = { ...hostOption, ...tokenOption, ...sessionOption } as const

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

await yargs(hideBin(process.argv))
  .scriptName('runbrowser')
  .version(VERSION)
  .strict()
  .demandCommand(1, 'Run `runbrowser --help` to see available commands.')
  .fail((msg, err) => {
    if (err) throw err
    console.error(msg)
    process.exit(1)
  })

  // =========================================================================
  // Execute code: runbrowser exec -s <id> -e "<code>"
  // =========================================================================
  .command(
    'exec',
    'Execute JavaScript code in the Playwright sandbox',
    (y) =>
      y
        .options(browserOptions)
        .option('eval', { alias: 'e', type: 'string', describe: 'JavaScript code to execute', demandOption: true })
        .option('timeout', { type: 'number', describe: 'Execution timeout in ms', default: 10000 }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.ensureServer(cliRelayEnv)
        const extensions = await client.fetchExtensionsStatus()
        for (const ext of extensions) {
          const warning = getExtensionOutdatedWarning(ext.extensionVersion)
          if (warning) {
            console.error(warning)
            break
          }
        }

        const result = await client.execute(sessionId, argv.eval, argv.timeout)

        if (result.text) {
          if (result.isError) console.error(result.text)
          else console.log(result.text)
        }
        if (result.images && result.images.length > 0) {
          console.log(`\n${result.images.length} screenshot(s) captured`)
        }
        if (result.isError) process.exit(1)
      } catch (error: any) {
        if (error.cause?.code === 'ECONNREFUSED') {
          console.error('Error: Cannot connect to relay server.')
          console.error(`The RunBrowser relay server should start automatically. Check logs at:\n  ${LOG_FILE_PATH}`)
        } else {
          console.error(`Error: ${error.message}`)
        }
        process.exit(1)
      }
    },
  )

  // =========================================================================
  // Session management
  // =========================================================================
  .command(
    'session-new',
    'Create a new session and print the session ID',
    (y) => y.options(hostOption).option('browser', { type: 'string', describe: 'Stable browser key when multiple browsers are connected' }),
    async (argv) => {
      const client = createClient(argv)
      await client.ensureServer(cliRelayEnv)
      let extensions = await client.waitForExtensions({ timeoutMs: 12000, pollIntervalMs: 250 })

      if (extensions.length === 0) {
        console.log(pc.dim('Waiting briefly for extension to reconnect...'))
        extensions = await client.waitForExtensions({ timeoutMs: 10000, pollIntervalMs: 250 })
      }

      if (extensions.length === 0) {
        console.error('No connected browsers detected. Click the RunBrowser extension icon.')
        process.exit(1)
      }

      for (const ext of extensions) {
        const warning = getExtensionOutdatedWarning(ext.extensionVersion)
        if (warning) {
          console.error(warning)
          break
        }
      }

      let selectedExtension = extensions[0]

      if (extensions.length > 1) {
        if (!argv.browser) {
          console.log('Multiple browsers detected:\n')
          console.log('KEY                      BROWSER  PROFILE')
          console.log('-----------------------  -------  -------')
          for (const extension of extensions) {
            const label = extension.profile?.email || '(not signed in)'
            const stableKey = extension.stableKey || '-'
            console.log(`${stableKey.padEnd(23)}  ${(extension.browser || 'Chrome').padEnd(7)}  ${label}`)
          }
          console.log('\nRun again with --browser <stableKey>.')
          process.exit(1)
        }
        const found = extensions.find((ext) => ext.stableKey === argv.browser)
        if (!found) {
          console.error(`Browser not found: ${argv.browser}`)
          process.exit(1)
        }
        selectedExtension = found
      }

      try {
        const extensionId =
          selectedExtension.extensionId === 'default'
            ? null
            : selectedExtension.stableKey || selectedExtension.extensionId
        const session = await client.createSession({ extensionId, cwd: process.cwd() })
        console.log(`Session ${session.id} created. Use with: runbrowser exec -s ${session.id} -e "..."`)
        console.log(`Or use high-level commands: runbrowser navigate <url> -s ${session.id}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'session-list',
    'List all active sessions',
    (y) => y.options(hostOption),
    async (argv) => {
      const client = createClient(argv)
      await client.ensureServer(cliRelayEnv)
      try {
        const sessions = await client.listSessions()
        if (sessions.length === 0) {
          console.log('No active sessions')
          return
        }

        const idWidth = Math.max(2, ...sessions.map((s) => String(s.id).length))
        const browserWidth = Math.max(7, ...sessions.map((s) => (s.browser || 'Chrome').length))
        const profileWidth = Math.max(7, ...sessions.map((s) => (s.profile?.email || '').length || 1))
        const extensionWidth = Math.max(2, ...sessions.map((s) => (s.extensionId || '').length || 1))
        const stateWidth = Math.max(10, ...sessions.map((s) => s.stateKeys.join(', ').length || 1))

        console.log(
          'ID'.padEnd(idWidth) +
            '  ' +
            'BROWSER'.padEnd(browserWidth) +
            '  ' +
            'PROFILE'.padEnd(profileWidth) +
            '  ' +
            'EXT'.padEnd(extensionWidth) +
            '  ' +
            'STATE KEYS',
        )
        console.log('-'.repeat(idWidth + browserWidth + profileWidth + extensionWidth + stateWidth + 8))

        for (const session of sessions) {
          const stateStr = session.stateKeys.length > 0 ? session.stateKeys.join(', ') : '-'
          const profileLabel = session.profile?.email || '-'
          console.log(
            String(session.id).padEnd(idWidth) +
              '  ' +
              (session.browser || 'Chrome').padEnd(browserWidth) +
              '  ' +
              profileLabel.padEnd(profileWidth) +
              '  ' +
              (session.extensionId || '-').padEnd(extensionWidth) +
              '  ' +
              stateStr,
          )
        }
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'session-delete <sessionId>',
    'Delete a session and clear its state',
    (y) => y.options(hostOption).positional('sessionId', { type: 'string', demandOption: true }),
    async (argv) => {
      const client = createClient(argv)
      await client.ensureServer(cliRelayEnv)
      try {
        await client.deleteSession(argv.sessionId)
        console.log(`Session ${argv.sessionId} deleted.`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'session-reset <sessionId>',
    'Reset the browser connection for a session',
    (y) => y.options(hostOption).positional('sessionId', { type: 'string', demandOption: true }),
    async (argv) => {
      const client = createClient(argv)
      await client.ensureServer(cliRelayEnv)
      try {
        const result = await client.reset(argv.sessionId)
        console.log(
          `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
        )
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  // =========================================================================
  // High-level browser commands
  // =========================================================================
  .command(
    'navigate <url>',
    'Navigate to a URL',
    (y) => y.options(browserOptions).positional('url', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.navigate(sessionId, argv.url)
        console.log(`Navigated to ${result.url}\nTitle: ${result.title}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'snapshot',
    'Take an accessibility snapshot of the current page',
    (y) => y.options(browserOptions).option('interactive', { type: 'boolean', describe: 'Show only interactive elements', default: false }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.snapshot(sessionId, { interactiveOnly: argv.interactive })
        console.log(result.snapshot)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'screenshot',
    'Take a screenshot of the current page',
    (y) => y.options(browserOptions).option('output', { type: 'string', describe: 'Save screenshot to file' }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.captureScreenshot(sessionId)
        if (argv.output) {
          fs.writeFileSync(argv.output, Buffer.from(result.data, 'base64'))
          console.log(`Screenshot saved to ${argv.output}`)
        } else {
          console.log(`Screenshot captured (${result.mimeType}, ${result.data.length} base64 chars)`)
        }
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'click <ref>',
    'Click an element by @ref or CSS selector',
    (y) => y.options(browserOptions).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.click(sessionId, argv.ref)
        console.log(`Clicked ${argv.ref}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'fill <ref> <value>',
    'Fill an input field by @ref or CSS selector',
    (y) =>
      y
        .options(browserOptions)
        .positional('ref', { type: 'string', demandOption: true })
        .positional('value', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.fill(sessionId, argv.ref, argv.value)
        console.log(`Filled ${argv.ref} with "${argv.value}"`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'type <text>',
    'Type text at the current focus position',
    (y) => y.options(browserOptions).positional('text', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.type(sessionId, argv.text)
        console.log(`Typed "${argv.text}"`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'press <key>',
    'Press a keyboard key (Enter, Tab, Escape, etc.)',
    (y) => y.options(browserOptions).positional('key', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.press(sessionId, argv.key)
        console.log(`Pressed ${argv.key}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'scroll <direction>',
    'Scroll the page (up/down/left/right)',
    (y) =>
      y
        .options(browserOptions)
        .positional('direction', { type: 'string', choices: ['up', 'down', 'left', 'right'] as const, demandOption: true })
        .option('amount', { type: 'number', describe: 'Scroll amount in pixels' }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.scroll(sessionId, argv.direction, argv.amount)
        console.log(`Scrolled ${argv.direction}${argv.amount ? ` by ${argv.amount}px` : ''}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'hover <ref>',
    'Hover over an element by @ref or CSS selector',
    (y) => y.options(browserOptions).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.hover(sessionId, argv.ref)
        console.log(`Hovered over ${argv.ref}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'evaluate <code>',
    'Run JavaScript code in the browser (via CDP Runtime.evaluate)',
    (y) =>
      y
        .options(browserOptions)
        .positional('code', { type: 'string', demandOption: true })
        .option('timeout', { type: 'number', describe: 'Execution timeout in ms', default: 10000 }),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.evaluate(sessionId, argv.code, argv.timeout)
        if (result.text) {
          if (result.isError) console.error(result.text)
          else console.log(result.text)
        }
        if (result.isError) process.exit(1)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'get-url',
    'Get the current page URL',
    (y) => y.options(browserOptions),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.getUrl(sessionId)
        console.log(result.url)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'get-title',
    'Get the current page title',
    (y) => y.options(browserOptions),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        const result = await client.getTitle(sessionId)
        console.log(result.title)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'back',
    'Navigate back in browser history',
    (y) => y.options(browserOptions),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.back(sessionId)
        console.log('Navigated back')
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'forward',
    'Navigate forward in browser history',
    (y) => y.options(browserOptions),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.forward(sessionId)
        console.log('Navigated forward')
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  .command(
    'reload',
    'Reload the current page',
    (y) => y.options(browserOptions),
    async (argv) => {
      const sessionId = requireSession(argv)
      const client = await initClient(argv)
      try {
        await client.reload(sessionId)
        console.log('Page reloaded')
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

  // =========================================================================
  // Serve
  // =========================================================================
  .command(
    'serve',
    'Start the relay server (must run on same host as Chrome)',
    (y) =>
      y
        .option('host', { type: 'string', describe: 'Host to bind to (use "0.0.0.0" for remote/Docker access)', default: '127.0.0.1' })
        .option('token', { type: 'string', describe: 'Auth token, required when --host is 0.0.0.0' })
        .option('replace', { type: 'boolean', describe: 'Kill existing server if running' }),
    async (argv) => {
      const token = argv.token || process.env.RUNBROWSER_TOKEN
      const isPublicHost = argv.host === '0.0.0.0' || argv.host === '::'
      if (isPublicHost && !token) {
        console.error('Error: Authentication token is required when binding to a public host.')
        console.error('Provide --token <token> or set RUNBROWSER_TOKEN environment variable.')
        process.exit(1)
      }

      const portInUse = await isPortInUse(RELAY_PORT)

      if (portInUse) {
        if (!argv.replace) {
          console.log(`RunBrowser server is already running on port ${RELAY_PORT}`)
          console.log('Tip: Use --replace to kill the existing server and start a new one.')
          process.exit(0)
        }
        console.log(`Killing existing server on port ${RELAY_PORT}...`)
        await killPortProcess({ port: RELAY_PORT })
      }

      const { createFileLogger, startRunBrowserCDPRelayServer } = await import('@agmod/runbrowser-relay')
      const logger = createFileLogger()

      process.title = 'runbrowser-serve'

      process.on('uncaughtException', async (err) => {
        await logger.error('Uncaught Exception:', err)
        process.exit(1)
      })

      process.on('unhandledRejection', async (reason) => {
        await logger.error('Unhandled Rejection:', reason)
        process.exit(1)
      })

      const server = await startRunBrowserCDPRelayServer({
        port: RELAY_PORT,
        host: argv.host,
        token,
        logger,
      })

      console.log('RunBrowser CDP relay server started')
      console.log(`  Host: ${argv.host}`)
      console.log(`  Port: ${RELAY_PORT}`)
      console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
      console.log(`  Logs: ${logger.logFilePath}`)
      console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
      console.log('')
      console.log(`CDP endpoint: http://${argv.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
      console.log('')
      console.log('Press Ctrl+C to stop.')

      process.on('SIGINT', () => {
        console.log('\nShutting down...')
        server.close()
        process.exit(0)
      })

      process.on('SIGTERM', () => {
        console.log('\nShutting down...')
        server.close()
        process.exit(0)
      })
    },
  )

  // =========================================================================
  // Utility commands
  // =========================================================================
  .command(
    'logfile',
    'Print the path to the relay server log file',
    {},
    () => {
      console.log(`relay: ${LOG_FILE_PATH}`)
      console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
    },
  )

  .command(
    'config-set <key> <value>',
    'Set a config value (token, host)',
    (y) =>
      y
        .positional('key', { type: 'string', choices: ['token', 'host'] as const, demandOption: true })
        .positional('value', { type: 'string', demandOption: true }),
    (argv) => {
      const config = readConfig()
      ;(config as any)[argv.key] = argv.value
      writeConfig(config)
      console.log(`Config saved: ${argv.key} = ${argv.key === 'token' ? '***' : argv.value}`)
      console.log(`Config file: ${CONFIG_FILE_PATH}`)
    },
  )

  .command(
    'config-unset <key>',
    'Remove a config value (token, host)',
    (y) => y.positional('key', { type: 'string', choices: ['token', 'host'] as const, demandOption: true }),
    (argv) => {
      const config = readConfig()
      delete (config as any)[argv.key]
      writeConfig(config)
      console.log(`Config removed: ${argv.key}`)
    },
  )

  .command(
    'config-show',
    'Show current config',
    {},
    () => {
      const config = readConfig()
      console.log(`Config file: ${CONFIG_FILE_PATH}`)
      if (Object.keys(config).length === 0) {
        console.log('(empty)')
        return
      }
      if (config.host) console.log(`  host:  ${config.host}`)
      if (config.token) console.log(`  token: ${'*'.repeat(config.token.length)}`)
    },
  )

  .command(
    'skill',
    'Print the full runbrowser usage instructions',
    {},
    () => {
      const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
      const content = fs.readFileSync(skillPath, 'utf-8')
      console.log(content)
    },
  )

  .parseAsync()
