#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
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
  RELAY_PORT,
  getExtensionOutdatedWarning,
  RelayApiClient,
} from '@runbrowser/relay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

/** Create a RelayApiClient from CLI options */
function createClient(options?: { host?: string; token?: string }): RelayApiClient {
  return new RelayApiClient({
    host: options?.host,
    token: options?.token,
    logger: console,
  })
}

const cli = cac('runbrowser')

cli
  .command('', 'Control the browser with -e')
  .option('--host <host>', 'Remote relay server host to connect to (or use RUNBROWSER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use RUNBROWSER_TOKEN env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `runbrowser session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit')
  .option('--timeout <ms>', 'Execution timeout in milliseconds', { default: 10000 })
  .action(async (options: { host?: string; token?: string; eval?: string; timeout?: number; session?: string }) => {
    if (!options.eval) {
      // No -e flag: show help
      cli.outputHelp()
      return
    }

    const sessionId = options.session ? String(options.session) : process.env.RUNBROWSER_SESSION
    if (!sessionId) {
      console.error('Error: -s/--session is required.')
      console.error('Always run `runbrowser session new` first to get a session ID to use.')
      process.exit(1)
    }

    const client = createClient(options)

    try {
      // Ensure relay server is running
      await client.ensureServer(cliRelayEnv)

      // Warn if extension is outdated
      const extensions = await client.fetchExtensionsStatus()
      for (const ext of extensions) {
        const warning = getExtensionOutdatedWarning(ext.extensionVersion)
        if (warning) {
          console.error(warning)
          break
        }
      }

      const result = await client.execute(sessionId, options.eval, options.timeout || 10000)

      if (result.text) {
        if (result.isError) {
          console.error(result.text)
        } else {
          console.log(result.text)
        }
      }

      if (result.images && result.images.length > 0) {
        console.log(`\n${result.images.length} screenshot(s) captured`)
      }

      if (result.isError) {
        process.exit(1)
      }
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED') {
        console.error('Error: Cannot connect to relay server.')
        console.error('The RunBrowser relay server should start automatically. Check logs at:')
        console.error(`  ${LOG_FILE_PATH}`)
      } else {
        console.error(`Error: ${error.message}`)
      }
      process.exit(1)
    }
  })

// Session management commands
cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--browser <stableKey>', 'Stable browser key when multiple browsers are connected')
  .action(async (options: { host?: string; browser?: string }) => {
    const client = createClient(options)

    // Ensure server and wait for extensions
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

    // Warn if any connected extension is outdated
    for (const ext of extensions) {
      const warning = getExtensionOutdatedWarning(ext.extensionVersion)
      if (warning) {
        console.error(warning)
        break
      }
    }

    // Select extension
    let selectedExtension = extensions[0]

    if (extensions.length > 1) {
      if (!options.browser) {
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

      const found = extensions.find((ext) => ext.stableKey === options.browser)
      if (!found) {
        console.error(`Browser not found: ${options.browser}`)
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
      console.log(`Session ${session.id} created. Use with: runbrowser -s ${session.id} -e "..."`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session list', 'List all active sessions')
  .option('--host <host>', 'Remote relay server host')
  .action(async (options: { host?: string }) => {
    const client = createClient(options)
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
  })

cli
  .command('session delete <sessionId>', 'Delete a session and clear its state')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const client = createClient(options)
    await client.ensureServer(cliRelayEnv)

    try {
      await client.deleteSession(sessionId)
      console.log(`Session ${sessionId} deleted.`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session reset <sessionId>', 'Reset the browser connection for a session')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const client = createClient(options)
    await client.ensureServer(cliRelayEnv)

    try {
      const result = await client.reset(sessionId)
      console.log(
        `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
      )
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command(
    'serve',
    `Start the relay server on this machine (must be the same host where Chrome is running). Remote clients (Docker, other machines) connect via RUNBROWSER_HOST. Use --host localhost for Docker (no token needed) — containers reach it via host.docker.internal. Use --host 0.0.0.0 for LAN/internet access (requires --token).`,
  )
  .option('--host <host>', 'Host to bind to (use "localhost" for Docker, "0.0.0.0" for remote access)', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token, required when --host is 0.0.0.0 (or use RUNBROWSER_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options: { host: string; token?: string; replace?: boolean }) => {
    const token = options.token || process.env.RUNBROWSER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set RUNBROWSER_TOKEN environment variable.')
      process.exit(1)
    }

    // Check if server is already running on the port
    const portInUse = await isPortInUse(RELAY_PORT)

    if (portInUse) {
      if (!options.replace) {
        console.log(`RunBrowser server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      await killPortProcess({ port: RELAY_PORT })
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger, startRunBrowserCDPRelayServer } = await import('@runbrowser/relay')

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
      host: options.host,
      token,
      logger,
    })

    console.log('RunBrowser CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
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
  })

cli.command('logfile', 'Print the path to the relay server log file').action(() => {
  console.log(`relay: ${LOG_FILE_PATH}`)
  console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
})

cli.command('skill', 'Print the full runbrowser usage instructions').action(() => {
  const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

cli.help()
cli.version(VERSION)

cli.parse()
