/**
 * Vault adapter interface.
 *
 * RunBrowser does NOT build its own vault. It adapts existing password managers.
 * Each adapter implements credential lookup and retrieval.
 *
 * SECURITY: CredentialSecret is INTERNAL-ONLY. It must:
 * - Never be sent to the agent / LLM
 * - Never be logged
 * - Be cleared from memory after autofill
 */

import type { CredentialMetadata, CredentialSecret } from '../types.js'

export interface VaultAdapter {
  readonly name: string

  /** Check if this vault is available and ready */
  isAvailable(): Promise<boolean>

  /**
   * List credentials for a domain.
   * Returns METADATA ONLY — no passwords.
   */
  listCredentials(domain: string): Promise<CredentialMetadata[]>

  /**
   * Get a credential with its secret for autofill.
   * Returns the full credential including password.
   *
   * ⚠️  SECURITY: The returned CredentialSecret must:
   * - Be used only for immediate autofill
   * - Never be stored in session state
   * - Never be sent over any API response
   * - Be garbage-collected as soon as autofill completes
   */
  getCredential(domain: string, hint?: string): Promise<CredentialSecret | null>

  /**
   * Get a specific credential by ID.
   */
  getCredentialById(id: string): Promise<CredentialSecret | null>
}

/**
 * Create a vault adapter from config.
 */
export async function createVaultAdapter(config: {
  vault: string
  vaultPath?: string
}): Promise<VaultAdapter | null> {
  switch (config.vault) {
    case 'bitwarden': {
      const { BitwardenAdapter } = await import('./bitwarden.js')
      return new BitwardenAdapter()
    }
    case 'json-file': {
      const { JsonFileAdapter } = await import('./json-file.js')
      return new JsonFileAdapter({ filePath: config.vaultPath })
    }
    case 'none':
      return null
    default:
      return null
  }
}
