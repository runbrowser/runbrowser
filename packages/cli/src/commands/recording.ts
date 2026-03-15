/**
 * Recording commands: record start, record stop, record status, record cancel
 */

import os from 'node:os'
import path from 'node:path'
import pc from 'picocolors'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output } from '../output.js'
import { EXTENSION_IDS, readConfig } from '@jiweiyuan/runbrowser-server'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a recording error is about missing activeTab permission.
 */
function isActiveTabPermissionError(error: string): boolean {
  return (
    error.includes('Extension has not been invoked') ||
    error.includes('activeTab') ||
    error.includes('enable recording')
  )
}

/**
 * Generate a shell command to restart Chrome with flags that allow automatic tab capture.
 * Uses the profile from config if set, otherwise defaults to "Default".
 */
function getChromeRestartCommand(): string {
  const config = readConfig()
  const profile = config.profile || 'Default'
  const platform = os.platform()
  const extensionFlags = EXTENSION_IDS.map((id) => `--allowlisted-extension-id=${id}`).join(' ')
  const flags = `${extensionFlags} --auto-accept-this-tab-capture --profile-directory=${profile.includes(' ') ? `"${profile}"` : profile}`

  if (platform === 'darwin') {
    return `osascript -e 'quit app "Google Chrome"' && sleep 1 && open -a "Google Chrome" --args ${flags}`
  }
  if (platform === 'win32') {
    return `taskkill /IM chrome.exe /F & timeout /t 1 & start chrome.exe ${flags}`
  }
  // Linux
  return `pkill chrome; sleep 1; google-chrome ${flags}`
}

// ============================================================================
// Command
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'record',
    description: 'Video recording: start, stop, status, cancel',
    positionals: [
      { name: 'command', description: 'start, stop, status, cancel', required: true },
    ],
    flags: {
      output:             { type: 'string',  alias: 'o', description: 'Output file path (for start)' },
      fps:                { type: 'number',  description: 'Frame rate (default: 30)' },
      audio:              { type: 'boolean', description: 'Include tab audio' },
      'video-bitrate':    { type: 'number',  description: 'Video bitrate in bps (default: 2500000)' },
      'audio-bitrate':    { type: 'number',  description: 'Audio bitrate in bps (default: 128000)' },
    },
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const cmd = args.subcommand
    if (!cmd) throw new Error('Usage: runbrowser record <start|stop|status|cancel>')

    const { sessionId, client } = await resolveSession(args)

    switch (cmd) {
      case 'start': {
        const outputPath = (args.flags.get('output') as string) || args.positionals[0]
        if (!outputPath) throw new Error('Output path required: record start --output video.mp4')
        const absolutePath = path.resolve(outputPath)

        const result = await client.startRecording(sessionId, {
          outputPath: absolutePath,
          frameRate: args.flags.get('fps') as number | undefined,
          audio: args.flags.get('audio') as boolean | undefined,
          videoBitsPerSecond: args.flags.get('video-bitrate') as number | undefined,
          audioBitsPerSecond: args.flags.get('audio-bitrate') as number | undefined,
        })

        if (!result.success) {
          if (isActiveTabPermissionError(result.error)) {
            const restartCmd = getChromeRestartCommand()
            console.error(pc.red(`Error: ${result.error}`))
            console.error()
            console.error('For automated recording, restart Chrome with special flags:')
            console.error(pc.dim('  ' + restartCmd))
            console.error()
            console.error(pc.dim('Or click the RunBrowser extension icon on the tab once.'))
            console.error()
            console.error(pc.dim('Tip: set your Chrome profile with: runbrowser config set profile "Profile 11"'))
            process.exit(1)
          }
          throw new Error(result.error)
        }
        if (args.json) output({ success: true, tabId: result.tabId, startedAt: result.startedAt }, true)
        else console.log(`Recording started (tab ${result.tabId})`)
        break
      }

      case 'stop': {
        const result = await client.stopRecording(sessionId)
        if (!result.success) throw new Error(result.error)
        if (args.json) {
          output({ success: true, path: result.path, duration: result.duration, size: result.size }, true)
        } else {
          const durationSec = (result.duration / 1000).toFixed(1)
          const sizeMB = (result.size / 1024 / 1024).toFixed(2)
          console.log(`Recording saved: ${result.path}`)
          console.log(pc.dim(`  duration: ${durationSec}s, size: ${sizeMB} MB`))
        }
        break
      }

      case 'status': {
        const result = await client.recordingStatus(sessionId)
        if (args.json) {
          console.log(JSON.stringify(result))
        } else if (result.isRecording) {
          const elapsed = result.startedAt
            ? ((Date.now() - result.startedAt) / 1000).toFixed(1)
            : '?'
          console.log(`Recording in progress (tab ${result.tabId}, ${elapsed}s elapsed)`)
        } else {
          console.log('Not recording')
        }
        break
      }

      case 'cancel': {
        const result = await client.cancelRecording(sessionId)
        if (!result.success) throw new Error(result.error || 'Cancel failed')
        if (args.json) output({ success: true }, true)
        else console.log('Recording cancelled')
        break
      }

      default:
        throw new Error(`Unknown record command: ${cmd}. Use: start, stop, status, cancel`)
    }
  },
})
