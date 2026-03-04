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
  CONFIG_FILE_PATH,
  RELAY_PORT,
  getExtensionOutdatedWarning,
  RelayApiClient,
  readConfig,
  writeConfig,
} from '@agmod/runbrowser-relay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

/** Create a RelayApiClient from CLI options, env vars, then config file (in that priority order) */
function createClient(options?: { host?: string; token?: string }): RelayApiClient {
  const config = readConfig()
  return new RelayApiClient({
    host: options?.host || process.env.RUNBROWSER_HOST || config.host,
    token: options?.token || process.env.RUNBROWSER_TOKEN || config.token,
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

// ============================================================================
// High-level browser commands (Phase 5)
// ============================================================================

/** Shared helper: get sessionId from options or env */
function requireSession(options: { session?: string }): string {
  const sessionId = options.session ? String(options.session) : process.env.RUNBROWSER_SESSION
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Run `runbrowser session new` first to get a session ID.')
    process.exit(1)
  }
  return sessionId!
}

/** Shared helper: ensure server running and create client */
async function initClient(options: { host?: string; token?: string }) {
  const client = createClient(options)
  await client.ensureServer(cliRelayEnv)
  return client
}

cli
  .command('navigate <url>', 'Navigate to a URL')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (url: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.navigate(sessionId, url)
      console.log(`Navigated to ${result.url}\nTitle: ${result.title}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('snapshot', 'Take an accessibility snapshot of the current page')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .option('--interactive', 'Show only interactive elements', { default: false })
  .action(async (options: { host?: string; token?: string; session?: string; interactive?: boolean }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.snapshot(sessionId, { interactiveOnly: options.interactive })
      console.log(result.snapshot)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('screenshot', 'Take a screenshot of the current page')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .option('--output <path>', 'Save screenshot to file (base64 JPEG by default)')
  .action(async (options: { host?: string; token?: string; session?: string; output?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.captureScreenshot(sessionId)
      if (options.output) {
        const fs = await import('node:fs')
        fs.writeFileSync(options.output, Buffer.from(result.data, 'base64'))
        console.log(`Screenshot saved to ${options.output}`)
      } else {
        console.log(`Screenshot captured (${result.mimeType}, ${result.data.length} base64 chars)`)
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('click <ref>', 'Click an element by @ref or CSS selector')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (ref: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.click(sessionId, ref)
      console.log(`Clicked ${ref}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('fill <ref> <value>', 'Fill an input field by @ref or CSS selector')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (ref: string, value: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.fill(sessionId, ref, value)
      console.log(`Filled ${ref} with "${value}"`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('type <text>', 'Type text at the current focus position')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (text: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.type(sessionId, text)
      console.log(`Typed "${text}"`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('press <key>', 'Press a keyboard key (Enter, Tab, Escape, etc.)')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (key: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.press(sessionId, key)
      console.log(`Pressed ${key}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('scroll <direction>', 'Scroll the page (up/down/left/right)')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .option('--amount <px>', 'Scroll amount in pixels')
  .action(async (direction: string, options: { host?: string; token?: string; session?: string; amount?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const dir = direction as 'up' | 'down' | 'left' | 'right'
      const amount = options.amount ? parseInt(options.amount, 10) : undefined
      await client.scroll(sessionId, dir, amount)
      console.log(`Scrolled ${direction}${amount ? ` by ${amount}px` : ''}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('hover <ref>', 'Hover over an element by @ref or CSS selector')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (ref: string, options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.hover(sessionId, ref)
      console.log(`Hovered over ${ref}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('evaluate <code>', 'Run JavaScript code in the browser')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .option('--timeout <ms>', 'Execution timeout in milliseconds', { default: 10000 })
  .action(async (code: string, options: { host?: string; token?: string; session?: string; timeout?: number }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.evaluate(sessionId, code, options.timeout)
      if (result.text) {
        if (result.isError) {
          console.error(result.text)
        } else {
          console.log(result.text)
        }
      }
      if (result.isError) process.exit(1)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('get-url', 'Get the current page URL')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.getUrl(sessionId)
      console.log(result.url)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('get-title', 'Get the current page title')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      const result = await client.getTitle(sessionId)
      console.log(result.title)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('back', 'Navigate back in browser history')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.back(sessionId)
      console.log('Navigated back')
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('forward', 'Navigate forward in browser history')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.forward(sessionId)
      console.log('Navigated forward')
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('reload', 'Reload the current page')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token')
  .option('-s, --session <name>', 'Session ID')
  .action(async (options: { host?: string; token?: string; session?: string }) => {
    const sessionId = requireSession(options)
    const client = await initClient(options)
    try {
      await client.reload(sessionId)
      console.log('Page reloaded')
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
  .option('--host <host>', 'Host to bind to (default: 127.0.0.1, use "0.0.0.0" for remote/Docker access)', { default: '127.0.0.1' })
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

// ============================================================================
// Config commands — store token and host in ~/.runbrowser/config.json
// ============================================================================

cli
  .command('config set <key> <value>', 'Set a config value (token, host)')
  .action((key: string, value: string) => {
    const allowed = ['token', 'host']
    if (!allowed.includes(key)) {
      console.error(`Error: Unknown config key "${key}". Allowed keys: ${allowed.join(', ')}`)
      process.exit(1)
    }
    const config = readConfig()
    ;(config as any)[key] = value
    writeConfig(config)
    console.log(`Config saved: ${key} = ${key === 'token' ? '***' : value}`)
    console.log(`Config file: ${CONFIG_FILE_PATH}`)
  })

cli
  .command('config unset <key>', 'Remove a config value (token, host)')
  .action((key: string) => {
    const config = readConfig()
    delete (config as any)[key]
    writeConfig(config)
    console.log(`Config removed: ${key}`)
  })

cli
  .command('config show', 'Show current config')
  .action(() => {
    const config = readConfig()
    console.log(`Config file: ${CONFIG_FILE_PATH}`)
    if (Object.keys(config).length === 0) {
      console.log('(empty)')
      return
    }
    if (config.host) console.log(`  host:  ${config.host}`)
    if (config.token) console.log(`  token: ${'*'.repeat(config.token.length)}`)
  })

cli.command('skill', 'Print the full runbrowser usage instructions').action(() => {
  const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

cli.help()
cli.version(VERSION)

cli.parse()
