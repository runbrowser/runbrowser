/**
 * Credential audit logger.
 *
 * Append-only JSONL file — every credential access is recorded.
 * Default path: ~/.runbrowser/credential-audit.jsonl
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AuditEntry, AuditAction } from './types.js'
import { RUNBROWSER_DIR } from '../utils.js'

const DEFAULT_AUDIT_PATH = path.join(RUNBROWSER_DIR, 'credential-audit.jsonl')

export class AuditLogger {
  private filePath: string
  private enabled: boolean

  constructor(options: { filePath?: string; enabled?: boolean } = {}) {
    this.filePath = options.filePath || DEFAULT_AUDIT_PATH
    this.enabled = options.enabled ?? true

    if (this.enabled) {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }

  log(params: {
    sessionId: string
    action: AuditAction
    domain: string
    username?: string
    policyDecision?: string
    reason?: string
    metadata?: Record<string, unknown>
  }): void {
    if (!this.enabled) return

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...params,
    }

    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n')
    } catch {
      // Never throw from audit logging — it's a side channel
    }
  }

  /** Read recent audit entries (for debugging / display) */
  getRecent(count: number = 50): AuditEntry[] {
    try {
      if (!fs.existsSync(this.filePath)) return []
      const content = fs.readFileSync(this.filePath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      return lines
        .slice(-count)
        .map((line) => JSON.parse(line) as AuditEntry)
    } catch {
      return []
    }
  }

  get path(): string {
    return this.filePath
  }
}
