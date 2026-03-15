/**
 * Credential Broker — orchestrates secure login.
 *
 * Core security principle: the AGENT never sees the password.
 * The broker coordinates: policy check → form detect → vault lookup → autofill.
 *
 * V1 flow:  Vault → Server → CDP Runtime.evaluate → DOM → Submit
 * V2 flow:  Vault → Extension → Content Script → DOM → Submit
 */

import type { CDPExecutor } from '../cdp-executor.js'
import type { VaultAdapter } from './vault-adapters/adapter.js'
import type { PolicyEngine } from './policy.js'
import type { AuditLogger } from './audit.js'
import type {
  LoginRequest,
  LoginResult,
  CredentialMetadata,
  FormDetectionResult,
} from './types.js'
import { detectForms } from './form-detector.js'
import { autofillLoginForm, autofillUsernameOnly } from './autofill.js'

export interface CredentialBrokerOptions {
  vault: VaultAdapter
  policy: PolicyEngine
  audit: AuditLogger
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

export class CredentialBroker {
  private vault: VaultAdapter
  private policy: PolicyEngine
  private audit: AuditLogger
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  constructor(options: CredentialBrokerOptions) {
    this.vault = options.vault
    this.policy = options.policy
    this.audit = options.audit
    this.logger = options.logger
  }

  /**
   * Secure login flow. Agent receives success/failure, never the password.
   */
  async login(
    executor: CDPExecutor,
    request: LoginRequest,
  ): Promise<LoginResult> {
    const { sessionId, domain, credentialHint, timeout = 30000 } = request

    this.logger?.log(`[CredentialBroker] Login request: ${domain} (session: ${sessionId})`)

    // 1. Policy check
    const decision = this.policy.evaluate({
      sessionId,
      domain,
      action: 'login',
    })

    this.audit.log({
      sessionId,
      action: 'login_request',
      domain,
      policyDecision: decision.allowed ? 'allowed' : decision.denied ? 'denied' : 'requires_approval',
    })

    if (decision.denied) {
      this.logger?.log(`[CredentialBroker] Denied: ${decision.reason}`)
      return { status: 'denied', domain, error: decision.reason }
    }

    if (decision.requiresApproval) {
      // TODO: implement human approval flow (system notification)
      this.logger?.log(`[CredentialBroker] Requires approval: ${decision.reason}`)
      return { status: 'requires_approval', domain, error: decision.reason }
    }

    // 2. Record attempt for rate limiting
    this.policy.recordLoginAttempt(sessionId, domain)

    // 3. Check vault availability
    const vaultAvailable = await this.vault.isAvailable()
    if (!vaultAvailable) {
      this.audit.log({ sessionId, action: 'login_failed', domain, reason: 'Vault not available' })
      return { status: 'failed', domain, error: `Vault "${this.vault.name}" is not available. Make sure it is installed and unlocked.` }
    }

    // 4. Get credential from vault
    const credential = await this.vault.getCredential(domain, credentialHint)
    if (!credential) {
      this.audit.log({ sessionId, action: 'login_failed', domain, reason: 'No credentials found' })
      return { status: 'no_credentials', domain, error: `No credentials found for "${domain}" in ${this.vault.name}` }
    }

    this.logger?.log(`[CredentialBroker] Found credential for ${credential.username}`)

    // 5. Detect login form on current page
    const boundSendCDP = (method: string, params?: unknown) => executor.sendCDP(method, params)
    let formResult = await detectForms(boundSendCDP)

    this.audit.log({
      sessionId,
      action: 'form_detected',
      domain,
      username: credential.username,
      metadata: {
        detected: formResult.detected,
        formCount: formResult.forms.length,
        formType: formResult.loginForm?.type,
      },
    })

    if (!formResult.detected || !formResult.loginForm) {
      this.logger?.log(`[CredentialBroker] No login form detected on current page`)
      return {
        status: 'failed',
        domain,
        username: credential.username,
        error: 'No login form detected on the current page. Navigate to the login page first.',
      }
    }

    // 6. Autofill and submit
    this.logger?.log(`[CredentialBroker] Autofilling form (type: ${formResult.loginForm.type})`)

    this.audit.log({
      sessionId,
      action: 'autofill_attempt',
      domain,
      username: credential.username,
    })

    const hasPasswordField = formResult.loginForm.fields.some((f) => f.role === 'password')

    let fillResult
    if (hasPasswordField) {
      // Standard login: fill username + password + submit
      fillResult = await autofillLoginForm(boundSendCDP, formResult.loginForm, credential)
    } else {
      // Multi-step: fill username first, then wait for password field
      fillResult = await autofillUsernameOnly(boundSendCDP, formResult.loginForm, credential.username)

      if (fillResult.success) {
        // Wait for password field to appear
        this.logger?.log(`[CredentialBroker] Multi-step: waiting for password field...`)
        const passwordForm = await this.waitForPasswordField(boundSendCDP, timeout)

        if (passwordForm?.loginForm) {
          fillResult = await autofillLoginForm(boundSendCDP, passwordForm.loginForm, credential)
        } else {
          fillResult = {
            success: false,
            submitted: false,
            error: 'Password field did not appear after username submission',
          }
        }
      }
    }

    // 7. Log result
    const action = fillResult.success ? 'autofill_success' : 'autofill_failed'
    this.audit.log({
      sessionId,
      action,
      domain,
      username: credential.username,
      reason: fillResult.error,
    })

    if (fillResult.success) {
      // Wait a moment for navigation after form submission
      await new Promise((resolve) => setTimeout(resolve, 1500))

      this.audit.log({
        sessionId,
        action: 'login_success',
        domain,
        username: credential.username,
      })

      this.logger?.log(`[CredentialBroker] Login successful: ${credential.username}@${domain}`)
      return {
        status: 'success',
        domain,
        username: credential.username,
      }
    }

    this.audit.log({
      sessionId,
      action: 'login_failed',
      domain,
      username: credential.username,
      reason: fillResult.error,
    })

    return {
      status: 'failed',
      domain,
      username: credential.username,
      error: fillResult.error || 'Autofill failed',
    }
  }

