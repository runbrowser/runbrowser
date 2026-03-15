/**
 * Recording relay functionality for the CDP relay server.
 * Handles recording state, chunk accumulation, and file writing.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import pc from 'picocolors'
import type {
  StartRecordingParams,
  StopRecordingParams,
  IsRecordingParams,
  CancelRecordingParams,
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
  RecordingDataMessage,
  RecordingCancelledMessage,
} from './protocol.js'

// Recording state - tracks active recordings and their accumulated chunks
export interface ActiveRecording {
  tabId: number
  sessionId?: string // The sessionId used to start this recording, for lookup when stopping
  outputPath: string
  chunks: Buffer[]
  startedAt: number
  resolveStop?: (result: StopRecordingResult) => void
}

export class RecordingRelay {
  private activeRecordings = new Map<number, ActiveRecording>()
  // Track which tabId just sent recordingData metadata - used to route the next binary chunk
  private lastRecordingMetadataTabId: number | null = null
  private sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>
  private isExtensionConnected: () => boolean
  private logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void }

  constructor(
    sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>,
    isExtensionConnected: () => boolean,
    logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void },
  ) {
    this.sendToExtension = sendToExtension
    this.isExtensionConnected = isExtensionConnected
    this.logger = logger
  }

  /**
   * Handle incoming binary data (recording chunks) from the extension.
   */
  handleBinaryData(buffer: Buffer): void {
    const tabId = this.lastRecordingMetadataTabId
    this.lastRecordingMetadataTabId = null

    if (tabId !== null) {
      const recording = this.activeRecordings.get(tabId)
      if (recording) {
        recording.chunks.push(buffer)
        this.logger?.log(
          pc.blue(
            `Received recording chunk for tab ${tabId}: ${buffer.length} bytes (total chunks: ${recording.chunks.length})`,
          ),
        )
      } else {
        this.logger?.log(pc.yellow(`Received recording chunk for unknown tab ${tabId}, ignoring`))
      }
    } else {
      this.logger?.log(pc.yellow('Received recording chunk without preceding metadata, ignoring'))
    }
  }

  /**
   * Handle recordingData message from extension.
   */
  handleRecordingData(message: RecordingDataMessage): void {
    const { tabId, final } = message.params
    const recording = this.activeRecordings.get(tabId)

    if (!final) {
      this.lastRecordingMetadataTabId = tabId
    }

    if (recording && final) {
      this.activeRecordings.delete(tabId)
      this.finalizeRecording(recording, tabId)
    }
  }

  /**
   * Write chunks to disk and transcode VP9 → H.264.
   * Runs async so handleRecordingData stays synchronous.
   */
  private async finalizeRecording(recording: ActiveRecording, tabId: number): Promise<void> {
    try {
      const totalSize = recording.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const combined = Buffer.concat(recording.chunks)

      // Write raw VP9 chunks to a temporary file first
      const rawPath = recording.outputPath + '.raw.mp4'
      fs.writeFileSync(rawPath, combined)

      const duration = Date.now() - recording.startedAt
      this.logger?.log(pc.blue(`Recording raw saved: ${rawPath} (${totalSize} bytes, ${duration}ms). Transcoding to H.264...`))

      // Transcode VP9 → H.264 for universal compatibility (QuickTime, browsers, etc.)
      try {
        await transcodeToH264(rawPath, recording.outputPath, this.logger)
        // Remove raw file after successful transcode
        fs.unlinkSync(rawPath)
        const finalSize = fs.statSync(recording.outputPath).size
        this.logger?.log(pc.green(`Recording saved: ${recording.outputPath} (${finalSize} bytes, ${duration}ms)`))

        if (recording.resolveStop) {
          recording.resolveStop({
            success: true,
            tabId,
            duration,
            path: recording.outputPath,
            size: finalSize,
          })
        }
      } catch (transcodeError: unknown) {
        // Transcoding failed — fall back to raw VP9 file
        const msg = transcodeError instanceof Error ? transcodeError.message : String(transcodeError)
        this.logger?.log(pc.yellow(`Transcode failed (${msg}), keeping raw VP9 file`))
        fs.renameSync(rawPath, recording.outputPath)

        if (recording.resolveStop) {
          recording.resolveStop({
            success: true,
            tabId,
            duration,
            path: recording.outputPath,
            size: totalSize,
          })
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Failed to write recording:', error)
      if (recording.resolveStop) {
        recording.resolveStop({ success: false, error: errorMessage })
      }
    }
  }

  /**
   * Handle recordingCancelled message from extension.
   */
  handleRecordingCancelled(message: RecordingCancelledMessage): void {
    const { tabId } = message.params
    const recording = this.activeRecordings.get(tabId)
    if (recording) {
      this.logger?.log(pc.yellow(`Recording cancelled for tab ${tabId}`))
      if (recording.resolveStop) {
        recording.resolveStop({ success: false, error: 'Recording was cancelled' })
      }
      this.activeRecordings.delete(tabId)
    }
  }

  async startRecording(params: StartRecordingParams & { outputPath: string }): Promise<StartRecordingResult> {
    const { outputPath, ...recordingParams } = params

    if (!outputPath) {
      return { success: false, error: 'outputPath is required' }
    }

    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    try {
      const result = (await this.sendToExtension({
        method: 'startRecording',
        params: recordingParams,
        timeout: 10000,
      })) as StartRecordingResult

      if (!result) {
        return { success: false, error: 'Extension returned empty result' }
      }

      if (result.success) {
        this.activeRecordings.set(result.tabId, {
          tabId: result.tabId,
          sessionId: recordingParams.sessionId,
          outputPath,
          chunks: [],
          startedAt: result.startedAt,
        })
        this.logger?.log(
          pc.green(
            `Recording started for tab ${result.tabId} (sessionId: ${recordingParams.sessionId || 'none'}), output: ${outputPath}`,
          ),
        )
      }

      return result
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Start recording error:', error)
      return { success: false, error: errorMessage }
    }
  }

  async stopRecording(params: StopRecordingParams): Promise<StopRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    const findRecording = (): ActiveRecording | undefined => {
      if (params.sessionId) {
        for (const recording of this.activeRecordings.values()) {
          if (recording.sessionId === params.sessionId) {
            return recording
          }
        }
        return undefined
      }
      return this.activeRecordings.values().next().value
    }

    const recording = findRecording()

    if (!recording) {
      const errorMsg = params.sessionId
        ? `No active recording found for sessionId: ${params.sessionId}`
        : 'No active recording found'
      return { success: false, error: errorMsg }
    }

    let timeoutId: ReturnType<typeof setTimeout>
    const finalPromise = new Promise<StopRecordingResult>((resolve) => {
      const wrappedResolve = (result: StopRecordingResult) => {
        clearTimeout(timeoutId)
        resolve(result)
      }
      recording.resolveStop = wrappedResolve
      timeoutId = setTimeout(() => {
        if (recording.resolveStop) {
          recording.resolveStop = undefined
          resolve({ success: false, error: 'Timeout waiting for recording data' })
        }
      }, 30000)
    })

    try {
      const result = (await this.sendToExtension({
        method: 'stopRecording',
        params,
        timeout: 10000,
      })) as StopRecordingResult

      if (!result.success) {
        recording.resolveStop = undefined
        this.activeRecordings.delete(recording.tabId)
        return result
      }

      return await finalPromise
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Stop recording error:', error)
      return { success: false, error: errorMessage }
    }
  }

  async isRecording(params: IsRecordingParams): Promise<IsRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { isRecording: false }
    }

    try {
      return (await this.sendToExtension({
        method: 'isRecording',
        params,
        timeout: 5000,
      })) as IsRecordingResult
    } catch {
      return { isRecording: false }
    }
  }

  async cancelRecording(params: CancelRecordingParams): Promise<CancelRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    try {
      return (await this.sendToExtension({
        method: 'cancelRecording',
        params,
        timeout: 5000,
      })) as CancelRecordingResult
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Cancel recording error:', error)
      return { success: false, error: errorMessage }
    }
  }
}

