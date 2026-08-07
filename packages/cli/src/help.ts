/**
 * Help system — auto-generates help text from CommandDef metadata.
 *
 * Every command (built-in and user site commands) gets consistent --help output.
 */

import pc from 'picocolors'
import { GLOBAL_FLAGS, type CommandDef, type FlagDef } from './args.js'

// ============================================================================
// Main help (no command specified)
// ============================================================================

export function printMainHelp(
  version: string,
  builtinCommands: CommandDef[],
  siteCommands: CommandDef[],
) {
  console.log(`${pc.bold('runbrowser')} v${version} — Control your running Chrome browser`)
  console.log()
  console.log(`${pc.bold('Usage:')} runbrowser <command> [options]`)
  console.log()

  // Group built-in commands by category
  const categories: Record<string, CommandDef[]> = {
    'Navigation':   [],
    'Observation':  [],
    'Interaction':  [],
    'Execution':    [],
    'Session':      [],
    'Config':       [],
    'Command Extensions': [],
    'Server':       [],
  }

  // Assign commands to categories based on name
  const navCmds = new Set(['navigate', 'back', 'forward', 'reload', 'close'])
  const obsCmds = new Set(['snapshot', 'screenshot', 'get', 'is'])
  const intCmds = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'scroll', 'hover', 'focus', 'upload', 'download', 'drag', 'viewport', 'wait', 'find', 'tab', 'frame'])
  const execCmds = new Set(['eval', 'cdp'])
  const sessCmds = new Set(['session'])
  const cfgCmds = new Set(['config'])
  const cmdsCmds = new Set(['commands'])
  const srvCmds = new Set(['serve', 'logfile', 'skill', 'diff', 'record'])

  for (const cmd of builtinCommands) {
    const name = cmd.name.split(' ')[0]
    if (navCmds.has(name)) categories['Navigation'].push(cmd)
    else if (obsCmds.has(name)) categories['Observation'].push(cmd)
    else if (intCmds.has(name)) categories['Interaction'].push(cmd)
    else if (execCmds.has(name)) categories['Execution'].push(cmd)
    else if (sessCmds.has(name)) categories['Session'].push(cmd)
    else if (cfgCmds.has(name)) categories['Config'].push(cmd)
    else if (cmdsCmds.has(name)) categories['Command Extensions'].push(cmd)
    else if (srvCmds.has(name)) categories['Server'].push(cmd)
    else categories['Navigation'].push(cmd) // default
  }

  for (const [category, cmds] of Object.entries(categories)) {
    if (cmds.length === 0) continue
    console.log(pc.bold(`${category}:`))
    for (const cmd of cmds) {
      const name = cmd.aliases?.length
        ? `${cmd.name} (${cmd.aliases.join(', ')})`
        : cmd.name
      console.log(`  ${pc.green(name.padEnd(28))} ${cmd.description}`)
    }
    console.log()
  }

  // Site commands
  if (siteCommands.length > 0) {
    console.log(pc.bold('Site Commands:'))

    // Group by site
    const bySite = new Map<string, CommandDef[]>()
    for (const cmd of siteCommands) {
      const parts = cmd.name.split(' ')
      const site = parts[0]
      if (!bySite.has(site)) bySite.set(site, [])
      bySite.get(site)!.push(cmd)
    }

    for (const [site, cmds] of bySite) {
      const names = cmds.map(c => c.name.split(' ')[1]).join(', ')
      console.log(`  ${pc.green(site.padEnd(28))} ${names}`)
    }
    console.log()
  }

  console.log(pc.bold('Global Options:'))
  printFlags(GLOBAL_FLAGS)
  console.log()
  console.log(`Run ${pc.cyan('runbrowser <command> --help')} for detailed help on any command.`)
}

// ============================================================================
// Command help
// ============================================================================

export function printCommandHelp(
  cmd: CommandDef,
  extensionFlags?: Map<string, FlagDef>,
) {
  // Usage line
  const usage = cmd.usage ?? buildUsageLine(cmd)
  console.log(`${pc.bold('Usage:')} ${usage}`)
  console.log()

  // Description
  if (cmd.description) {
    console.log(cmd.description)
    console.log()
  }

  // Aliases
  if (cmd.aliases?.length) {
    console.log(`${pc.bold('Aliases:')} ${cmd.aliases.join(', ')}`)
    console.log()
  }

  // Positional arguments
  if (cmd.positionals?.length) {
    console.log(pc.bold('Arguments:'))
    for (const p of cmd.positionals) {
      const label = p.variadic ? `${p.name}..` : p.name
      const req = p.required ? pc.dim(' (required)') : ''
      console.log(`  ${pc.green(label.padEnd(26))} ${p.description ?? ''}${req}`)
    }
    console.log()
  }

  // Command-specific flags
  if (cmd.flags && Object.keys(cmd.flags).length > 0) {
    console.log(pc.bold('Options:'))
    printFlags(cmd.flags)
    console.log()
  }

  // Extension flags
  if (extensionFlags && extensionFlags.size > 0) {
    console.log(pc.bold('Extension Options:'))
    const extObj: Record<string, FlagDef> = {}
    for (const [name, def] of extensionFlags) extObj[name] = def
    printFlags(extObj)
    console.log()
  }

  // Global flags
  console.log(pc.bold('Global Options:'))
  printFlags(GLOBAL_FLAGS)
}

// ============================================================================
// Helpers
// ============================================================================

function buildUsageLine(cmd: CommandDef): string {
  let line = `runbrowser ${cmd.name}`
  if (cmd.positionals?.length) {
    for (const p of cmd.positionals) {
      const label = p.variadic ? `${p.name}..` : p.name
      line += p.required ? ` <${label}>` : ` [${label}]`
    }
  }
  if ((cmd.flags && Object.keys(cmd.flags).length > 0)) {
    line += ' [options]'
  }
  return line
}

function printFlags(flags: Record<string, FlagDef>) {
  const entries = Object.entries(flags)
  // Calculate max width for alignment
  const maxLeft = Math.max(...entries.map(([name, def]) => {
    const alias = def.alias ? `-${def.alias}, ` : '    '
    const typeSuffix = def.type === 'boolean' ? '' : ` <${def.type}>`
    return alias.length + `--${name}`.length + typeSuffix.length
  }))

  for (const [name, def] of entries) {
    const alias = def.alias ? `-${def.alias}, ` : '    '
    const typeSuffix = def.type === 'boolean' ? '' : ` <${def.type}>`
    const left = `  ${alias}--${name}${typeSuffix}`
    const dflt = def.default != null ? pc.dim(` (default: ${def.default})`) : ''
    const choices = def.choices?.length ? pc.dim(` [${def.choices.join(', ')}]`) : ''
    const req = def.required ? pc.yellow(' (required)') : ''
    console.log(`${left.padEnd(maxLeft + 4)} ${def.description ?? ''}${dflt}${choices}${req}`)
  }
}