  /**
   * List available credentials for a domain.
   * Returns metadata only — never passwords.
   */
  async listCredentials(
    sessionId: string,
    domain: string,
  ): Promise<CredentialMetadata[]> {
    const decision = this.policy.evaluate({
      sessionId,
      domain,
      action: 'list_credentials',
    })

    this.audit.log({
      sessionId,
      action: 'credential_list',
      domain,
      policyDecision: decision.allowed ? 'allowed' : 'denied',
    })

    if (decision.denied) return []

    const vaultAvailable = await this.vault.isAvailable()
    if (!vaultAvailable) return []

    return this.vault.listCredentials(domain)
  }

  /**
   * Detect forms on the current page (exposed for agent inspection).
   */
  async detectPageForms(executor: CDPExecutor): Promise<FormDetectionResult> {
    const boundSendCDP = (method: string, params?: unknown) => executor.sendCDP(method, params)
    return detectForms(boundSendCDP)
  }

  /** Get current policy (for display) */
  getPolicy() {
    return this.policy.getPolicy()
  }

  /** Get vault adapter name */
  getVaultName(): string {
    return this.vault.name
  }

  /** Check vault availability */
  async isVaultAvailable(): Promise<boolean> {
    return this.vault.isAvailable()
  }

  /** Clear session rate limits */
  clearSession(sessionId: string): void {
    this.policy.clearSession(sessionId)
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Poll for password field to appear (multi-step login flows).
   */
  private async waitForPasswordField(
    sendCDP: (method: string, params?: unknown) => Promise<unknown>,
    timeout: number,
  ): Promise<FormDetectionResult | null> {
    const deadline = Date.now() + Math.min(timeout, 15000)
    const pollInterval = 500

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))

      const result = await detectForms(sendCDP)
      if (result.loginForm?.fields.some((f) => f.role === 'password')) {
        return result
      }
    }

    return null
  }
}