// ============================================================================
// VP9 → H.264 transcoding
// ============================================================================

/**
 * Transcode a VP9 video to H.264 for universal compatibility.
 * Uses hardware acceleration (VideoToolbox on macOS) when available.
 * Falls back to libx264 software encoding.
 */
async function transcodeToH264(
  inputPath: string,
  outputPath: string,
  logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void },
): Promise<void> {
  // Try hardware encoder first (h264_videotoolbox on macOS), fall back to libx264
  const encoders = process.platform === 'darwin'
    ? ['h264_videotoolbox', 'libx264']
    : ['libx264']

  for (const encoder of encoders) {
    try {
      await runFfmpeg(inputPath, outputPath, encoder, logger)
      return
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (encoders.indexOf(encoder) < encoders.length - 1) {
        logger?.log(pc.yellow(`Encoder ${encoder} failed (${msg}), trying next...`))
      } else {
        throw error
      }
    }
  }
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  encoder: string,
  logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const qualityArgs = encoder === 'h264_videotoolbox'
      ? ['-q:v', '80']
      : ['-crf', '18', '-preset', 'fast']

    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', encoder,
      ...qualityArgs,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ]

    logger?.log(pc.blue(`Transcoding with ${encoder}: ffmpeg ${args.join(' ')}`))

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Transcode timeout (60s)'))
    }, 60000)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to start ffmpeg: ${err.message}`))
    })
  })
}
