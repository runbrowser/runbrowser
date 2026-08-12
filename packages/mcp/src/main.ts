#!/usr/bin/env node

/**
 * runbrowser-mcp — standalone MCP server entry point.
 *
 * Usage:
 *   npx runbrowser-mcp
 *   npx runbrowser-mcp --host <remote-host> --token <secret>
 */

import { cac } from 'cac'
import { startMcp } from './server.js'

const cli = cac('runbrowser-mcp')

cli
  .command('', 'Start the RunBrowser MCP server')
  .option('--host <host>', 'Remote relay server host to connect to (or use TERMIO_BROWSER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use TERMIO_BROWSER_TOKEN env var)')
  .action(async (options: { host?: string; token?: string }) => {
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

cli.help()

// Read version from package.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgJsonPath = path.join(__dirname, '..', 'package.json')
const pkgVersion = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).version as string
cli.version(pkgVersion)

cli.parse()
