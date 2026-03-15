/**
 * Bitwarden CLI vault adapter.
 *
 * Requires: `bw` CLI installed and logged in.
 * The session key must be available via BW_SESSION env var or `bw unlock`.
 *
 * Bitwarden CLI docs: https://bitwarden.com/help/cli/
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { VaultAdapter } from './adapter.js'
import type { CredentialMetadata, CredentialSecret } from '../types.js'

const exec = promisify(execFile)

interface BwItem {
  id: string
  name: string
  login?: {
    username: string | null
    password: string | null
    uris?: Array<{ uri: string; match: number | null }>
    totp: string | null
  }
  revisionDate?: string
}

export class BitwardenAdapter implements VaultAdapter {
  readonly name = 'bitwarden'

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await exec('bw', ['status'], { timeout: 5000 })
      const status = JSON.parse(stdout)
      return status.status === 'unlocked'
    } catch {
      return false
    }
  }

  async listCredentials(domain: string): Promise<CredentialMetadata[]> {
    const items = await this.searchItems(domain)
    return items
      .filter((item) => item.login?.username)
      .map((item) => ({
        id: item.id,
        domain,
        username: item.login!.username!,
        label: item.name,
        lastUsed: item.revisionDate,
      }))
  }

  async getCredential(domain: string, hint?: string): Promise<CredentialSecret | null> {
    const items = await this.searchItems(domain)

    // Filter to items with login credentials
    const loginItems = items.filter(
      (item) => item.login?.username && item.login?.password,
    )

    if (loginItems.length === 0) return null

    // If hint provided, try to match by name or username
    let match = loginItems[0]
    if (hint) {
      const hintLower = hint.toLowerCase()
      const hinted = loginItems.find(
        (item) =>
          item.name.toLowerCase().includes(hintLower) ||
          item.login!.username!.toLowerCase().includes(hintLower),
      )
      if (hinted) match = hinted
    }

    return {
      id: match.id,
      username: match.login!.username!,
      password: match.login!.password!,
      totp: match.login!.totp || undefined,
    }
  }

  async getCredentialById(id: string): Promise<CredentialSecret | null> {
    try {
      const { stdout } = await exec('bw', ['get', 'item', id, '--response'], {
        timeout: 10000,
        env: { ...process.env },
      })
      const response = JSON.parse(stdout)
      const item: BwItem = response.data ?? JSON.parse(stdout)

      if (!item.login?.username || !item.login?.password) return null

      return {
        id: item.id,
        username: item.login.username,
        password: item.login.password,
        totp: item.login.totp || undefined,
      }
    } catch {
      return null
    }
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async searchItems(domain: string): Promise<BwItem[]> {
    try {
      const { stdout } = await exec(
        'bw',
        ['list', 'items', '--search', domain, '--response'],
        { timeout: 10000, env: { ...process.env } },
      )
      // bw --response wraps in { success, data }
      try {
        const response = JSON.parse(stdout)
        if (response.data) return response.data as BwItem[]
        return response as BwItem[]
      } catch {
        return JSON.parse(stdout) as BwItem[]
      }
    } catch {
      // Try without --response flag (older bw versions)
      try {
        const { stdout } = await exec('bw', ['list', 'items', '--search', domain], {
          timeout: 10000,
          env: { ...process.env },
        })
        return JSON.parse(stdout) as BwItem[]
      } catch {
        return []
      }
    }
  }
}
