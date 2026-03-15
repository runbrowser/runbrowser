/**
 * JSON file vault adapter — for development and testing.
 *
 * Stores credentials in a local JSON file.
 * NOT recommended for production — use Bitwarden or 1Password instead.
 *
 * File format:
 * {
 *   "credentials": [
 *     {
 *       "id": "gh-work",
 *       "domain": "github.com",
 *       "username": "user@work.com",
 *       "password": "...",
 *       "label": "Work GitHub"
 *     }
 *   ]
 * }
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaultAdapter } from './adapter.js'
import type { CredentialMetadata, CredentialSecret } from '../types.js'
import { RUNBROWSER_DIR } from '../../utils.js'

const DEFAULT_VAULT_PATH = path.join(RUNBROWSER_DIR, 'credentials.json')

interface VaultFile {
  credentials: Array<{
    id: string
    domain: string
    username: string
    password: string
    label?: string
    totp?: string
  }>
}

export class JsonFileAdapter implements VaultAdapter {
  readonly name = 'json-file'
  private filePath: string

  constructor(options: { filePath?: string } = {}) {
    this.filePath = options.filePath || DEFAULT_VAULT_PATH
  }

  async isAvailable(): Promise<boolean> {
    return fs.existsSync(this.filePath)
  }

  async listCredentials(domain: string): Promise<CredentialMetadata[]> {
    const vault = this.readVault()
    return vault.credentials
      .filter((c) => this.matchDomain(c.domain, domain))
      .map((c) => ({
        id: c.id,
        domain: c.domain,
        username: c.username,
        label: c.label,
      }))
  }

  async getCredential(domain: string, hint?: string): Promise<CredentialSecret | null> {
    const vault = this.readVault()
    const matches = vault.credentials.filter((c) => this.matchDomain(c.domain, domain))

    if (matches.length === 0) return null

    let match = matches[0]
    if (hint) {
      const hintLower = hint.toLowerCase()
      const hinted = matches.find(
        (c) =>
          c.label?.toLowerCase().includes(hintLower) ||
          c.username.toLowerCase().includes(hintLower) ||
          c.id.toLowerCase().includes(hintLower),
      )
      if (hinted) match = hinted
    }

    return {
      id: match.id,
      username: match.username,
      password: match.password,
      totp: match.totp,
    }
  }

  async getCredentialById(id: string): Promise<CredentialSecret | null> {
    const vault = this.readVault()
    const match = vault.credentials.find((c) => c.id === id)
    if (!match) return null
    return {
      id: match.id,
      username: match.username,
      password: match.password,
      totp: match.totp,
    }
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private readVault(): VaultFile {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8')
      return JSON.parse(content) as VaultFile
    } catch {
      return { credentials: [] }
    }
  }

  private matchDomain(pattern: string, domain: string): boolean {
    if (pattern === domain) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return domain.endsWith(suffix) || domain === pattern.slice(2)
    }
    // Also match if the credential domain is a substring
    return domain.includes(pattern) || pattern.includes(domain)
  }
}
